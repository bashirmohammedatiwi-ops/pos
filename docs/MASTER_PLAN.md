# FOT POS — Next Generation Master Plan

> **الحالة:** خطة معتمدة — لا تبدأ التنفيذ قبل الموافقة  
> **التاريخ:** 2026-08-17  
> **المبدأ:** نسخة مستقلة من قاعدة البيانات — **لا نلمس HAYAT2025 الأصلية**

---

## 1. الرؤية

بناء نظام POS + لوحة تحكم **احترافي بالكامل** يحل محل FOT Dashboard و FOT POS Client تدريجياً، مع:

- **100% من خصائص النظام القديم** (منتجات، عروض، فواتير، كاشير، مندوبين، أقسام، طباعة، offline، بصمة، ميزان، MPOS…)
- **خصائص إضافية:** عمولات، أهداف، تقارير متقدمة، تطبيق موظف (لاحقاً)، مزامنة سحابية (لاحقاً)
- **ربط Edari** في مرحلة لاحقة (بعد شرح آلية الربط)
- **عملة:** دينار عراقي (IQD) — **أرقام إنجليزية** (1,234,567)

---

## 2. استراتيجية قاعدة البيانات (نسخة — لا HAYAT2025 مباشرة)

```
HAYAT2025.mdf (الأصل — FOT القديم)     ← لا نكتب عليها أبداً
        │
        │  RESTORE BACKUP (مرة واحدة)
        ▼
FOT_POS_V2.mdf (نسخة العمل)            ← التطبيق الجديد فقط
        │
        ├── نفس 49 جدول legacy
        └── + جداول ext_* للميزات الجديدة
```

### خطوات إنشاء النسخة

1. أخذ backup من `D:\FOT POS\Dashboard\Backups\` أو `BACKUP DATABASE HAYAT2025`
2. Restore باسم **`FOT_POS_V2`** على نفس instance `FOTSQLSERVER`
3. تشغيل migrations للجداول `ext_*` على النسخة فقط
4. FOT القديم يستمر على `HAYAT2025.mdf` بدون أي تأثير

### مزامنة لاحقة (اختياري)

- **قراءة** من HAYAT2025 للمنتجات الجديدة (one-way import job)
- **كتابة** الفواتير الجديدة → Edari (مرحلة منفصلة)

---

## 3. التقنيات المقترحة (.NET Stack)

| الطبقة | التقنية | الإصدار | لماذا |
|--------|---------|---------|-------|
| **Backend API** | ASP.NET Core | **.NET 9** | أحدث LTS-stable، أسرع HTTP، minimal APIs + controllers |
| **ORM** | Entity Framework Core 9 | + Dapper للتقارير الثقيلة | EF للـ CRUD، Dapper للـ 274K+ فاتورة |
| **Realtime** | SignalR | مدمج | بديل FOT Server :9653 — push للـ POS |
| **Background Jobs** | Hangfire | SQL Server storage | مزامنة Edari، retry، scheduled tasks |
| **Cache** | Redis (StackExchange) | optional | catalog 49K منتج، session |
| **Auth** | ASP.NET Identity + JWT | — | RBAC: admin, manager, accountant, supervisor, cashier |
| **Validation** | FluentValidation | — | |
| **Logging** | Serilog | — | structured logs |
| **Admin UI** | **Blazor Server** أو **React + Vite** | — | انظر §4 |
| **POS Desktop** | **WPF (.NET 9)** أو **WinUI 3** | — | hardware Windows (بصمة ZK، طابعة، ميزان، VFD) |
| **POS Local DB** | SQLite (EF Core) | — | offline — نفس schema FOT القديم |
| **Reports** | FastReport / DevExpress (optional) | — | بديل .repx |
| **API Docs** | OpenAPI (Swagger) | — | |

### لماذا .NET وليس Node.js؟

- FOT القديم **Windows-native** — WPF/WinUI أفضل للبصمة والطابعات والميزان
- SQL Server integration **أقوى** في .NET (EF + bulk + TVP)
- **أداء** ASP.NET Core من أفضل ما في السوق لـ LAN API
- **Hangfire + SignalR** جاهزان للمزامنة والـ realtime
- فريق Windows shop — tooling موحد

---

## 4. واجهة المستخدم — معايير التصميم

### المبدأ: **Enterprise Clean** — بدون ألوان غريبة

| العنصر | القيمة |
|--------|--------|
| **Palette** | Slate/Gray neutrals + **Blue-600** accent واحد فقط |
| **Background** | `#F8FAFC` (slate-50) |
| **Cards** | white, border `#E2E8F0`, shadow-xs |
| **Text** | `#0F172A` primary, `#64748B` muted |
| **Success** | `#059669` (emerald-600) — للمزامنة فقط |
| **Warning** | `#D97706` — pending sync |
| **Danger** | `#DC2626` — delete/void |
| **Font** | Segoe UI / IBM Plex Sans Arabic |
| **Numbers** | `en-US` locale دائماً (1,234,567 د.ع) |
| **Direction** | RTL للعربي |
| **Density** | Compact للجداول — مريح للعمل 8+ ساعات |

### ممنوع

- Gradients flashy (مثل login الحالي)
- ألوان بنفسجي/وردي/neon
- Animations كثيرة
- Sidebar ملون بقوة

### Admin Layout

```
┌──────────────────────────────────────────────────────────┐
│  [Logo] FOT POS          🔍 Search          [User ▾]     │
├────────────┬─────────────────────────────────────────────┤
│  لوحة      │  Page Title                    [Actions]     │
│  التحكم    │  ─────────────────────────────────────────  │
│  المنتجات  │                                             │
│  العروض    │  Content (tables, forms, charts)            │
│  الفواتير  │                                             │
│  ...       │                                             │
└────────────┴─────────────────────────────────────────────┘
```

---

## 5. هيكل الح solution

```
FOT-POS/
├── src/
│   ├── FOT.Pos.Api/              ASP.NET Core 9 — REST + SignalR
│   ├── FOT.Pos.Domain/           Entities, enums, business rules
│   ├── FOT.Pos.Infrastructure/   EF Core, Dapper, Hangfire, Edari
│   ├── FOT.Pos.Application/      Services, DTOs, validators
│   ├── FOT.Pos.Admin/            Blazor Server أو React SPA
│   ├── FOT.Pos.Client/           WPF POS terminal
│   └── FOT.Pos.Shared/           Constants, pricing logic, formatters
├── database/
│   ├── restore/                  scripts restore FOT_POS_V2
│   ├── migrations/               ext_* + indexes
│   └── seed/                     admin user, test data
├── tests/
│   ├── FOT.Pos.UnitTests/
│   └── FOT.Pos.IntegrationTests/
├── docs/
└── FOT-POS.sln
```

---

## 6. قائمة الخصائص — parity مع FOT القديم

### 6.1 لوحة التحكم (Dashboard)

| # | Module | Legacy | New |
|---|--------|--------|-----|
| 1 | لوحة رئيسية | ✅ | KPIs, charts, terminal status |
| 2 | المنتجات | ✅ | CRUD, barcodes, groups, stock |
| 3 | مجموعات الأزرار | ✅ | colors, sort, section scope |
| 4 | العروض | ✅ | priority, dates, BOGO, %/fixed |
| 5 | الفواتير | ✅ | search, view, filter, export |
| 6 | حركة مادة | ✅ | Article movement report |
| 7 | الكاشير | ✅ | + permissions matrix |
| 8 | صلاحيات الكاشير | ✅ | 30+ flags |
| 9 | المندوبين | ✅ | section assignment |
| 10 | الأقسام | ✅ | UI layout, scale, Edari map |
| 11 | الفروع | ✅ | |
| 12 | نقاط البيع | ✅ | hw_id, offline, updates |
| 13 | الحسابات (آجل) | ✅ | credit customers |
| 14 | العملات | ✅ | IQD primary |
| 15 | القسائم | ✅ | groups + codes |
| 16 | التوصيل | ✅ | delivery clients |
| 17 | الطباعة | ✅ | templates, footer, QR |
| 18 | التقارير | ✅ | cash, sales, movement |
| 19 | مزامنة Edari | ✅ | Phase 4 |
| 20 | النسخ الاحتياطي | ✅ | scheduled backup |
| 21 | السجلات | ✅ | users_log, pos_log |

### 6.2 نقطة البيع (Client)

| # | Feature | Legacy | New |
|---|---------|--------|-----|
| 1 | شاشة بيع | ✅ | touch-friendly grid |
| 2 | باركود / بحث | ✅ | instant search |
| 3 | Price checker | ✅ | |
| 4 | خصومات | ✅ | item + user + offer |
| 5 | مندوب / حساب | ✅ | shortcuts |
| 6 | قسيمة | ✅ | |
| 7 | إرجاع / هدية / آجل | ✅ | receipt kinds |
| 8 | Hold receipts | ✅ | |
| 9 | طباعة | ✅ | thermal + A4 |
| 10 | Offline | ✅ | SQLite + sync |
| 11 | بصمة ZK | ✅ | |
| 12 | ميزان | ✅ | scale COM/TCP |
| 13 | VFD display | ✅ | |
| 14 | MPOS/Taif | ✅ | card terminal |
| 15 | بداية/نهاية يوم | ✅ | |
| 16 | تقرير صندوق | ✅ | |
| 17 | SignalR sync | ✅ | replaces :9653 |

### 6.3 خصائص إضافية (جديدة)

| # | Feature | Tables |
|---|---------|--------|
| 1 | قواعد العمولات | ext_commission_rules |
| 2 | حساب العمولات | ext_commission_calculations |
| 3 | أهداف المبيعات | ext_target_rules |
| 4 | تتبع الأهداف | ext_target_progress |
| 5 | ربط موظف↔منتج | ext_employee_products |
| 6 | مستخدمين الويب | ext_users |
| 7 | سجل terminals جديد | ext_pos_terminals |
| 8 | مزامنة سحابية | ext_cloud_* (Phase 5) |
| 9 | تطبيق موظف | Flutter (Phase 5) |

---

## 7. مراحل التنفيذ

### Phase 0 — Foundation (أسبوع 1)
- [ ] Restore `FOT_POS_V2` من backup
- [ ] Solution .NET 9 + CI
- [ ] EF Core scaffold من 49 جدول
- [ ] API health + auth
- [ ] Admin shell (layout + login)

### Phase 1 — Core Data (أسبوع 2-3)
- [ ] Products API + Admin (49K pagination, search)
- [ ] Offers engine (نفس pricing logic)
- [ ] Receipts read-only + search
- [ ] Salesmen, cashiers, sections CRUD

### Phase 2 — Admin Complete (أسبوع 4-6)
- [ ] Permissions matrix
- [ ] Reports (movement, daily sales)
- [ ] Print templates
- [ ] Vouchers, accounts, delivery
- [ ] Commissions + targets modules

### Phase 3 — POS Client (أسبوع 7-10)
- [ ] WPF sales screen
- [ ] SQLite offline cache
- [ ] SignalR catalog sync
- [ ] Receipt write (FOT-compatible schema)
- [ ] Printer integration

### Phase 4 — Edari Integration (أسبوع 11-12)
- [ ] Hangfire sync jobs
- [ ] FOT_Reciepts / FOT_Reciept_Items
- [ ] edr_num + synced flags
- [ ] Admin sync monitor

### Phase 5 — Pilot + Polish (أسبوع 13-14)
- [ ] Deploy on one terminal
- [ ] Performance tuning
- [ ] Fingerprint + scale + MPOS
- [ ] Parallel run with legacy

### Phase 6 — Cloud + Mobile (لاحقاً)
- [ ] Cloud sync agent
- [ ] Flutter employee app

---

## 8. أهداف الأداء

| Metric | Target |
|--------|--------|
| Product search (API) | < 30ms p95 |
| Receipt save (local SQLite) | < 10ms |
| Admin page load | < 800ms |
| SignalR push latency | < 100ms |
| Catalog sync (full 49K) | < 60s |
| Offline → online sync | < 5s / 100 receipts |

---

## 9. المنافذ

| Service | Port |
|---------|------|
| API + SignalR | 5000 |
| Admin (Blazor) | 5001 |
| Redis | 6379 |
| SQL Server | 1433 |
| Legacy FOT (parallel) | 9653 |

---

## 10. قرارات تحتاج موافقتك

| # | السؤال | التوصية |
|---|--------|---------|
| 1 | Admin UI: Blazor أم React? | **Blazor Server** — .NET واحد، أسرع تطوير، RTL جيد |
| 2 | POS: WPF أم WinUI 3? | **WPF** — أكثر نضجاً للـ hardware drivers |
| 3 | اسم قاعدة النسخة | `FOT_POS_V2` |
| 4 | هل نستورد منتجات جديدة من HAYAT2025 تلقائياً؟ | job يومي one-way (اختياري) |
| 5 | Edari: متى نبدأ؟ | Phase 4 — بعد POS يعمل |

---

## 11. الخطوة التالية

**بانتظار موافقتك على:**
1. Stack (.NET 9 + WPF + Blazor)
2. اسم DB `FOT_POS_V2`
3. UI style (Enterprise Clean)
4. ترتيب المراحل

**بعد الموافقة:** Phase 0 — restore DB + scaffold solution
