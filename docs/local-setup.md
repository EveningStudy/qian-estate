# 本地运行与小程序导入

## 环境和命令

需要 Node.js 24 或更新版本。在项目根目录复制 [.env.example](../.env.example) 为 `.env`，勿覆盖现有文件。模板默认开发接口和演示小程序。

```powershell
npm ci
npm run dev
```

接口 `http://127.0.0.1:4310`，浏览器 `http://127.0.0.1:4311`。接口开发、正式启动、角色维护和小程序构建命令已自动读取根目录 `.env`。生产检查读取 `deploy/.env.production`；备份命令仍需显式进程环境。

| 命令                                 | 用途                       |
| ------------------------------------ | -------------------------- |
| `npm run dev:api`、`npm run dev:web` | 独立启动服务               |
| `npm run build:web`                  | 类型检查和网页构建         |
| `npm run build:mini`                 | 读取环境构建两个小程序     |
| `npm run build:mini:demo`            | 显式演示构建               |
| `npm run build`                      | 类型、网页及双端构建       |
| `npm test`                           | 接口与小程序测试           |
| `npm run test:deploy`                | 部署配置测试               |
| `npm run test:e2e`                   | 冒烟检查，不能替代真机测试 |
| `npm run check:production`           | 生产配置检查，不外呼       |

## 小程序

演示可执行 `npm run build:mini:demo`。正式构建设置 `MINI_MODE=production`、真实 `MINI_API_BASE_URL`、双端 `WECHAT_OWNER_APPID` 和 `WECHAT_AGENT_APPID`，并使 `PRIVACY_VERSION` 与服务器一致。秘密只留服务端。

构建后分别导入 `D:/Dev/Projects/qian-estate/dist/mini-owner`、`D:/Dev/Projects/qian-estate/dist/mini-agent`，它们包含 `app.json` 和 `project.config.json`。生产开启域名校验；演示才使用游客编号。默认占位域名不能上线。

手机回环地址不是电脑，真机需 HTTPS 受控服务。两端新账号均为业主，经审核才成为经纪人；AppID 隔离，不自动合并，按目录协作。

完整环境变量、管理员授权、服务路由、手动发布与 Docker 说明见[生产交接](production-handover.md)和[部署说明](../deploy/README.md)。
