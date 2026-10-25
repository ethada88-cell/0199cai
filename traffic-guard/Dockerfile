FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci
COPY . .
RUN npm run build
ENV TZ=Asia/Shanghai
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
  && DEBIAN_FRONTEND=noninteractive apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tzdata \
  && ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo Asia/Shanghai > /etc/timezone \
  && rm -rf /var/lib/apt/lists/*
EXPOSE 43127
# 原生 check 前置扛洪峰，Next 只跑在 127.0.0.1:43126
CMD ["sh", "/app/server/start.sh"]
