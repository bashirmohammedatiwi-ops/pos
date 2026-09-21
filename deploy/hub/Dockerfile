FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV PORT=4705
EXPOSE 4705
CMD ["node", "server.js"]
