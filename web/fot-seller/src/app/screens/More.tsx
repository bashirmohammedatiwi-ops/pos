import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getSeller } from '../../api';
import { cleanName } from '../../names';
import { APP_VERSION } from '../../config';
import { KIND_LABEL, getTeamMe } from '../../team';
import { Screen } from '../kit';
import { haptic } from '../native';
import { ProfileCard } from '../parts';

/* ─────────────────────────────────────────────────────────────────────────────
 * المزيد — بطاقة الحساب، كل أقسام التطبيق في شبكة، والخدمات القادمة.
 * ───────────────────────────────────────────────────────────────────────────── */

export type MoreItem = { to: string; label: string; icon: ReactNode; badge?: number; tone?: string; group?: string };

export function More({ items }: { items: MoreItem[] }) {
  const me = getTeamMe();
  const seller = getSeller();
  const name = cleanName(me?.name || seller?.name) || 'حسابي';
  // عناصر كل قسم بترتيب ورودها
  const groups = [...new Set(items.map(i => i.group ?? ''))];
  return (
    <Screen title="المزيد">
      <ProfileCard name={name} role={KIND_LABEL[me?.kind ?? (seller ? 'seller' : '')] ?? 'موظف'} meta={`${me?.code ? `كود ${me.code} · ` : ''}الحساب والمظهر`} to="/account" />

      {groups.map(g => (
        <section key={g} className="t-section">
          {g && (
            <div className="t-section-head">
              <h2>{g}</h2>
            </div>
          )}
          <div className="t-menu">
            {items
              .filter(i => (i.group ?? '') === g)
              .map(it => (
                <Link key={it.to} to={it.to} className="press" onClick={() => haptic('tap')}>
                  <span className={`t-tile lg ${it.tone ?? ''}`}>{it.icon}</span>
                  {it.label}
                  {!!it.badge && <span className="badge num">{it.badge > 9 ? '9+' : it.badge}</span>}
                </Link>
              ))}
          </div>
        </section>
      ))}

      <p className="t-foot">
        ديما · الفريق — الإصدار <span className="num">{APP_VERSION}</span>
      </p>
    </Screen>
  );
}
