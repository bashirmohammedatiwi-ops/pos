import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../config';
import { getTeamMe, getTeamToken } from '../team';

/* ─────────────────────────────────────────────────────────────────────────────
 * وحدات العمل في التطبيق: التبليغات، الإعلانات، الدوام والإجازات، رفع الصور،
 * والقناة الحية (SSE) — للموظف (رمز الفريق) وللمدير (رمز المدير).
 * ───────────────────────────────────────────────────────────────────────────── */

export const MANAGER_TOKEN = 'fot_manager_token';
export const MANAGER_ME = 'fot_manager_me';

export type Role = 'staff' | 'manager';

export function getManagerToken() {
  try {
    return localStorage.getItem(MANAGER_TOKEN);
  } catch {
    return null;
  }
}
export function getManagerMe(): { id: number; username: string; displayName: string } | null {
  try {
    const raw = localStorage.getItem(MANAGER_ME);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function clearManager() {
  try {
    localStorage.removeItem(MANAGER_TOKEN);
    localStorage.removeItem(MANAGER_ME);
  } catch {
    /* ignore */
  }
}

/* ═════════════ الأنواع ═════════════ */
export interface Notif {
  id: number;
  type: string;
  title: string;
  body?: string | null;
  image?: string | null;
  link?: string | null;
  data?: Record<string, unknown> | null;
  readAt?: string | null;
  createdAt: string;
}
export interface Post {
  id: number;
  kind: 'news' | 'offer' | 'instruction' | 'congrats' | 'alert' | string;
  title: string;
  body?: string | null;
  images: string[];
  pinned: boolean;
  requiresAck: boolean;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  read: boolean;
  acked: boolean;
  // للمدير
  audienceLabel?: string;
  targetCount?: number;
  readCount?: number;
  ackCount?: number;
  expired?: boolean;
}
export interface DayState {
  date: string;
  weekday: string;
  off: boolean;
  reason: null | 'weekly' | 'swap' | 'swapped-in' | 'hours' | 'day' | 'sick' | 'urgent';
  leaveId?: number | null;
}
export type LeaveType = 'swap' | 'day' | 'sick' | 'urgent' | 'hours';
export interface LeaveReq {
  id: number;
  staffId: number;
  staffName: string;
  staffKind?: string | null;
  sectionName?: string | null;
  type: LeaveType;
  typeLabel: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  swapFrom?: string | null;
  swapTo?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  reason?: string | null;
  attachment?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decidedBy?: string | null;
  decidedNote?: string | null;
  decidedAt?: string | null;
  createdAt: string;
}
export interface MyLeave {
  today: string;
  weeklyOff: number;
  days: DayState[];
  requests: LeaveReq[];
  types: Record<LeaveType, string>;
}
export interface Overview {
  today: string;
  weekday: string;
  staffCount: number;
  offToday: { staffId: number; name: string; kind: string; reason: string }[];
  partial: { staffId: number; name: string; kind: string; timeFrom?: string; timeTo?: string }[];
  pending: number;
  devices: number;
  active7: number;
  posts: Post[];
}
export interface DirStaff {
  id: number;
  code: string;
  name: string;
  kind: string;
  jobTitle?: string | null;
  sectionId?: number | null;
  sectionName?: string | null;
  isActive: boolean;
  weeklyOff: number;
  device?: string | null;
  lastSeen?: string | null;
}
export interface Audience {
  all?: boolean;
  kinds?: string[];
  sections?: number[];
  staff?: number[];
}

export const LEAVE_LABEL: Record<LeaveType, string> = {
  swap: 'تبديل العطلة',
  day: 'إجازة',
  sick: 'إجازة مرضية',
  urgent: 'إجازة طارئة',
  hours: 'استئذان',
};
export const STATUS_LABEL: Record<LeaveReq['status'], string> = {
  pending: 'بانتظار الموافقة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  cancelled: 'ملغى',
};
export const POST_KIND: Record<string, { label: string; tone: '' | 'accent' | 'ok' | 'bad' | 'mute' }> = {
  news: { label: 'خبر', tone: '' },
  offer: { label: 'عرض', tone: 'accent' },
  instruction: { label: 'تعليمات', tone: 'mute' },
  congrats: { label: 'تهنئة', tone: 'ok' },
  alert: { label: 'تنبيه', tone: 'bad' },
};
/** السبت أولاً — نفس ترتيب الخادم (البت 0 = السبت) */
export const WEEK_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
export const offNames = (mask: number) => WEEK_DAYS.filter((_, i) => (mask >> i) & 1);
const SHORT_DAY: Record<string, string> = { السبت: 'سبت', الأحد: 'أحد', الاثنين: 'إثنين', الثلاثاء: 'ثلاثاء', الأربعاء: 'أربعاء', الخميس: 'خميس', الجمعة: 'جمعة' };
/** اسم اليوم بلا «ال» للخلايا الضيقة */
export const shortDay = (weekday: string) => SHORT_DAY[weekday] ?? weekday;

/* ═════════════ الطلبات ═════════════ */
export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(role: Role, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = role === 'manager' ? getManagerToken() : getTeamToken();
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new HttpError('لا اتصال بالخادم — تحقق من الإنترنت', 0);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* ليس JSON */
  }
  if (!res.ok) {
    if (res.status === 404 && !(body as { error?: string })?.error) throw new HttpError('الخادم لا يدعم هذه الميزة بعد — حدّث الـ VPS', 404);
    throw new HttpError((body as { error?: string })?.error || 'تعذر الاتصال', res.status);
  }
  if (body === null && text.trimStart().startsWith('<')) throw new HttpError('الخادم لا يدعم هذه الميزة بعد — حدّث الـ VPS', 404);
  return body as T;
}

export const staffApi = {
  notifications: (before?: number) => call<{ items: Notif[]; unread: number }>('staff', `/api/team/notifications${before ? `?before=${before}` : ''}`),
  read: (b: { ids?: number[]; all?: boolean }) => call<{ unread: number }>('staff', '/api/team/notifications/read', { method: 'POST', body: b }),
  posts: () => call<Post[]>('staff', '/api/team/posts'),
  readPost: (id: number, ack = false) => call<Post>('staff', `/api/team/posts/${id}/${ack ? 'ack' : 'read'}`, { method: 'POST', body: {} }),
  leave: () => call<MyLeave>('staff', '/api/team/leave'),
  requestLeave: (b: Record<string, unknown>) => call<LeaveReq>('staff', '/api/team/leave', { method: 'POST', body: b }),
  cancelLeave: (id: number) => call<{ ok: true }>('staff', `/api/team/leave/${id}/cancel`, { method: 'POST', body: {} }),
  upload: (dataUrl: string) => call<{ url: string }>('staff', '/api/team/media', { method: 'POST', body: { data: dataUrl } }),
};

export const managerApi = {
  me: () => call<{ id: number; username: string; displayName: string; unread: number }>('manager', '/api/team/m/me'),
  overview: () => call<Overview>('manager', '/api/team/m/overview'),
  directory: () => call<DirStaff[]>('manager', '/api/team/m/directory'),
  leave: (status: 'pending' | 'all' | 'approved' | 'rejected') => call<LeaveReq[]>('manager', `/api/team/m/leave?status=${status}`),
  decide: (id: number, approve: boolean, note?: string) => call<LeaveReq>('manager', `/api/team/m/leave/${id}/decide`, { method: 'POST', body: { approve, note } }),
  setWeeklyOff: (id: number, daysMask: number) => call<{ daysMask: number }>('manager', `/api/team/m/staff/${id}/weekly-off`, { method: 'PUT', body: { daysMask } }),
  schedule: (id: number) => call<{ weeklyOff: number; days: DayState[] }>('manager', `/api/team/m/staff/${id}/schedule?days=28`),
  posts: () => call<Post[]>('manager', '/api/team/m/posts'),
  savePost: (b: Record<string, unknown>, id?: number) => call<Post>('manager', id ? `/api/team/m/posts/${id}` : '/api/team/m/posts', { method: id ? 'PUT' : 'POST', body: b }),
  deletePost: (id: number) => call<{ ok: true }>('manager', `/api/team/m/posts/${id}`, { method: 'DELETE' }),
  readers: (id: number) => call<{ staffId: number; name: string; kind: string; readAt?: string | null; ackAt?: string | null }[]>('manager', `/api/team/m/posts/${id}/readers`),
  notify: (b: { title: string; body?: string; image?: string | null; audience: Audience }) => call<{ count: number }>('manager', '/api/team/m/notify', { method: 'POST', body: b }),
  notifyLog: () => call<{ id: number; title: string; body?: string; audienceLabel: string; targetCount: number; readCount: number; createdBy?: string; createdAt: string }[]>('manager', '/api/team/m/notify/log'),
  notifications: (before?: number) => call<{ items: Notif[]; unread: number }>('manager', `/api/team/m/notifications${before ? `?before=${before}` : ''}`),
  read: (b: { ids?: number[]; all?: boolean }) => call<{ unread: number }>('manager', '/api/team/m/notifications/read', { method: 'POST', body: b }),
  upload: (dataUrl: string) => call<{ url: string }>('manager', '/api/team/m/media', { method: 'POST', body: { data: dataUrl } }),
};

/* ═════════════ الحضور والاستراحة ═════════════ */
export interface BreakRec {
  id: number;
  startAt: string;
  endAt?: string | null;
  plannedMinutes: number;
  endsAt: string;
  overMinutes: number;
}
export interface AttendRec {
  id: number;
  date: string;
  checkIn: string;
  checkOut?: string | null;
  lateMinutes: number;
  autoClosed: boolean;
  edited: boolean;
  note?: string | null;
  workedMinutes: number;
  breakMinutes: number;
  overMinutes: number;
  breaks: BreakRec[];
  // في السجل
  staffId?: number;
  staffName?: string;
  staffKind?: string | null;
  sectionName?: string | null;
}
export interface Shift {
  start: string;
  end: string;
  breakMinutes: number;
  maxBreaks: number;
  custom?: boolean;
}
export interface AttendState {
  now: string;
  today: string;
  day?: DayState | null;
  shift: Shift;
  attendance: AttendRec | null;
  openBreak: BreakRec | null;
  breakLeftMinutes: number;
  breaksLeft: number;
  history: AttendRec[];
  network: { enforced: boolean; configured: boolean; needsBssid: boolean };
}
export type BoardStatus = 'in' | 'break' | 'over' | 'out' | 'off' | 'soon' | 'missing' | 'absent';
export interface BoardRow {
  staffId: number;
  name: string;
  kind: string;
  sectionName?: string | null;
  shift: Shift;
  day?: DayState | null;
  status: BoardStatus;
  attendance: AttendRec | null;
}
export interface Board {
  date: string;
  now: string;
  rows: BoardRow[];
  counts: Record<'in' | 'break' | 'over' | 'out' | 'off' | 'missing' | 'soon' | 'late', number>;
  network: { enforced: boolean; count: number };
}
export interface ShopNetwork {
  id: number;
  name: string;
  bssid?: string | null;
  ip?: string | null;
  ssid?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
}
export interface AttendSettings {
  enforceNetwork: boolean;
  shiftStart: string;
  shiftEnd: string;
  breakMinutes: number;
  maxBreaks: number;
  graceMinutes: number;
  earlyMinutes: number;
  autoCloseHours: number;
  breakWarnMinutes: number;
}

export const attendApi = {
  state: () => call<AttendState>('staff', '/api/team/attend'),
  probe: (bssid?: string | null) => call<{ ok: boolean; ip: string; network: string | null; error: string | null }>('staff', `/api/team/attend/probe${bssid ? `?bssid=${encodeURIComponent(bssid)}` : ''}`),
  act: (action: 'in' | 'out' | 'break/start' | 'break/end', bssid?: string | null, deviceId?: string) =>
    call<AttendState>('staff', `/api/team/attend/${action}`, { method: 'POST', body: { bssid, deviceId } }),
};
export const managerAttendApi = {
  board: () => call<Board>('manager', '/api/team/m/attend/board'),
  log: (from: string, to: string, staffId?: number) => call<AttendRec[]>('manager', `/api/team/m/attend/log?from=${from}&to=${to}${staffId ? `&staffId=${staffId}` : ''}`),
  settings: () => call<{ settings: AttendSettings; networks: ShopNetwork[] }>('manager', '/api/team/m/attend/settings'),
  capture: (b: { bssid?: string | null; ssid?: string | null; name?: string; ipOnly?: boolean; withIp?: boolean }) => call<ShopNetwork>('manager', '/api/team/m/networks/capture', { method: 'POST', body: b }),
  probe: (bssid?: string | null) => call<{ ok: boolean; ip: string; bssid?: string | null; network: string | null; error: string | null }>('manager', `/api/team/m/networks/probe${bssid ? `?bssid=${encodeURIComponent(bssid)}` : ''}`),
  deleteNetwork: (id: number) => call<{ ok: true }>('manager', `/api/team/m/networks/${id}`, { method: 'DELETE' }),
  correct: (id: number, b: { checkIn?: string; checkOut?: string | null; note?: string }) => call<AttendRec>('manager', `/api/team/m/attend/${id}`, { method: 'PUT', body: b }),
  setShift: (staffId: number, b: Partial<Shift> & { reset?: boolean }) => call<Shift>('manager', `/api/team/m/staff/${staffId}/shift`, { method: 'PUT', body: b }),
  shift: (staffId: number) => call<Shift>('manager', `/api/team/m/staff/${staffId}/shift`),
};

/* ═════════════ المحادثات ═════════════ */
export interface ChatPerson {
  key: string;
  kind: 'staff' | 'manager';
  id: number;
  name: string;
  role: string;
  sub?: string | null;
}
export interface ChatMsg {
  id: number;
  convId: number;
  sender: { key: string; name: string; role?: string | null };
  body?: string | null;
  image?: string | null;
  replyTo?: { id: number; senderName: string; body: string } | null;
  createdAt: string;
  deleted: boolean;
  /** محلي: قيد الإرسال */
  pending?: boolean;
}
export interface ChatConv {
  id: number;
  kind: 'direct' | 'group';
  auto?: string | null;
  title: string;
  other?: { key: string; role: string; sub?: string | null } | null;
  memberCount: number;
  lastAt: string;
  last?: { body: string; senderName: string; mine: boolean; at: string } | null;
  unread: number;
  muted: boolean;
  isAdmin: boolean;
}

export function chatApi(role: Role) {
  const base = role === 'manager' ? '/api/team/m/chat' : '/api/team/chat';
  return {
    me: () => (role === 'manager' ? `manager:${getManagerMe()?.id ?? 0}` : `staff:${getTeamMe()?.id ?? 0}`),
    list: () => call<ChatConv[]>(role, base),
    unread: () => call<{ total: number }>(role, `${base}/unread`),
    people: () => call<ChatPerson[]>(role, `${base}/people`),
    direct: (key: string) => call<ChatConv>(role, `${base}/direct`, { method: 'POST', body: { key } }),
    createGroup: (title: string, members: string[]) => call<ChatConv>(role, `${base}/groups`, { method: 'POST', body: { title, members } }),
    updateGroup: (id: number, b: { title?: string; add?: string[]; remove?: string[]; delete?: boolean }) => call<ChatConv>(role, `${base}/groups/${id}`, { method: 'PUT', body: b }),
    messages: (id: number, before?: number) =>
      call<{ conversation: ChatConv; messages: ChatMsg[]; members: (ChatPerson & { lastRead: number })[]; hasMore: boolean }>(role, `${base}/${id}/messages${before ? `?before=${before}` : ''}`),
    send: (id: number, b: { body?: string; image?: string | null; replyTo?: number | null }) => call<ChatMsg>(role, `${base}/${id}/messages`, { method: 'POST', body: b }),
    read: (id: number, lastId?: number) => call<{ total: number }>(role, `${base}/${id}/read`, { method: 'POST', body: { lastId } }),
    typing: (id: number) => call<{ ok: true }>(role, `${base}/${id}/typing`, { method: 'POST', body: {} }),
    remove: (mid: number) => call<{ ok: true }>(role, `${base}/messages/${mid}`, { method: 'DELETE' }),
    mute: (id: number, muted: boolean) => call<ChatConv>(role, `${base}/${id}/mute`, { method: 'POST', body: { muted } }),
    upload: (data: string) => (role === 'manager' ? managerApi.upload(data) : staffApi.upload(data)),
  };
}

/** عدد رسائل المحادثات غير المقروءة (يتحدث مع كل رسالة). */
export function useChatUnread(role: Role | null) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!role) return;
    const api = chatApi(role);
    let alive = true;
    let t = 0;
    const load = () => api.unread().then(r => alive && setN(r.total)).catch(() => undefined);
    void load();
    const off = onLive(m => {
      if (m.event === 'chat-unread' && typeof m.data.total === 'number') setN(m.data.total);
      else if (m.event === 'chat') {
        window.clearTimeout(t);
        t = window.setTimeout(load, 400);
      }
    });
    return () => {
      alive = false;
      off();
      window.clearTimeout(t);
    };
  }, [role]);
  return n;
}

/** رابط صورة من الخادم (مسار نسبي ← عنوان الخادم داخل التطبيق). */
export function mediaUrl(u?: string | null) {
  if (!u) return '';
  return /^https?:|^data:/.test(u) ? u : apiUrl(u);
}

/* ═════════════ ضغط الصور قبل الرفع ═════════════ */
export async function compressImage(file: File, max = 1600, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error('تعذر قراءة الصورة'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('تعذر معالجة الصورة');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ═════════════ القناة الحية + عدّاد غير المقروء ═════════════ */
const LIVE_EVENT = 'fot-team-live';
export type LiveEvent = 'hello' | 'notify' | 'unread' | 'post' | 'leave' | 'attend' | 'chat' | 'typing' | 'chat-read' | 'chat-unread';
export type LiveMsg = {
  event: LiveEvent;
  data: {
    unread?: number;
    item?: Notif;
    id?: number;
    deleted?: boolean;
    weekly?: boolean;
    staffId?: number;
    // المحادثات
    convId?: number;
    message?: ChatMsg;
    deletedId?: number;
    key?: string;
    name?: string;
    lastId?: number;
    total?: number;
    created?: boolean;
    updated?: boolean;
  };
};

export function onLive(fn: (m: LiveMsg) => void) {
  const h = (e: Event) => fn((e as CustomEvent<LiveMsg>).detail);
  window.addEventListener(LIVE_EVENT, h);
  return () => window.removeEventListener(LIVE_EVENT, h);
}

/** يفتح القناة الحية للدور الحالي ويعيد الاتصال تلقائياً؛ ينشر الرسائل كأحداث نافذة. */
export function useLiveChannel(role: Role | null) {
  useEffect(() => {
    if (!role || typeof EventSource === 'undefined') return;
    const token = role === 'manager' ? getManagerToken() : getTeamToken();
    if (!token) return;
    const path = role === 'manager' ? '/api/team/m/events' : '/api/team/events';
    let es: EventSource | null = null;
    let stopped = false;
    let retry = 0;
    let timer = 0;
    const publish = (event: LiveMsg['event'], raw: string) => {
      try {
        window.dispatchEvent(new CustomEvent<LiveMsg>(LIVE_EVENT, { detail: { event, data: JSON.parse(raw) } }));
      } catch {
        /* ignore */
      }
    };
    const connect = () => {
      if (stopped) return;
      es = new EventSource(apiUrl(`${path}?token=${encodeURIComponent(token)}`));
      for (const ev of ['hello', 'notify', 'unread', 'post', 'leave', 'attend', 'chat', 'typing', 'chat-read', 'chat-unread'] as const)
        es.addEventListener(ev, e => publish(ev, (e as MessageEvent).data));
      es.onopen = () => {
        retry = 0;
      };
      es.onerror = () => {
        // الخادم يرد 401/404 بلا قناة: نتوقف ونعيد بتمهّل
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          retry = Math.min(retry + 1, 6);
          timer = window.setTimeout(connect, 2000 * retry);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      es?.close();
    };
  }, [role]);
}

/** عدّاد التبليغات غير المقروءة (يتحدث من القناة الحية، ويُطلب عند البدء). */
export function useUnread(role: Role | null) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!role) return;
    let alive = true;
    (role === 'manager' ? managerApi.notifications() : staffApi.notifications())
      .then(r => alive && setUnread(r.unread))
      .catch(() => undefined);
    const off = onLive(m => {
      if (typeof m.data.unread === 'number') setUnread(m.data.unread);
    });
    return () => {
      alive = false;
      off();
    };
  }, [role]);
  return unread;
}

/** تحميل بيانات مع إعادة عند حدث حي معيّن. */
export function useLoad<T>(fn: () => Promise<T>, reloadOn: LiveEvent[] = [], deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!reloadOn.length) return;
    return onLive(m => {
      if (reloadOn.includes(m.event)) void reload();
    });
  }, [reloadOn.join(','), reload]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, loading, reload, setData };
}

/* ═════════════ تنسيق ═════════════ */
const LOC = 'ar-IQ-u-nu-latn';
export function relTime(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'الآن';
  const m = Math.round(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.round(h / 24);
  if (d < 7) return `قبل ${d} ${d === 1 ? 'يوم' : 'أيام'}`;
  return new Date(t).toLocaleDateString(LOC, { day: 'numeric', month: 'short' });
}
export function dateShort(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(LOC, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function time12(hm?: string | null) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
}
export function leaveWhen(r: Pick<LeaveReq, 'type' | 'dateFrom' | 'dateTo' | 'swapFrom' | 'swapTo' | 'timeFrom' | 'timeTo'>) {
  if (r.type === 'swap') return `${dateShort(r.swapFrom)} ← ${dateShort(r.swapTo)}`;
  if (r.type === 'hours') return `${dateShort(r.dateFrom)} · ${time12(r.timeFrom)} – ${time12(r.timeTo)}`;
  return r.dateFrom === r.dateTo || !r.dateTo ? dateShort(r.dateFrom) : `${dateShort(r.dateFrom)} – ${dateShort(r.dateTo)}`;
}
export function dayGroup(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'اليوم';
  if (same(d, y)) return 'أمس';
  if (Date.now() - d.getTime() < 7 * 86_400_000) return 'هذا الأسبوع';
  return 'أقدم';
}
