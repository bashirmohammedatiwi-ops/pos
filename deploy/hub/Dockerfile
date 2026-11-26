# Node 24: قاعدة node:sqlite المدمجة لتطبيق الفريق (بلا مكتبات أصلية)
FROM node:24-alpine
# ffmpeg: تحويل الرسائل الصوتية إلى M4A/AAC كي تعمل على الآيفون والأندرويد معاً
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY *.js ./
ENV PORT=4705
EXPOSE 4705
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
