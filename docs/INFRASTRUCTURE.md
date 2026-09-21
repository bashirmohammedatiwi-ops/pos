# البنية التحتية للمزامنة والتتبع — FOT POS

> تحديث 2026-09-09: خطة تطوير البنية التحتية المنفذة (المراحل 1-5 + إصلاح migrations)

## نظرة عامة على التدفق

```
Edari (NexusDB)                      API (.NET 9, :5000)                    نقاط البيع
─────────────────                    ────────────────────                    ──────────
File13n/File11n/FileBrch  ──(سحب)──▶  SQL Server FOT_POS_V2  ──(بث إصدار+نطاق)──▶  مزامنة انتقائية
مراقبة مجلد + بصمة كل 30ث            catalog_version دائم                     طابور offline + heartbeat
                                     القاطع يحمي الاتصال                       (عداد طابور + إصدار)
FOT_Reciepts/FilePOS5/4 ◀──(ترحيل)── reciepts.synced طابور ◀──(POST /receipts)── clientReceiptId
backoff تصاعدي + dead-letter         idempotent
```

## حماية الإداري (أولوية قصوى)

| الآلية | التفصيل |
|---|---|
| قاطع دائرة | `EdariSyncGate`: 3 إخفاقات متتالية → إيقاف كل نداءات NexusDB 60ث تتصاعد ×2 حتى 10د. «اختبار اتصال» يتجاوزه ويعيد ضبطه عند النجاح |
| مهلة موحدة | `CreateEdariCommand()` يفرض `CommandTimeout=20s` على كل أمر NexusDB |
| بصمة خفيفة | استعلام واحد بدل ~10 كل دورة فحص (افتراضي 30ث، قابل للضبط من `ext_edari_settings.detect_seconds`) |
| فصل الحلقات | سحب الكتالوج وترحيل الفواتير يعملان على إيقاعين مستقلين في `EdariSyncBackgroundService` |

## طابور ترحيل الفواتير (reciepts)

- أعمدة: `sync_attempts, last_sync_attempt_at, next_sync_at, dead_letter, dead_reason` (migration 047)
- backoff: 2د → 5د → 15د → 30د → 60د، وبعد **10 محاولات** أو فشل بنيوي (صنف مفقود/قسم غير مربوط = `InvalidOperationException`) → dead-letter نهائي
- dead-letters تظهر في صفحة Edari مع السبب وزر «إعادة المحاولة» (`POST /api/edari/sync/receipts/{id}/retry` و `/retry-all`)

## التتبع والتشخيص

- **أخطاء الواجهات**: `POST /api/telemetry/errors` (دفعة ≤20، قناة غير محجوبة) → جدول `ext_client_errors` (048) → صفحة **صحة النظام** `/system`
- مراسل مشترك `web/packages/fot-shared/src/errorReporter.ts`: طابور localStorage + إرسال كل 30ث (سقف 50/دقيقة) — مربوط في admin وPOS
- **POS ErrorBoundary**: خطأ عرض لا يسقط الشاشة — أزرار «متابعة البيع»/«إعادة تشغيل» + إبلاغ تلقائي
- **سجل طلبات**: Serilog request logging مع المدة والمستخدم؛ >1ث → Warning
- نبضة نقطة البيع تحمل: عداد فواتير offline المعلقة + المتوقفة + إصدار الكتالوج → تظهر في المراقبة

## دفع الكتالوج Admin→POS

- **إصدار دائم**: `ext_catalog_version` (migration 049) — لا يعود للصفر عند إعادة التشغيل
- **نطاق البث**: `CatalogUpdated(version, scope)` حيث scope ∈ products|offers|accounts|settings|all — عروض/إعدادات/حسابات = مزامنة مرجعية فقط بلا سحب كتالوج كامل
- **علامة كل نقطة**: `point_of_sales.catalog_seq` (من `/api/catalog/sync?hwId=`) + `catalog_version` (من النبضة)

## أداء لوحة التحكم

- **استطلاع واعٍ بالـ hub** (`useSyncStatus`): مع اتصال SignalR تتوقف الفواصل السريعة (fallback أمان 5د)؛ عند الانقطاع فقط يرجع الاستطلاع السريع
- `GET /api/offers/stats` خفيف بدل جلب 100 عرض في اللوحة
- `EdariUpdated`: تقسيم الإبطال — dataChanged → كتالوج+إداري فقط؛ نبضة → بيانات حية+حالة (لا تكرار مزدوج)
- بائعون (500 صف): staleTime 10د + تحديث بالدفع فقط

## صلابة نقطة البيع

- بلاطات المجموعة المفتوحة تتحدث فعلياً عند تغيير الأسعار من الإدارة
- quick-sync بـ debounce 500مللي (كان فورياً على كل حدث)
- الفواتير المركونة (slots) محفوظة محلياً وتُستعاد بعد إعادة التشغيل

## Migrations — إصلاح جوهري

`043-046` كانت تستخدم `COL_LENGTH(OBJECT_ID(...))` وهو نمط خاطئ — **043 كان يفشل دائماً** (ALTER+UPDATE في batch واحد) و044-046 تتجاوز عملها بصمت، فتوقفت الـ migrations عند 42. صُححت الأنماط وتُطبق 43→49 بنجاح (متحقق حياً: schemaVersion=49، pendingMigrations=0).

## تشغيل نسخة جانبية

```powershell
$env:FOT_API_URL = "http://127.0.0.1:5050"; dotnet run --project src/FOT.Pos.Api
```

## النشر

1. `dotnet build FOT-POS.sln` + `npm run build` في `web/fot-admin` و`web/fot-pos`
2. `powershell -ExecutionPolicy Bypass -File scripts/Verify-Build.ps1` (يشمل OpenAPI drift)
3. استبدال binary الخادم وإعادة تشغيل الخدمة — الـ migrations الجديدة (047-049) تُطبق تلقائياً عند الإقلاع
4. تحديث dist تطبيقات المكتب عبر آلية publish-desktop المعتادة
