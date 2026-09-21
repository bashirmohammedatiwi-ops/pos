import type { IconKey } from '@/components/icons';

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  iconKey: IconKey;
  hint?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: string;
  iconKey?: IconKey;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: 'الرئيسية',
    icon: '◉',
    items: [{ path: '/', label: 'لوحة التحكم', icon: '▣', iconKey: 'dashboard' }],
  },
  {
    id: 'ops',
    label: 'العمليات اليومية',
    icon: '🧾',
    items: [
      { path: '/receipts', label: 'الفواتير', icon: '#', iconKey: 'receipts', hint: 'بحث ومعلّقة وطباعة' },
      { path: '/activity', label: 'حركات الكاشير', icon: '⟳', iconKey: 'activity', hint: 'سجل الفتح والإغلاق' },
      { path: '/reports', label: 'التقارير', icon: '▤', iconKey: 'reports', hint: 'تطبيقات التقارير' },
    ],
  },
  {
    id: 'sales',
    label: 'الكتالوج والبيع',
    icon: '▦',
    items: [
      { path: '/products', label: 'المنتجات', icon: '▦', iconKey: 'products', hint: 'الأسعار والمخزون' },
      { path: '/offers', label: 'العروض', icon: '%', iconKey: 'offers', hint: 'خصومات ومجموعات' },
      { path: '/groups', label: 'مجموعات الأزرار', icon: '⊞', iconKey: 'groups', hint: 'إضافة منتجات للكاشير' },
      { path: '/accounts', label: 'حسابات آجلة', icon: '﷼', iconKey: 'accounts', hint: 'حسابات بيع الآجل' },
    ],
  },
  {
    id: 'people',
    label: 'الفريق والحوافز',
    icon: '👥',
    items: [
      { path: '/cashiers', label: 'الكاشير', icon: '⌨', iconKey: 'cashiers', hint: 'الحسابات والصلاحيات' },
      { path: '/discount-qr', label: 'رموز الخصم', icon: '▣', iconKey: 'qr', hint: 'QR لاعتماد خصم الفاتورة' },
      { path: '/salesmen', label: 'البائعون', icon: '♂', iconKey: 'salesmen', hint: 'القائمة والتقارير' },
      { path: '/portal-accounts', label: 'حسابات الويب', icon: '⚿', iconKey: 'key', hint: 'رموز البائعين والمدراء' },
      { path: '/commissions', label: 'العمولات', icon: '₪', iconKey: 'commissions', hint: 'مجاميع العمولة' },
      { path: '/targets', label: 'الأهداف', icon: '▲', iconKey: 'targets', hint: 'إنشاء الأهداف وإدارتها' },
    ],
  },
  {
    id: 'system',
    label: 'النظام والربط',
    icon: '⚙',
    items: [
      { path: '/terminals', label: 'نقاط البيع', icon: '◇', iconKey: 'terminals', hint: 'الأجهزة والاتصال' },
      { path: '/price-checker', label: 'كاشف السعر', icon: '▣', iconKey: 'price', hint: 'أجهزة أندرويد ورمز الإعدادات' },
      { path: '/sections', label: 'الأقسام', icon: '▣', iconKey: 'sections', hint: 'الربط مع الإداري' },
      { path: '/edari', label: 'Edari', icon: '☁', iconKey: 'edari', hint: 'الجلب والترحيل' },
      { path: '/system', label: 'صحة النظام', icon: '❤', iconKey: 'shield', hint: 'تشخيص وأخطاء' },
      { path: '/settings', label: 'الإعدادات', icon: '✉', iconKey: 'settings', hint: 'الطباعة والشبكة' },
    ],
  },
];

export const PAGE_META: Record<
  string,
  { title: string; subtitle: string; iconKey: IconKey }
> = {
  '/': { title: 'لوحة التحكم', subtitle: 'مبيعات اليوم · المتابعة · الفريق والنظام', iconKey: 'dashboard' },
  '/products': { title: 'المنتجات', subtitle: 'الكتالوج · العروض · المخزون', iconKey: 'products' },
  '/offers': { title: 'العروض', subtitle: 'القائمة · التفعيل · الأشجار والمنتجات', iconKey: 'offers' },
  '/groups': { title: 'مجموعات الأزرار', subtitle: 'إنشاء المجاميع وإضافة المنتجات لنافذة نقطة البيع', iconKey: 'groups' },
  '/accounts': { title: 'حسابات آجلة', subtitle: 'حسابات Edari الظاهرة في بيع الآجل', iconKey: 'accounts' },
  '/receipts': { title: 'استعراض الإيصالات', subtitle: 'فلاتر · جدول · ملخص · تفاصيل الأصناف', iconKey: 'receipts' },
  '/activity': { title: 'حركات الكاشير', subtitle: 'السجل · حسب الكاشير · مقارنة الفترات', iconKey: 'activity' },
  '/reports': { title: 'التقارير', subtitle: 'تطبيقات التقارير', iconKey: 'reports' },
  '/salesmen': { title: 'البائعون', subtitle: 'القائمة · التقارير · عمولات الفترة', iconKey: 'salesmen' },
  '/portal-accounts': { title: 'حسابات الويب', subtitle: 'توليد الحسابات · الرمز ظاهر دائماً', iconKey: 'key' },
  '/cashiers': { title: 'الكاشير', subtitle: 'الحسابات والصلاحيات', iconKey: 'cashiers' },
  '/discount-qr': { title: 'رموز الخصم', subtitle: 'توليد QR لكل شخص وربطه بفواتير الخصم', iconKey: 'qr' },
  '/commissions': { title: 'العمولات', subtitle: 'إنشاء المجاميع وإدارتها', iconKey: 'commissions' },
  '/targets': { title: 'الأهداف', subtitle: 'إنشاء الأهداف وإدارتها', iconKey: 'targets' },
  '/sections': { title: 'الأقسام', subtitle: 'الربط مع Edari ونقاط البيع', iconKey: 'sections' },
  '/terminals': { title: 'نقاط البيع', subtitle: 'الأجهزة والاتصال والمبيعات', iconKey: 'terminals' },
  '/price-checker': { title: 'كاشف السعر', subtitle: 'تطبيق الأندرويد · رمز إعدادات الأجهزة', iconKey: 'price' },
  '/settings': { title: 'الإعدادات', subtitle: 'نماذج الفاتورة · الشعار · الصناديق', iconKey: 'settings' },
  '/edari': { title: 'Edari', subtitle: 'الارتباط الحي · الجلب · الترحيل', iconKey: 'edari' },
  '/system': { title: 'صحة النظام', subtitle: 'التشخيص · نقاط البيع · أخطاء الواجهات', iconKey: 'shield' },
};

/** صفحات القوائم — تخطيط مدمج: فلاتر أعلى · جدول كامل · إحصاءات أسفل */
export const DENSE_LIST_PATHS = new Set([
  '/settings',
  '/receipts',
  '/activity',
  '/products',
  '/cashiers',
  '/discount-qr',
  '/accounts',
  '/sections',
  '/terminals',
  '/price-checker',
  '/edari',
  '/salesmen',
  '/portal-accounts',
  '/offers',
  '/groups',
  '/system',
]);

export function isDenseListPage(pathname: string) {
  return DENSE_LIST_PATHS.has(pathname);
}
