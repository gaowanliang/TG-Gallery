# TG Gallery

快速、轻量、面向工程师的图床 + 画廊前端。

特点
- 轻量 Vue 3 前端（Vite），PhotoSwipe 集成用于大图查看
- 后端为 Serverless（Vercel），MongoDB 存储元数据
- 图片存储在 Telegram bot（可替换为任意对象存储）
- JWT 登录（可在 `api/login.js` 调整 expiresIn），可选 Cloudflare Turnstile

快速上手
1) 安装依赖

```bash
npm install
```

2) 复制并编辑环境变量

```bash
cp .env.example .env
# 编辑 .env 填入 MONGO_URI, BOT_TOKEN, JWT_SECRET 等
```

3) 开发

```bash
npm run dev
```

生产构建

```bash
npm run build
```

必要的 `.env` 变量
- MONGO_URI
- BOT_TOKEN
- JWT_SECRET
- TURNSTILE_SECRET_KEY（可选，开发环境可不设）
- VITE_TURNSTILE_SITE_KEY（如果启用 Turnstile）

项目结构（简要）

```
api/           # serverless handlers (login, gallery, fileurl)
src/           # 前端 (components, App.vue, style.css)
.env.example
package.json
```

开发者提示
- JWT 时长：在 `api/login.js` 的 `expiresIn` 设置，项目历史上可能被改为 `365d`。
- 本地开发：不设置 `TURNSTILE_SECRET_KEY` 将跳过 Turnstile 检查。
- 缓存：前端用 `localStorage` 做了 gallery 与图片 URL 缓存，cache-first 加载逻辑在 `Gallery.vue`。
- PhotoSwipe：在 `ImageDetail.vue` 以两步打开（先到详情页，点击图片再进 PhotoSwipe），便于自定义元信息展示。

技术栈
- 前端：Vue 3, Vite
- 大图查看：PhotoSwipe
- 后端：Node.js Serverless（Vercel）
- DB：MongoDB
- 存储：Telegram Bot

许可证：MIT

更多：阅读源码即可快速定位功能点（`api/login.js`, `src/components/Gallery.vue`, `src/components/ImageDetail.vue`）。
