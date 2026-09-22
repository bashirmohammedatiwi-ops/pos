import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Ic({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ─── Navigation ─────────────────────────────────────────── */

export const IconDashboard = (p: IconProps) => (
  <Ic {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Ic>
);

export const IconReceipt = (p: IconProps) => (
  <Ic {...p}><path d="M4 3h16v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L4 21V3Z" /><path d="M8 8h8" /><path d="M8 12h5" /></Ic>
);

export const IconActivity = (p: IconProps) => (
  <Ic {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Ic>
);

export const IconChart = (p: IconProps) => (
  <Ic {...p}><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></Ic>
);

export const IconPackage = (p: IconProps) => (
  <Ic {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></Ic>
);

export const IconPercent = (p: IconProps) => (
  <Ic {...p}><line x1="19" x2="5" y1="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></Ic>
);

export const IconGrid = (p: IconProps) => (
  <Ic {...p}><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 12h18" /><path d="M12 3v18" /></Ic>
);

export const IconWallet = (p: IconProps) => (
  <Ic {...p}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></Ic>
);

export const IconKeyboard = (p: IconProps) => (
  <Ic {...p}><rect width="20" height="16" x="2" y="4" rx="2" /><path d="M6 8h.01" /><path d="M10 8h.01" /><path d="M14 8h.01" /><path d="M18 8h.01" /><path d="M8 12h.01" /><path d="M12 12h.01" /><path d="M16 12h.01" /><path d="M7 16h10" /></Ic>
);

export const IconUsers = (p: IconProps) => (
  <Ic {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Ic>
);

export const IconUser = (p: IconProps) => (
  <Ic {...p}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Ic>
);

export const IconCoins = (p: IconProps) => (
  <Ic {...p}><circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="m16.71 13.88.7.71-2.82 2.82" /></Ic>
);

export const IconTarget = (p: IconProps) => (
  <Ic {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Ic>
);

export const IconMonitor = (p: IconProps) => (
  <Ic {...p}><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></Ic>
);

export const IconLayers = (p: IconProps) => (
  <Ic {...p}><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" /></Ic>
);

export const IconCloud = (p: IconProps) => (
  <Ic {...p}><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></Ic>
);

export const IconSliders = (p: IconProps) => (
  <Ic {...p}><line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" /><line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" /><line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" /><line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" /></Ic>
);

/* ─── Actions ────────────────────────────────────────────── */

export const IconSearch = (p: IconProps) => (
  <Ic {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Ic>
);

export const IconRefresh = (p: IconProps) => (
  <Ic {...p}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></Ic>
);

export const IconUpload = (p: IconProps) => (
  <Ic {...p}><path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.24" /><path d="M12 12v9" /><path d="m16 16-4-4-4 4" /></Ic>
);

export const IconDownload = (p: IconProps) => (
  <Ic {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></Ic>
);

export const IconHelp = (p: IconProps) => (
  <Ic {...p}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></Ic>
);

export const IconLogout = (p: IconProps) => (
  <Ic {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></Ic>
);

export const IconMenu = (p: IconProps) => (
  <Ic {...p}><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="18" y2="18" /></Ic>
);

export const IconX = (p: IconProps) => (
  <Ic {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Ic>
);

export const IconChevronDown = (p: IconProps) => (
  <Ic {...p}><path d="m6 9 6 6 6-6" /></Ic>
);

export const IconPlus = (p: IconProps) => (
  <Ic {...p}><path d="M5 12h14" /><path d="M12 5v14" /></Ic>
);

export const IconPencil = (p: IconProps) => (
  <Ic {...p}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" /></Ic>
);

export const IconTrash = (p: IconProps) => (
  <Ic {...p}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></Ic>
);

export const IconPrinter = (p: IconProps) => (
  <Ic {...p}><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" /><rect x="6" y="14" width="12" height="8" rx="1" /></Ic>
);

export const IconCopy = (p: IconProps) => (
  <Ic {...p}><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Ic>
);

export const IconCheck = (p: IconProps) => (
  <Ic {...p}><path d="M20 6 9 17l-5-5" /></Ic>
);

export const IconCheckCircle = (p: IconProps) => (
  <Ic {...p}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></Ic>
);

export const IconAlert = (p: IconProps) => (
  <Ic {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></Ic>
);

export const IconInfo = (p: IconProps) => (
  <Ic {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></Ic>
);

export const IconTrendUp = (p: IconProps) => (
  <Ic {...p}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></Ic>
);

export const IconTrendDown = (p: IconProps) => (
  <Ic {...p}><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></Ic>
);

export const IconCalendar = (p: IconProps) => (
  <Ic {...p}><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></Ic>
);

export const IconFilter = (p: IconProps) => (
  <Ic {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></Ic>
);

export const IconEye = (p: IconProps) => (
  <Ic {...p}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></Ic>
);

export const IconLock = (p: IconProps) => (
  <Ic {...p}><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Ic>
);

export const IconBell = (p: IconProps) => (
  <Ic {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Ic>
);

export const IconClock = (p: IconProps) => (
  <Ic {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Ic>
);

export const IconDatabase = (p: IconProps) => (
  <Ic {...p}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></Ic>
);

export const IconZap = (p: IconProps) => (
  <Ic {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></Ic>
);

export const IconLink = (p: IconProps) => (
  <Ic {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Ic>
);

export const IconExternal = (p: IconProps) => (
  <Ic {...p}><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Ic>
);

export const IconShield = (p: IconProps) => (
  <Ic {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></Ic>
);

export const IconSend = (p: IconProps) => (
  <Ic {...p}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Ic>
);

export const IconHistory = (p: IconProps) => (
  <Ic {...p}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></Ic>
);

export const IconBanknote = (p: IconProps) => (
  <Ic {...p}><rect width="20" height="12" x="2" y="6" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01" /><path d="M18 12h.01" /></Ic>
);

export const IconTag = (p: IconProps) => (
  <Ic {...p}><path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42Z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></Ic>
);

export const IconFolder = (p: IconProps) => (
  <Ic {...p}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></Ic>
);

export const IconWifi = (p: IconProps) => (
  <Ic {...p}><path d="M5 13a10 10 0 0 1 14 0" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M2 8.82a15 15 0 0 1 20 0" /><path d="M12 20h.01" /></Ic>
);

export const IconInbox = (p: IconProps) => (
  <Ic {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Ic>
);

export const IconQr = (p: IconProps) => (
  <Ic {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3" /><path d="M20 14v3" /><path d="M14 20h3v-3" /><path d="M20 20h.01" /></Ic>
);

export const IconBarcode = (p: IconProps) => (
  <Ic {...p}><path d="M3 5v14" /><path d="M6 5v14" /><path d="M8 5v14" /><path d="M11 5v14" /><path d="M13 5v14" /><path d="M17 5v14" /><path d="M21 5v14" /></Ic>
);

export const IconSparkle = (p: IconProps) => (
  <Ic {...p}><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><path d="M5.6 5.6l2.1 2.1" /><path d="M16.3 16.3l2.1 2.1" /><path d="M18.4 5.6l-2.1 2.1" /><path d="M7.7 16.3l-2.1 2.1" /><circle cx="12" cy="12" r="2.5" /></Ic>
);

export const IconArrowUp = (p: IconProps) => (
  <Ic {...p}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Ic>
);

export const IconArrowDown = (p: IconProps) => (
  <Ic {...p}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Ic>
);

/** Icon lookup by route key — used by sidebar + page headers */
export const ICONS = {
  dashboard: IconDashboard,
  receipts: IconReceipt,
  activity: IconActivity,
  reports: IconChart,
  products: IconPackage,
  barcode: IconBarcode,
  offers: IconPercent,
  groups: IconGrid,
  accounts: IconWallet,
  cashiers: IconKeyboard,
  qr: IconQr,
  price: IconTag,
  salesmen: IconUsers,
  key: IconSparkle,
  commissions: IconCoins,
  targets: IconTarget,
  terminals: IconMonitor,
  sections: IconLayers,
  edari: IconCloud,
  settings: IconSliders,
  shield: IconShield,
} as const;

export type IconKey = keyof typeof ICONS;

/* ─── Scope editor extras ───────────────────────────────── */

export const IconFolderClosed = (p: IconProps) => (
  <Ic {...p}><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></Ic>
);
