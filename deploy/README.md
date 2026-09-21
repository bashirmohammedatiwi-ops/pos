# FOT Web Hub (VPS)

نقطة البيع وSQL Server تبقى في المحل. هذا المجلد يشغّل ويب البائعين على السيرفر **دون المساس بمنافذ التطبيقات الأخرى**.

## المنافذ على السيرفر

| منفذ | الخدمة |
|------|--------|
| **4700** | البوابة العامة (يفتحها البائع) |
| **4701** | تطبيق البائعين مباشرة |
| **4702** | الموظفون — لاحقاً |
| **4703** | المدراء — لاحقاً |

لا يُفتح 80 أو 443 أو 3000 أو 5000 من هنا. منفذ المحل **5000** يبقى داخل شبكة نقطة البيع.

## رفع المشروع من GitHub إلى الـ VPS

```bash
git clone https://github.com/bashirmohammedatiwi-ops/pos.git
cd pos/deploy
cp .env.example .env
```

عدّل `FOT_SHOP_API_URL` إلى عنوان يصل لواجهة المحل (`http://127.0.0.1:5000` عبر Cloudflare Tunnel أو Tailscale).

```bash
chmod +x up.sh
./up.sh
```

أو يدوياً:

```bash
docker compose up -d --build
```

ثم افتح `http://IP-السيرفر:4700`

افتح في جدار النار **4700–4703 فقط**.

## إذا ظهر «لا بائع» أو 502

ويب السيرفر لا يصل لواجهة المحل على `:5000`. الرمز المولَّد في لوحة التحكم صحيح، لكن السيرفر يحتاج نفقاً.

من جهاز المحل (بعد تثبيت خادم 2.2.63):

```powershell
powershell -File scripts\Start-ShopTunnel.ps1 -VpsUser YOUR_SSH_USER
```

على الـ VPS في `deploy/.env`:

```
FOT_SHOP_API_URL=http://host.docker.internal:5000
```

ثم `docker compose up -d`. لا تفتح المنفذ 5000 على السيرفر للعامة.

## تشغيل محلي

1. تأكد أن FOT POS API يعمل على `http://127.0.0.1:5000`
2. من مجلد `deploy`:

```bash
copy .env.example .env
docker compose up --build
```

ثم افتح `http://127.0.0.1:4700`

## ماذا تُمرَّر من البوابة؟

البوابة تمرّر فقط `/auth/seller-lookup` و`/auth/seller-login` و`/api/seller/`. باقي الـ API مرفوض.

الحسابات تُولَّد من لوحة تحكم المحل: **الفريق والحوافز → حسابات الويب**.
