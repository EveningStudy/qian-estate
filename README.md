# 栖岸房产协作平台

面向房产交易与经纪人协作的双端微信小程序项目，包含业主端、经纪人端、网页管理后台和共用服务端。支持房源展示、委托卖房、看房预约、联卖协作与客户管理，提供本地演示、部署配置及交接文档。

项目目前处于开发与交接阶段，正式上线前仍需完成平台资质配置、外部服务联调和微信真机验收。

交接请先阅读 [交付先读.md](交付先读.md)。最后一轮导航修复已完成本地代码验证，但未重新进行模拟器鼠标点击与真机验收。

包含业主小程序“栖岸”、经纪人小程序“栖岸联卖”、浏览器管理后台及共用服务端。已实现业务流程与外部服务适配代码；**本地测试不等于真实服务联调，尚无生产可用结论。**

## 开始运行

需要 Node.js 24 或更新版本。在项目根目录复制 [.env.example](.env.example) 为 `.env`，已有文件不要覆盖，然后执行：

```powershell
npm ci
npm run dev
```

`dev:api`、`start`、`build:mini`、`account:role` 已通过 `--env-file-if-exists=.env` 自动读取根目录环境文件。浏览器为 `http://127.0.0.1:4311`，接口为 `http://127.0.0.1:4310`。模板默认演示模式，真实密钥不得提交或进入交接包。

| 命令                                           | 用途                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| `npm run build:web`                            | 类型检查及浏览器构建                                   |
| `npm run build:mini`                           | 按环境文件构建双端小程序                               |
| `npm run build:mini:demo`                      | 显式构建演示小程序                                     |
| `npm test`                                     | 接口及原生小程序测试，拒绝零原生测试                   |
| `npm run test:deploy`                          | 部署配置测试，不启动 Docker                            |
| `npm run test:e2e`                             | 浏览器及接口冒烟，需按测试说明准备服务                 |
| `npm run check:production`                     | 读取 `deploy/.env.production` 检查配置，不验证真实凭据 |
| `npm run backup`                               | SQLite 与本地上传备份，不备份 S3 对象                  |
| `npm run account:role -- UUID admin --confirm` | 服务器维护人员授予已注册真实账号管理员角色             |

## 当前功能

- 微信双端登录、手机号授权、经纪人入驻审批、管理员一次性配对登录。
- 房源、委托、预约、联卖、客户、消息、收藏、反馈及审计。
- 腾讯地图查询、短信验证码、微信订阅意愿记录及管理员受控发送。
- 人工房源核验登记与生产发布门槛；生产文本内容安全检查。
- 上传按配置选择本地持久目录或私有 S3；图片访问经服务端控制。
- 微信支付只有签名、验签、解密等工具，**没有收款订单和回调业务路由**。身份证/人脸自动认证、住建平台自动核验、真实 VR、智能锁控制、网签尚未完成。人工房源核验已实现，不能与自动核验混淆。

## 正式身份规则

新用户从任一小程序注册都先是 `owner`。绑定手机号后提交 `/api/agent-applications`，管理员批准后成为经纪人并进入目录。两端按 `AppID + openid` 隔离，不按手机号或 `unionid` 自动合并；跨端通过经纪人目录协作。

初始管理员由受控服务器终端授权，旧会话失效后重新在小程序登录，生成一分钟配对码供浏览器后台一次性使用。正式浏览器只配对登录，不提供默认密码或角色选择登录。

生产拒绝既有演示数据库，应使用全新持久化目录。 `DEFAULT_AGENT_ID` 必须是实际启用的正式经纪人，不能填演示编号。

## 配置、部署与交接

双端凭据使用 `WECHAT_OWNER_APPID`、`WECHAT_OWNER_SECRET`、`WECHAT_AGENT_APPID`、`WECHAT_AGENT_SECRET`。生产需 `WECHAT_CONTENT_CHECK=true`，填写 `OPERATOR_NAME`、`SUPPORT_EMAIL`、`PRIVACY_VERSION`、公开地址及来源；完整变量表见[生产交接](docs/production-handover.md)。

小程序导入 `dist/mini-owner` 与 `dist/mini-agent`。生产模式必须使用真实双端应用编号和 HTTPS 接口地址。Docker 文件与启动步骤见 [deploy/README.md](deploy/README.md)，环境模板为 [deploy/.env.production.example](deploy/.env.production.example)。

交接包使用 `scripts/package-handover.ps1 -OutputDirectory <交接输出目录>`，生成 ZIP 和 SHA-256，按清单排除环境秘密、数据库、上传数据与依赖缓存。交付前仍需检查所选源码和静态资源中没有误放秘密或真实资料；该包不是数据备份。

## 本地验证

主项目提供的本地记录：接口 51 项，原生小程序 25 项，部署配置 8 项，浏览器 2 项通过。接口历史记录曾为 50 通过、1 待完成，已更新；详细结果以主项目最新测试报告为准，不能将待完成算通过。

当前环境 Docker 不在 PATH，容器构建、HTTPS 握手、真机、真实微信/短信/地图/S3/支付均未完成远端验收。

## 文档

- [生产交接与环境变量](docs/production-handover.md)
- [本地命令和小程序导入](docs/local-setup.md)
- [架构和角色矩阵](docs/architecture.md)
- [测试与验收](docs/qa.md)
- [发布检查](docs/release.md)
- [安全、隐私和数据留存](docs/security-and-limitations.md)
- [部署操作](deploy/README.md)
- [服务端接口](server/API.md)
