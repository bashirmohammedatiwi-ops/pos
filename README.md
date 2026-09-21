# FOT POS — .NET 9 Platform

## البنية

```
src/
├── FOT.Pos.Api/          ASP.NET Core 9 — REST API (port 5000)
├── FOT.Pos.Admin/        WPF Desktop — لوحة التحكم
├── FOT.Pos.Client/       WPF Desktop — نقطة البيع (Phase 3)
├── FOT.Pos.Infrastructure/
├── FOT.Pos.Shared/
└── ...
```

## قاعدة البيانات

- **FOT_POS_V2** — نسخة مستقلة (لا تلمس HAYAT2025 الأصلية)
- Restore: `database/backups/` (see scripts)

## التشغيل

### 1. API
```powershell
dotnet run --project src/FOT.Pos.Api
```
→ http://localhost:5000 | Swagger: /swagger | SignalR: /hubs/pos

### 2. لوحة التحكم (Electron)
```powershell
cd desktop
npm install
npm run admin
```
**Login:** `admin` / `admin123`

الواجهة نفسها تعمل في المتصفح: `cd web/fot-admin && npm run dev` → http://localhost:5173

### 3. نقطة البيع / الكاشير (Electron)
```powershell
cd desktop
npm install
npm run pos
```
**Login:** حساب كاشير من جدول `cashiers` (نفس النظام الحالي)

يمكن فتح الواجهة في المتصفح أثناء التطوير: http://localhost:5174

تطبيقات WPF (`FOT.Pos.Admin` و `FOT.Pos.Client`) تبقى احتياطاً — الـ API لم يتغيّر.

## ويب البائعين (الهاتف)

```powershell
cd web/fot-seller
npm install
npm run dev
```

→ http://127.0.0.1:4701

## الرفع إلى السيرفر (VPS)

المحل يحتفظ بنقطة البيع وSQL. السيرفر يشغّل ويب البائعين على المنافذ **4700–4704**. من جهاز المحل شغّل `تشغيل-نفق-المحل.bat`.

```bash
git clone https://github.com/bashirmohammedatiwi-ops/pos.git
cd pos/deploy
cp .env.example .env
# اترك FOT_SHOP_API_URL=http://host.docker.internal:15000 وافتح نفق المحل
chmod +x up.sh
./up.sh
```

التفاصيل: [`deploy/README.md`](deploy/README.md)

## LAN

غيّر `ApiBaseUrl` في `src/FOT.Pos.Admin/appsettings.json` إلى IP السيرفر:
```json
{ "ApiBaseUrl": "http://192.168.x.x:5000" }
```

## العملة

دينار عراقي — أرقام إنجليزية (1,234,567 د.ع)
