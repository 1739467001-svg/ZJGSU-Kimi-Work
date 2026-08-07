# 商大元境 · CampusTwin X

浙江工商大学下沙校区 3D 数字孪生智能平台。

- **3D 校园**:基于 OpenStreetMap 真实布局烘焙,422 栋楼宇、道路/水系/植被,
  综合大楼(新月形弧板 + 12m 玻璃金字塔)、图书馆、信电楼、文体中心、
  南门飞翔门、北门地球门(凯旋门)地标精模
- **真实昼夜**:suncalc 太阳方位驱动,黎明/白天/黄昏/夜晚全自动流转,
  支持锁定任意时刻;天气(雨/雪/雾)、四季、人流仿真
- **AI 指挥台**:一句话指挥校园——找会议室、报修、校园态势、逛校园、导航,
  支持语音输入;`src/lib/datasource/` 预留真实后端适配层
- **场景生命力**:流动云层、飞鸟群、旗帜、喷泉、夜间全灯

## 本地开发

```bash
npm ci
npm run dev        # 默认 5173 端口
```

演示参数:`?t=HH:MM` 锁定时刻 · `?q=low|medium|high` 锁画质 · `?mode=workbench` 定模式

## 构建与部署

```bash
npm run build      # 产物 dist/(纯静态,无需 Node 运行时)
```

**云服务器部署见 [DEPLOY.md](DEPLOY.md)**:Docker 一键(推荐)、手动 Nginx、静态托管三种方式,
配套 `Dockerfile` + `nginx.conf` 已随仓库提供。

## 技术栈

React 19 · TypeScript · Vite · Three.js / @react-three/fiber / drei · zustand · ECharts

## 协作约定

**每次功能更新完成后,全部改动提交并推送到本仓库 main 分支。**

## 数据来源

校园底图 © OpenStreetMap contributors;建筑形态参照校方公开资料与实景照片调研(`ref-photos/`)。
