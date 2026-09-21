# FOT Web Hub (VPS)

نقطة البيع وSQL Server تبقى في المحل. هذا المجلد يشغّل ويب البائعين على السيرفر **دون المساس بمنافذ التطبيقات الأخرى**.

## المنافذ على السيرفر

| منفذ | الخدمة |
|------|--------|
| **4700** | البوابة العامة (يفتحها البائع) |
| **4701** | تطبيق البائعين مباشرة |
| **4702** | الموظفون — لاحقاً |
| **4703** | المدراء — لاحقاً |
| **4704** | نفق المحل (صادر من جهاز نقطة البيع) |

لا يُفتح 80 أو 443 أو 3000 أو 5000 من هنا. منفذ المحل **5000** يبقى داخل شبكة نقطة البيع.

## رفع المشروع من GitHub إلى الـ VPS

```bash
git clone https://github.com/bashirmohammedatiwi-ops/pos.git
cd pos/deploy
cp .env.example .env
```

اترك `FOT_SHOP_API_URL=http://host.docker.internal:15000` ثم افتح نفق المحل من جهاز نقطة البيع.

```bash
chmod +x up.sh
./up.sh
```

أو يدوياً:

```bash
docker compose up -d --build
```

ثم افتح `http://IP-السيرفر:4700`

افتح في جدار النار **4700–4704**. المنفذ 4704 لنفق المحل الصادر فقط.

## إذا ظهر «تعذر الاتصال بنقطة البيع» أو 502

ويب السيرفر لا يرى API المحل. يلزم أمران معاً: خادم نقطة البيع شغّال، وملف النفق مفتوح على جهاز المحل.

**على الـ VPS:**

```bash
cd pos
git pull origin main
sudo sh deploy/enable-host-tunnel.sh
cd deploy
./up.sh
```

أو فوراً بدون انتظار السحب:

```bash
ufw allow 4704/tcp || true
docker run -d --name shop-tunnel --network host --restart unless-stopped \
  jpillora/chisel:1.12.0 \
  server --reverse --port 4704 --auth fot:e7Kq9mN2pL4xW8vR
```

**على جهاز المحل — اترك النافذة مفتوحة:**

1. شغّل `FOT POS Server`.
2. انقر نقراً مزدوجاً `تشغيل-نفق-المحل.bat` على سطح المكتب.

إذا أُغلقت النافذة يعود خطأ الاتصال. النفق يعيد نفسه تلقائياً إذا انقطع الخط. لا يحتاج مستخدم SSH.

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
