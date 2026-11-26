FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
# موقع الفريق: نفس تطبيق الهاتف (كل خصائصه) كموقع تحت /staff/ — للآيفون والحاسبة
ARG TEAM_APP_VERSION=2.4.0
RUN VITE_TARGET=app VITE_WEB=1 VITE_APP_VERSION=$TEAM_APP_VERSION npx vite build --base /staff/ --outDir dist/staff --emptyOutDir

FROM nginx:1.27-alpine
ENV NGINX_ENVSUBST_FILTER=FOT_SHOP_API_URL
ENV FOT_SHOP_API_URL=http://host.docker.internal:5000
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
