# lcygzback 部署与项目更新记录

## 代码改动

- `package.json`
  - `scripts.start:prod` 改为使用实际构建产物入口：
    - 从 `node dist/main` → `node dist/src/main`
  - `dependencies` 新增运行时依赖：
    - `"multer": "^2.0.2"`（配合 `SubmissionsController` 中的 `diskStorage` 上传逻辑，防止生产环境 `MODULE_NOT_FOUND: multer`）

- `DEPLOYMENT.md`
  - PM2 启动命令示例更新为使用正确入口文件：
    - 从 `NODE_ENV=production pm2 start dist/main.js --name lcygzback`
    - 改为 `NODE_ENV=production pm2 start dist/src/main.js --name lcygzback`
  - systemd 部分说明同步更新：
    - `pnpm start:prod` 现在对应 `node dist/src/main`。

## 部署要点 / 踩坑总结

- Nest 构建输出结构为：
  - 入口文件：`dist/src/main.js`（不是 `dist/main.js`）。
- 使用 PM2 运行时的推荐命令：
  - 首次启动：`NODE_ENV=production pm2 start dist/src/main.js --name lcygzback`
  - 更新上线：`pnpm build && pm2 restart lcygzback`
- 上传相关模块依赖：
  - 必须在生产环境安装 `multer`，否则加载 `dist/src/submissions/submissions.controller.js` 时会抛出 `MODULE_NOT_FOUND: multer`。

## 当前状态

- 生产环境已按上述配置成功启动，PM2 运行正常、日志无入口文件缺失与 `multer` 模块缺失错误。
