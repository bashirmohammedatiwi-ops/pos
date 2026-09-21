# FOT POS Desktop (Electron)

غلاف سطح مكتب للواجهتين. الـ API يبقى ASP.NET على المنفذ 5000.

```powershell
# 1) شغّل الـ API أولاً
dotnet run --project ../src/FOT.Pos.Api

# 2) لوحة التحكم
npm install
npm run admin

# 3) الكاشير
npm run pos
```

- Admin renderer: `web/fot-admin` (المنفذ 5173)
- Cashier renderer: `web/fot-pos` (المنفذ 5174)

## الكاشير — ما يعمل الآن

- بيع نقدي وبطاقة (جهاز PAX عبر الخدمة المحلية، عادة `localhost:9092`)
- طباعة إيصال حراري صامتة بعد البيع، وإعادة طباعة بـ F9
- كتالوج محلي (SQLite في Electron، IndexedDB احتياطي في المتصفح) + رفع الفواتير عند عودة الاتصال إذا كانت النقطة تسمح بالأوفلاين

## التثبيت

```powershell
npm run dist
```

ينتج `desktop/dist/FOT POS Setup.exe` مع اختصارين: كاشير (`--pos`) وإدارة (`--admin`).

عند التشغيل المعبّأ يحاول التطبيق تشغيل خدمة Windows `FOTPOSServer` (من مثبّت السيرفر)، أو `FOT.Pos.Api.exe` من `Program Files\FOT POS\Server\Api`.
