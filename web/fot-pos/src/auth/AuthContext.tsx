import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, getToken, refreshSessionToken, setToken, TOKEN_REFRESHED_EVENT } from '@/api/client';
import type { PosSessionDto } from '@/api/types';
import { db } from '@/lib/db';
import { outboxStats, seedLocalReceiptSeq } from '@/lib/catalogSync';
import { lastSeenCatalogVersion } from '@/hooks/usePosHub';
import { resolveHwId } from '@/lib/money';
import { getApiBase, persistApiBase } from '@/lib/apiBase';

const SESSION_KEY = 'fot_pos_session';
const OFFLINE_KEY = 'fot_pos_offline_session';
const ROSTER_KEY = 'fot_pos_cashier_roster';

type OfflineCache = {
  session: PosSessionDto;
  user: string;
  pinHash: string;
  savedAt: number;
};

interface AuthState {
  session: PosSessionDto | null;
  login: (username: string, password: string) => Promise<string | null>;
  resumeOffline: (username: string, password: string) => Promise<string | null>;
  canResumeOffline: () => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

async function hashPin(user: string, password: string) {
  const raw = `${user.trim().toLowerCase()}:${password}:${await resolveHwId()}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function readRoster(): OfflineCache[] {
  const fromRoster = localStorage.getItem(ROSTER_KEY);
  if (fromRoster) {
    try {
      const parsed = JSON.parse(fromRoster) as OfflineCache[];
      if (Array.isArray(parsed)) return parsed.filter(x => x?.user && x.session && x.pinHash);
    } catch {
      /* fall through */
    }
  }
  const legacy = localStorage.getItem(OFFLINE_KEY);
  if (!legacy) return [];
  try {
    const one = JSON.parse(legacy) as OfflineCache;
    return one?.user && one.session ? [one] : [];
  } catch {
    return [];
  }
}

function writeRoster(list: OfflineCache[]) {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(list.slice(0, 24)));
  if (list[0]) localStorage.setItem(OFFLINE_KEY, JSON.stringify(list[0]));
  else localStorage.removeItem(OFFLINE_KEY);
}

function upsertRoster(entry: OfflineCache) {
  writeRoster([entry, ...readRoster().filter(x => x.user !== entry.user)]);
}

function findCached(username: string): OfflineCache | null {
  const key = username.trim().toLowerCase();
  return readRoster().find(x => x.user === key) ?? null;
}

async function hasLocalCatalog() {
  return (await db.productCount()) > 0 || (await db.pendingCount()) > 0;
}

let hostsApi: boolean | null = null;

/**
 * The main machine runs the API itself, so a failed health check there means the service
 * is merely stopped and waiting for ensureApi to start it pays off. A cashier terminal has
 * nothing to start, so it must not wait on the LAN scan before using its local copy.
 */
async function machineHostsApi() {
  if (hostsApi !== null) return hostsApi;
  try {
    const info = await window.fotDesktop?.info?.();
    hostsApi = Boolean(info?.hasLocalApi);
  } catch {
    hostsApi = false;
  }
  return hostsApi;
}

async function resumeOfflineLogin(
  username: string,
  password: string,
  applyToken: (token: string | null) => void,
  applySession: (session: PosSessionDto) => void,
): Promise<string | null> {
  const cached = findCached(username);
  if (!cached) return 'لا توجد بيانات دخول محلية لهذا الكاشير — ادخل مرة والخادم متصل';
  if (cached.pinHash !== await hashPin(username, password)) return 'اسم المستخدم أو الرمز غير صحيح';
  if (cached.session.permissions?.offlineLogin === false) return 'الدخول بدون اتصال غير مسموح لهذا الكاشير';
  if (!(await hasLocalCatalog())) return 'لا يوجد كتالوج محلي — ادخل مرة وهو متصل أولاً';
  applyToken(cached.session.token);
  applySession(cached.session);
  localStorage.setItem(SESSION_KEY, JSON.stringify(cached.session));
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PosSessionDto | null>(() => {
    if (!getToken()) return null;
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PosSessionDto;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const onRefreshed = (event: Event) => {
      const token = (event as CustomEvent<{ token?: string }>).detail?.token;
      if (!token) return;
      setSession(prev => {
        if (!prev) return prev;
        const next = { ...prev, token };
        localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        const roster = readRoster();
        const idx = roster.findIndex(x => x.session.cashierId === next.cashierId);
        if (idx >= 0) {
          roster[idx] = { ...roster[idx], session: { ...roster[idx].session, token }, savedAt: Date.now() };
          writeRoster(roster);
        }
        return next;
      });
    };
    window.addEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
    return () => window.removeEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
  }, []);

  useEffect(() => {
    if (!session?.cashierId) return;
    let cancelled = false;
    const renew = async () => {
      if (cancelled || !(await api.health())) return;
      await refreshSessionToken();
    };
    void renew();
    const t = window.setInterval(() => { void renew(); }, 30 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [session?.cashierId]);

  // Live permissions + cashboxes: admin edits (including adding/removing a section's
  // cashboxes) reach the logged-in cashier within ~a minute instead of requiring
  // logout/login. Persisted so a restart keeps the latest set.
  useEffect(() => {
    if (!session?.cashierId) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || !(await api.health())) return;
      try {
        const [perms, boxes] = await Promise.all([api.myPermissions(), api.myCashBoxes()]);
        if (cancelled || !session.cashierId) return;
        const permsChanged = !!perms && JSON.stringify(perms) !== JSON.stringify(session.permissions);
        // An empty list is a real answer (every box unlinked from the section), so it must
        // apply too — otherwise a removed box keeps posting sales from this terminal.
        const boxesChanged = JSON.stringify(boxes) !== JSON.stringify(session.cashBoxes);
        if (!permsChanged && !boxesChanged) return;
        setSession(prev => {
          if (!prev || prev.cashierId !== session.cashierId) return prev;
          const next = {
            ...prev,
            ...(permsChanged ? { permissions: perms! } : {}),
            ...(boxesChanged ? { cashBoxes: boxes } : {}),
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
          return next;
        });
      } catch {
        /* best-effort — next cycle retries */
      }
    };
    const t = window.setInterval(() => { void refresh(); }, 20_000);
    // Instant application when the server broadcasts a settings change (permission edits).
    const onSettingsSignal = () => { void refresh(); };
    window.addEventListener('fot-pos-refresh-permissions', onSettingsSignal);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener('fot-pos-refresh-permissions', onSettingsSignal);
    };
  }, [session?.cashierId, session?.permissions, session?.cashBoxes]);

  useEffect(() => {
    if (!session?.posTerminalId) return;
    const ping = async () => {
      if (!session.posTerminalId) return;
      if (!(await api.health())) return;
      let outbox: { ready: number; dead: number; deferred: number } | undefined;
      try {
        const stats = await outboxStats();
        outbox = { ready: stats.queued, dead: stats.dead, deferred: stats.deferred };
      } catch { /* stats are best-effort */ }
      await api.heartbeat(session.posTerminalId, outbox, lastSeenCatalogVersion());
    };
    void ping();
    const t = window.setInterval(() => { void ping(); }, 45_000);
    return () => window.clearInterval(t);
  }, [session?.posTerminalId]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      async login(username, password) {
        const name = username.trim();
        try {
          await persistApiBase(getApiBase());
          if (!(await api.health())) {
            const localReady = findCached(name) !== null
              && (await hasLocalCatalog())
              && !(await machineHostsApi());
            // Straight to the cached session: probing the LAN and then waiting out the
            // login request kept the button spinning for up to a minute.
            if (localReady) return resumeOfflineLogin(name, password, setToken, setSession);
            const found = await window.fotDesktop?.ensureApi?.(getApiBase());
            if (found?.ok && found.url) await persistApiBase(found.url);
            // Closing the circuit here is required: the failed health above opened it,
            // and login must not throw instantly after the local service just came up.
            await api.health();
          }
          const res = await api.cashierLogin(name, password, await resolveHwId());
          setToken(res.token);
          setSession(res);
          localStorage.setItem(SESSION_KEY, JSON.stringify(res));
          // Seed the local receipt counter from the server so locally printed numbers
          // match the dashboard after upload (offline + manual-transfer invoices).
          await seedLocalReceiptSeq(res.receiptYear ?? 0, res.receiptSeq ?? 0, res.cashierReceiptNum ?? 0);
          upsertRoster({
            session: res,
            user: name.toLowerCase(),
            pinHash: await hashPin(name, password),
            savedAt: Date.now(),
          });
          return null;
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0;
          const online = status > 0 ? status < 500 : await api.health();
          if (!online || status >= 500 || status === 0) {
            const offline = await resumeOfflineLogin(name, password, setToken, setSession);
            if (!offline) return null;
            if (status === 401 || (e instanceof Error && e.message === 'Unauthorized'))
              return 'اسم المستخدم أو الرمز غير صحيح';
            return e instanceof Error ? e.message : offline;
          }
          return e instanceof Error && e.message === 'Unauthorized'
            ? 'اسم المستخدم أو الرمز غير صحيح'
            : e instanceof Error ? e.message : 'فشل تسجيل الدخول';
        }
      },
      resumeOffline(username, password) {
        return resumeOfflineLogin(username, password, setToken, setSession);
      },
      async canResumeOffline() {
        if (readRoster().length === 0) return false;
        return hasLocalCatalog();
      },
      logout() {
        setToken(null);
        setSession(null);
        localStorage.removeItem(SESSION_KEY);
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
