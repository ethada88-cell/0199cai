# 隐藏弹窗独立镜像，无 npm 依赖，直接跑 node server/index.mjs
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=18471
ENV DATA_DIR=/data
COPY package.json ./
COPY server ./server
COPY public ./public
EXPOSE 18471
CMD ["node", "server/index.mjs"]
