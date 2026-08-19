# 启咨（Qizī）前端

React + Vite + TypeScript 前端工作台，默认连接 `http://localhost:8000/api`。

## 开发

```bash
npm install
npm run dev
```

可通过 `VITE_API_BASE_URL` 覆盖 API 地址，通过 `VITE_USER_ID` 设置开发身份。

## 构建

```bash
npm run build
```

当前页面包含项目总览、开发阶段与阶段工作台（任务依赖/阻塞、交付物与验收）、我的任务、成员管理，以及 Sprint 兼容视图（燃起图、范围变更时间线、看板）。
