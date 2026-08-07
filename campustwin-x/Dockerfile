# 商大元境 · CampusTwin X —— 云服务器部署镜像
# 构建:docker build -t campustwin-x .
# 运行:docker run -d -p 80:80 --name campustwin campustwin-x

# ---------- 构建阶段 ----------
FROM node:20-alpine AS build
WORKDIR /app

# 仅拷贝依赖清单,利用 Docker 层缓存(依赖不变则跳过安装)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 拷贝源码并产出 dist/(构建= tsc -b && vite build)
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM nginx:1.27-alpine
# SPA 回退 + gzip + 静态资源缓存策略
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
