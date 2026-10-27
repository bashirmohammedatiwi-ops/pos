/** تنسيقات تاريخ خفيفة (بلا مكتبات) تُستخدم في الصفحات والتقارير. */
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function dayName(iso: string) {
  return AR_DAYS[new Date(`${iso}T12:00:00`).getDay()];
}

export function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
