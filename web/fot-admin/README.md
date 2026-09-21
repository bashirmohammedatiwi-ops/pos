# FOT POS Admin — Web UI

واجهة إدارة كاملة (React + Vite + TypeScript + Tailwind) مع **شريط علوي** واتصال مباشر بـ API الحالي.

## التشغيل

```powershell
# 1) API
dotnet run --project src/FOT.Pos.Api

# 2) الواجهة
cd web/fot-admin
npm install
npm run dev
```

افتح **http://localhost:5173** — الدخول: `admin` / `admin123`

أو تطبيق سطح المكتب:

```powershell
cd desktop
npm install
npm run admin
```

## الصفحات (كلها جاهزة)

| القسم | الصفحات |
|-------|---------|
| الرئيسية | لوحة التحكم |
| المبيعات | المنتجات، العروض، المجموعات، حسابات آجلة |
| العمليات | الفواتير، حركات الكاشier، التقارير |
| الموظفون | المندوبين، الكاشier، الصلاحيات |
| الحوافز | العمولات، الأهداف |
| النظام | الأقسام، نقاط البيع، الطباعة، Edari |

## الأداء

- **Lazy loading** — كل صفحة تُحمّل عند الطلب (~1KB–10KB gzip)
- **TanStack Query** — تخزين مؤقت ذكي
- **Vite** — HMR سريع في التطوير

## البناء للإنتاج

```powershell
npm run build
npm run preview
```

انسخ `.env.example` إلى `.env` واضبط `VITE_API_URL` إذا كان الـ API على خادم مختلف.

## ميزات متقدمة

- **SignalR** — تحديث مباشر للفواتير والكتalog عبر `/hubs/pos`
- **Toast عام** — إشعارات موحّدة لكل الصفحات
- **تصدير CSV** — من صفحة التقارير
- **معاينة طباعة** — من الخادم (`/api/settings/print/preview`)
- **Edari** — مزامنة فواتير + Catalog + إعدادات كاملة

مشروع WPF (`FOT.Pos.Admin`) يبقى احتياطياً — POS (`FOT.Pos.Client`) لم يتغير.
