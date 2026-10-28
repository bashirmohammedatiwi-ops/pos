import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getSeller } from '../../api';
import { APP_VERSION } from '../../config';
import { KIND_LABEL, getTeamMe } from '../../team';
import { Avatar, I, Screen } from '../kit';
import { haptic } from '../native';

/* ─────────────────────────────────────────────────────────────────────────────
 * المزيد — بطاقة الحساب، كل أقسام التطبيق في شبكة، والخدمات القادمة.
 * ───────────────────────────────────────────────────────────────────────────── */

export type MoreItem = { to: string; label: string; icon: ReactNode; badge?: number; tone?: string };

export function More({ items }: { items: MoreItem[] }) {
  const me = getTeamMe();
  const seller = getSeller();
  const name = me?.name || seller?.name || 'حسابي';
  return (
    <Screen title="المزيد">
      <Link to="/account" className="t-card pad press" style={{ display: 'flex', alignItems: 'center', gap: 14 }} onClick={() => haptic('tap')}>
        <Avatar name={name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700 }}>{name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            {KIND_LABEL[me?.kind ?? (seller ? 'seller' : '')] ?? 'موظف'}
            {me?.code ? ` · كود ${me.code}` : ''} · الحساب والمظهر
          </div>
        </div>
        <span style={{ color: 'var(--ink-4)' }}>
          <I.chevron />
        </span>
      </Link>

      <section className="t-section">
        <div className="t-menu">
          {items.map(it => (
            <Link key={it.to} to={it.to} className="press" onClick={() => haptic('tap')}>
              <span className={`t-tile lg ${it.tone ?? ''}`}>{it.icon}</span>
              {it.label}
              {!!it.badge && <span className="badge num">{it.badge > 9 ? '9+' : it.badge}</span>}
            </Link>
          ))}
        </div>
      </section>

      <p className="t-foot">
        ديما · الفريق — الإصدار <span className="num">{APP_VERSION}</span>
      </p>
    </Screen>
  );
}
