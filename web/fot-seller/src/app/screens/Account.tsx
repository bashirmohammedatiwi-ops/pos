import { useEffect, useState, type ReactNode } from 'react';
import { getSeller } from '../../api';
import { APP_VERSION, PUSH_ENABLED, apiUrl, platform } from '../../config';
import { KIND_LABEL, getTeamMe, getTeamToken } from '../../team';
import { Avatar, Badge, I, Screen, Segmented, Sheet, Switch, longDate } from '../kit';
import { BackBtn } from '../parts';
import { getThemePref, haptic, hapticsOn, setHapticsOn, setThemePref, type ThemePref } from '../native';

/* ─────────────────────────────────────────────────────────────────────────────
 * حسابي — الهوية، الجهاز المربوط، المظهر والاهتزاز، الإشعارات، الخروج.
 * ───────────────────────────────────────────────────────────────────────────── */

type Device = { label?: string | null; platform?: string | null; boundAt?: string | null };

function Row({ icon, tone, title, value, children }: { icon: ReactNode; tone?: string; title: string; value?: ReactNode; children?: ReactNode }) {
  return (
    <div className="t-row">
      <span className={`t-tile ${tone ?? 'mute'}`}>{icon}</span>
      <div className="body">
        <div className="title">{title}</div>
        {value != null && <div className="sub">{value}</div>}
      </div>
      {children}
    </div>
  );
}

export function Account({ onLogout, back }: { onLogout: () => void; back?: string }) {
  const me = getTeamMe();
  const seller = getSeller();
  const name = me?.name || seller?.name || 'حسابي';
  const [device, setDevice] = useState<Device | null>(null);
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [vib, setVib] = useState(hapticsOn);
  const [askOut, setAskOut] = useState(false);

  useEffect(() => {
    const token = getTeamToken();
    if (!token) return;
    fetch(apiUrl('/api/team/me'), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { device?: Device } | null) => setDevice(d?.device ?? null))
      .catch(() => undefined);
  }, []);

  const bound = device?.boundAt ? longDate(device.boundAt) : null;

  return (
    <Screen title="حسابي" hideLarge start={back ? <BackBtn to={back} /> : undefined}>
      <div className="t-profile">
        <Avatar name={name} size="xl" />
        <h2>{name}</h2>
        <p>
          <Badge>{KIND_LABEL[me?.kind ?? (seller ? 'seller' : '')] ?? 'موظف'}</Badge>
          {me?.sectionName && <Badge tone="mute">{me.sectionName}</Badge>}
        </p>
      </div>

      <section className="t-section">
        <div className="t-section-head">
          <h2>الحساب</h2>
        </div>
        <div className="t-list">
          <Row icon={<I.user size={19} />} tone="" title="كود الدخول" value={<span className="num ltr">{me?.code ?? seller?.id ?? '—'}</span>} />
          {me?.jobTitle && <Row icon={<I.store size={19} />} title="المسمى الوظيفي" value={me.jobTitle} />}
          {seller && <Row icon={<I.wallet size={19} />} tone="accent" title="رقم البائع" value={<span className="num">{seller.id}</span>} />}
        </div>
      </section>

      <section className="t-section">
        <div className="t-section-head">
          <h2>الجهاز</h2>
        </div>
        <div className="t-list">
          <Row
            icon={<I.shield size={19} />}
            tone="ok"
            title={device?.label || (platform() === 'web' ? 'متصفح' : 'هذا الهاتف')}
            value={bound ? `مربوط بحسابك منذ ${bound}` : 'يُربط الحساب بأول هاتف تدخل منه'}
          />
          <Row icon={<I.bell size={19} />} tone={PUSH_ENABLED ? 'ok' : 'mute'} title="الإشعارات" value={PUSH_ENABLED ? 'مفعّلة على هذا الهاتف' : 'داخل التطبيق · تنبيهات الدوام والاستراحة تعمل والتطبيق مغلق'} />
        </div>
      </section>

      <section className="t-section">
        <div className="t-section-head">
          <h2>المظهر</h2>
        </div>
        <div className="t-card pad" style={{ display: 'grid', gap: 14 }}>
          <Segmented
            items={[
              { id: 'system', label: 'تلقائي' },
              { id: 'light', label: 'فاتح' },
              { id: 'dark', label: 'داكن' },
            ]}
            value={theme}
            onChange={v => {
              setTheme(v);
              setThemePref(v);
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="t-tile mute">
              <I.vibrate size={19} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 560 }}>الاهتزاز عند اللمس</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>ارتداد خفيف مع الأزرار والتنبيهات</div>
            </div>
            <Switch
              label="الاهتزاز"
              on={vib}
              onChange={v => {
                setVib(v);
                setHapticsOn(v);
                if (v) haptic('success');
              }}
            />
          </div>
        </div>
      </section>

      <section className="t-section">
        <div className="t-list">
          <button
            type="button"
            className="t-row danger press-soft"
            onClick={() => {
              haptic('warning');
              setAskOut(true);
            }}
          >
            <span className="t-tile bad">
              <I.out size={19} />
            </span>
            <div className="body">
              <div className="title">تسجيل الخروج</div>
            </div>
          </button>
        </div>
      </section>

      <p className="t-foot">
        ديما · الفريق — الإصدار <span className="num">{APP_VERSION}</span>
        <br />
        ديما الحياة · بغداد
      </p>

      <Sheet open={askOut} onClose={() => setAskOut(false)} title="تسجيل الخروج؟" subtitle="ستحتاج الكود والرمز السري للدخول مرة أخرى.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button type="button" className="t-btn plain press" onClick={() => setAskOut(false)}>
            بقاء
          </button>
          <button type="button" className="t-btn danger press" onClick={onLogout}>
            خروج
          </button>
        </div>
      </Sheet>
    </Screen>
  );
}
