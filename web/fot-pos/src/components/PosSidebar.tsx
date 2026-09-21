import type { ReactNode } from 'react';
import type { PosSessionDto } from '@/api/types';
import { PosClock } from '@/components/PosClock';
import { formatNum } from '@/lib/money';

type RailIcon =
  | 'sync'
  | 'products'
  | 'expand'
  | 'compress'
  | 'price'
  | 'receipts'
  | 'report'
  | 'print'
  | 'reprint'
  | 'upload'
  | 'exit';

function RailGlyph({ name, spin }: { name: RailIcon; spin?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`pos-rail-glyph${spin ? ' is-spin' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {name === 'sync' && (
        <>
          <path d="M21 12a9 9 0 0 0-15.5-6.3" />
          <path d="M5.5 5.7V9H9" />
          <path d="M3 12a9 9 0 0 0 15.5 6.3" />
          <path d="M18.5 18.3V15H15" />
        </>
      )}
      {name === 'products' && (
        <>
          <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" />
          <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6" />
          <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" />
          <rect x="13" y="13" width="7.5" height="7.5" rx="1.6" />
        </>
      )}
      {name === 'expand' && (
        <>
          <path d="M9 3.5H3.5V9" />
          <path d="M15 3.5h5.5V9" />
          <path d="M20.5 15v5.5H15" />
          <path d="M9 20.5H3.5V15" />
        </>
      )}
      {name === 'compress' && (
        <>
          <path d="M9 3.5v5.5H3.5" />
          <path d="M15 3.5v5.5h5.5" />
          <path d="M20.5 15H15v5.5" />
          <path d="M3.5 15H9v5.5" />
        </>
      )}
      {name === 'price' && (
        <>
          <path d="M12.5 3.8 20 11.3a1.6 1.6 0 0 1 0 2.3l-6.4 6.4a1.6 1.6 0 0 1-2.3 0L3.8 12.5V3.8h8.7Z" />
          <circle cx="8.4" cy="8.4" r="1.2" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'receipts' && (
        <>
          <path d="M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v14l-2.2-1.2-2.3 1.2-2-1.2-2 1.2-2.3-1.2L5.5 20V6A1.5 1.5 0 0 1 7 4.5Z" />
          <path d="M9 9h6M9 12.5h6M9 16h3.5" />
        </>
      )}
      {name === 'report' && (
        <>
          <path d="M4 19V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14" />
          <path d="M8 17V11M12 17V7M16 17v-4" />
        </>
      )}
      {name === 'print' && (
        <>
          <path d="M7 8V4.8A1.3 1.3 0 0 1 8.3 3.5h7.4A1.3 1.3 0 0 1 17 4.8V8" />
          <path d="M7 16.5H5.4A1.9 1.9 0 0 1 3.5 14.6V10.8A1.9 1.9 0 0 1 5.4 8.9h13.2a1.9 1.9 0 0 1 1.9 1.9v3.8a1.9 1.9 0 0 1-1.9 1.9H17" />
          <rect x="7" y="14" width="10" height="6.5" rx="1.2" />
        </>
      )}
      {name === 'reprint' && (
        <>
          <path d="M8 8H5.5v11.5h13V8H16" />
          <path d="M8.5 3.5h7L17 8H7l1.5-4.5Z" />
          <path d="M9 17.5h6" />
        </>
      )}
      {name === 'upload' && (
        <>
          <path d="M12 15.5V7" />
          <path d="M8.5 10 12 6.5 15.5 10" />
          <path d="M5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18.5v-2" />
        </>
      )}
      {name === 'exit' && (
        <>
          <path d="M10 4.5H6.5A2 2 0 0 0 4.5 6.5v11A2 2 0 0 0 6.5 19.5H10" />
          <path d="M10 12h9.5" />
          <path d="M16.5 8.5 20 12l-3.5 3.5" />
        </>
      )}
    </svg>
  );
}

function RailBtn({
  label,
  icon,
  onClick,
  active,
  busy,
  live,
  danger,
  disabled,
  title,
  extra,
}: {
  label: string;
  icon: RailIcon;
  onClick: () => void;
  active?: boolean;
  busy?: boolean;
  live?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`pos-rail-btn${active ? ' is-on' : ''}${busy ? ' is-busy' : ''}${live ? ' is-live' : ''}${danger ? ' is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
    >
      <span className="pos-rail-ring" aria-hidden />
      <span className="pos-rail-icon">
        <RailGlyph name={icon} spin={busy || live} />
      </span>
      <span className="pos-rail-label">{busy ? 'جاري…' : live ? 'يصل…' : label}</span>
      {extra}
    </button>
  );
}

export function PosSidebar({
  session,
  modeName,
  returnMode,
  giftMode,
  productsOpen,
  fullscreenActive,
  online,
  reconnecting,
  syncing,
  liveUpdating,
  catalogCount,
  pendingCount,
  deferredCount = 0,
  deadCount,
  canViewReceipts,
  canCashReport,
  onToggleProducts,
  onToggleFullscreen,
  onSync,
  onPriceCheck,
  onTodayReceipts,
  onCashReport,
  onPrint,
  onReprint,
  onOutbox,
  onSession,
  onLogout,
}: {
  session: PosSessionDto;
  modeName: string;
  returnMode: boolean;
  giftMode: boolean;
  productsOpen: boolean;
  fullscreenActive: boolean;
  online: boolean;
  reconnecting: boolean;
  syncing: boolean;
  liveUpdating: boolean;
  catalogCount: number;
  pendingCount: number;
  deferredCount?: number;
  deadCount: number;
  canViewReceipts: boolean;
  canCashReport: boolean;
  onToggleProducts: () => void;
  onToggleFullscreen: () => void;
  onSync: () => void;
  onPriceCheck: () => void;
  onTodayReceipts: () => void;
  onCashReport: () => void;
  onPrint: () => void;
  onReprint: () => void;
  onOutbox: () => void;
  onSession: () => void;
  onLogout: () => void;
}) {
  const status = online ? 'متصل' : reconnecting ? 'إعادة' : 'أوفلاين';

  return (
    <aside className="pos-rail" aria-label="أدوات نقطة البيع">
      <div className="pos-rail-brand">
        <div className="pos-brand">FOT</div>
        <div className="pos-rail-brand-text">
          <strong>نقطة البيع</strong>
          <span>{session.sectionName || (session.posTerminalId ? String(session.posTerminalId) : '—')}</span>
        </div>
        <span className={`pos-rail-mode ${returnMode ? 'out' : giftMode ? 'gift' : 'sale'}`}>{modeName}</span>
      </div>

      <button type="button" className="pos-rail-user" onClick={onSession} title="فواتير اليوم">
        <span className="pos-header-avatar">{(session.cashierName || 'ك').slice(0, 1)}</span>
        <span className="pos-rail-user-name">{session.cashierName}</span>
      </button>

      <div className="pos-rail-tools">
        <RailBtn
          label="تحديث"
          icon="sync"
          busy={syncing}
          live={!syncing && liveUpdating}
          disabled={!online || syncing}
          onClick={onSync}
          title={online ? `تحديث الكتالوج والحسابات · ${formatNum(catalogCount)} صنف` : 'غير متصل'}
          extra={catalogCount > 0 ? <span className="pos-rail-count num">{formatNum(catalogCount)}</span> : undefined}
        />
        <RailBtn
          label="منتجات"
          icon="products"
          active={productsOpen}
          onClick={onToggleProducts}
        />
        <RailBtn
          label={fullscreenActive ? 'نافذة' : 'ملء'}
          icon={fullscreenActive ? 'compress' : 'expand'}
          active={fullscreenActive}
          onClick={onToggleFullscreen}
          title="ملء الشاشة · F1"
        />
        <RailBtn label="سعر" icon="price" onClick={onPriceCheck} title="فحص السعر" />
        {canViewReceipts && (
          <RailBtn label="فواتير" icon="receipts" onClick={onTodayReceipts} title="فواتير اليوم" />
        )}
        {canCashReport && (
          <RailBtn label="صندوق" icon="report" onClick={onCashReport} title="تقرير الصندوق — اليوم" />
        )}
        <RailBtn label="طباعة" icon="print" onClick={onPrint} title="إعدادات الطابعة" />
        <RailBtn label="إعادة" icon="reprint" onClick={onReprint} title="إعادة طباعة آخر فاتورة · F7" />
        <RailBtn
          label={deadCount > 0 ? 'فشل' : deferredCount > 0 ? 'مؤجلة' : 'طابور'}
          icon="upload"
          danger={deadCount > 0}
          onClick={onOutbox}
          title={`الطابور ${formatNum(pendingCount)} · مؤجلة ${formatNum(deferredCount)} · فاشلة ${formatNum(deadCount)}`}
          extra={(
            <span className="pos-rail-count num">
              {formatNum(pendingCount + deferredCount + deadCount)}
            </span>
          )}
        />
      </div>

      <div className="pos-rail-foot">
        <div className={`pos-rail-status ${online ? 'is-online' : 'is-offline'}`}>
          <span className="pos-status-dot" />
          <span>{status}</span>
        </div>
        <PosClock />
        <RailBtn label="خروج" icon="exit" danger onClick={onLogout} />
      </div>
    </aside>
  );
}
