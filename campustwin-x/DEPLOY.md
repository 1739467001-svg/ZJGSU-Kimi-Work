# 部署指南 · 商大元境 CampusTwin X

平台是纯静态单页应用(Vite + React + Three.js),构建产物为 `dist/` 目录,
**无需 Node 运行时**,任何静态服务器/对象存储/CDN 都能跑。以下按推荐顺序给出三种部署方式。

---

## 方式一:Docker(推荐,云服务器一键部署)

服务器只需安装 Docker。在项目根目录执行:

```bash
# 1. 构建镜像(约 2-5 分钟)
docker build -t campustwin-x .

# 2. 运行(80 端口;若被占用改左侧端口,如 8080:80)
docker run -d --restart unless-stopped -p 80:80 --name campustwin campustwin-x

# 3. 验证
curl -I http://服务器IP/
```

更新版本:

```bash
git pull                      # 拉取最新代码(我们的约定:每次更新都会推送到 GitHub)
docker build -t campustwin-x .
docker rm -f campustwin
docker run -d --restart unless-stopped -p 80:80 --name campustwin campustwin-x
```

镜像内是 Nginx(配置见 `nginx.conf`):SPA 回退、gzip、`/assets` 一年长缓存、入口页不缓存。

## 方式二:手动 Nginx(服务器已有 Nginx 时)

```bash
# 本地或服务器上构建
npm ci && npm run build        # 产物在 dist/

# 上传到服务器(以 /var/www/campustwin 为例)
scp -r dist/* root@服务器IP:/var/www/campustwin/
```

然后把 `nginx.conf` 的 `root` 改为 `/var/www/campustwin`,放入服务器
`/etc/nginx/conf.d/campustwin.conf`,`nginx -s reload` 生效。

## 方式三:静态托管(零运维)

`dist/` 可直接丢到 Vercel / Netlify / 阿里云 OSS+CDN / 腾讯云 COS。
注意两条规则与 `nginx.conf` 保持一致:① 所有路径回退 `index.html`;② `/assets/*` 长缓存。

---

## 上线前 checklist

| 项 | 说明 |
|---|---|
| 域名与 HTTPS | 语音输入(Web Speech API)**必须 HTTPS 或 localhost** 才可用;建议域名 + Let's Encrypt 免费证书(`certbot --nginx`) |
| 端口放行 | 云服务器安全组放行 80/443 |
| 服务器配置 | 静态站点,1 核 1G 足够;首屏资源 gzip 后约 430KB |
| 演示参数 | URL 支持 `?t=HH:MM` 锁时刻、`?q=low\|medium\|high` 锁画质、`?mode=workbench` 定模式 |

## 未来接真实后端

`src/lib/datasource/` 已预留 HttpDataSource(见该目录 README):真实后端就绪后
只需在 `main.tsx` 调一次 `configureDataSource({ http: { baseUrl, token } })`,
无需改动任何 handler。届时建议在 Nginx 增加 `/api/` 反代到后端服务。
