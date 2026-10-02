# 栖岸原生微信小程序

代码仅使用原生 JS、WXML、WXSS、微信网络及媒体接口，无网页容器。共享源码在 `mini/shared`，双端名称配置在 `mini/roles`。生成目录分别为 `dist/mini-owner`、`dist/mini-agent`，各自包含完整小程序与项目配置，可以分别导入微信开发者工具。

## 构建与环境隔离

默认 `MINI_MODE=production`。生产必须配置两个真实 AppID，缺失会在写出前报错；API 必须使用 HTTPS。未指定 API 时使用不可访问的 HTTPS 保留域名 `https://api.example.invalid`，绝不自动连接演示服务。正式使用必须配置实际地址及微信合法域名。

```powershell
$env:MINI_MODE='production'
$env:WECHAT_OWNER_APPID='微信业主小程序的真实AppID'
$env:WECHAT_AGENT_APPID='微信经纪人小程序的真实AppID'
$env:MINI_API_BASE_URL='https://你的实际服务域名'
node scripts/build-mini.mjs
```

仅显式演示模式允许游客 AppID 和本地 API：

```powershell
$env:MINI_MODE='demo'
$env:MINI_API_BASE_URL='http://localhost:4310'
node scripts/build-mini.mjs
node mini/tests/static.mjs
node --test mini/tests/*.test.cjs
```

测试文件名已对齐根目录 `node --test mini/tests/*.test.cjs`，不需要修改根目录包配置。生产构建开启域名检查；演示构建关闭。手机不能以 localhost 访问开发电脑；本地演示登录还有服务端回环地址限制，不能把工具模拟器测试当作手机联调。

## 登录、隐私与角色

- 用户必须在个人中心勾选隐私同意并点击登录；生产调用微信隐私授权、`wx.login`，然后 `POST /api/auth/wechat/login`。请求为 `{code,app:'owner'|'agent',privacyVersion:'2026-09-09'}`；当前 `server/src/auth.ts` 要求额外的隐私版本，不能省略。隐私版本应与发布时的平台隐私声明同步。
- 失败、隐私拒绝、401、刷新或退出都不会自动演示登录。只有显式演示模式点击登录才请求 `/api/auth/demo`。
- 令牌按模式和小程序端分别保存。角色始终读取服务器 `user.role`；打开经纪人端不会把业主升级为经纪人。
- 手机号按钮使用 `open-type="getPhoneNumber"`，只向 `POST /api/auth/wechat/phone` 提交 `{code}`。不提交 app、手机号明文或旧版 encryptedData；应用端由服务器会话确定。
- 经纪人入驻使用 `POST /api/agent-applications`：`{name,company,licenseNumber,city,phone}`。先绑定本人微信手机号，再填写相同号码。个人中心通过 `GET /api/agent-applications` 展示待审核、通过、拒绝与审核说明，刷新用户资料后才显示新角色权限。
- 退出先调用 `POST /api/auth/logout` 撤销会话，成功后清除令牌、资料与页面栈，留在未登录个人中心。撤销失败显示错误，不伪称已退出。

## 业务接口与字段

所有业务数据来自服务器，没有本地成功数据。普通页面读取 `/api/bootstrap`，详情另行读取 `GET /api/properties/:id`，失败不回退旧列表。浏览数仅展示服务器演示计数，GET 不累加，客户端不制造实时分析。

| 操作 | 字段与约束 |
| --- | --- |
| 房源创建 | `POST /api/properties`：`title,community,city,district,address,price,area,rooms`；可选 `floor,orientation,decoration,description,images` |
| 编辑自有房源 | `PUT /api/properties/:id`，仅提交表单白名单字段，不提交 ownerId/status 等；在售编辑后重新审核 |
| 出售委托/电话回访 | `propertyId` 或 `community,area,price`；`contactName,phone,note,city`。电话回访作为委托备注保存 |
| 预约 | `propertyId,scheduledAt`；可选 `contactName,phone,note`。日期和时间用原生选择器，提交未来的带时区 ISO 时间 |
| 联卖 | `propertyId,targetAgentId?,note?`，仅选择其他经纪人负责的在售房源 |
| 客户 | `name,phone?,budget?,preference?,note?` |
| 消息 | `recipientId,content,propertyId?`，主路径按联系人名称选择或从会话回复，不要求手填 ID |
| 反馈/问题 | `content,category?,contact?` / `question,propertyId?,category?` |
| 门锁申请 | `propertyId,reason`；只允许业主或负责经纪人。批准不触发开锁 |
| 资料 | `PUT /api/profile`：`name,phone,city,bio`，不提交整个用户记录 |
| 估值 | `POST /api/valuation`：`area,community,city`，展示 `low,high,unit,method,disclaimer`，不能当作专业估价 |

其余创建统一 `POST /api/:collection`。工作台根据真实关系生成 `PATCH /api/:collection/:id {status}` 按钮：业主委托和预约取消；负责经纪人受理/拒绝/完成；合作接收人受理/拒绝/完成，发起人取消；客户联系/转化/归档/恢复；门锁申请人取消，业主审核其他人的申请或撤销批准。服务器再次验证权限与状态，不在客户端伪造变更。

## 图片与详情

使用 `wx.chooseMedia({mediaType:['image']})`，通过文件系统 `readFile` 读取 ArrayBuffer，按文件签名识别 PNG/JPEG，以对应 Content-Type 原始字节 `POST /api/uploads`，限制每张5MB、房源最多12张。只有服务器返回有效 `{url}` 才加入图片数组；创建/编辑提交这些 URL。分批失败保留此前已上传照片并显示错误，不伪造上传成功。移除照片仅移除待保存引用，不删除服务器文件；上传后未保存可能留下待清理文件。

展示服务器 `images`，支持 `/assets` 与 `/uploads`；详情包括房型、楼层、面积、朝向、装修、年份、状态、发布时间、标签、交易信息。税费 `tax/taxInfo`、居住 `occupancy/occupancyStatus`、抵押 `mortgage`、看房 `viewing/viewingArrangement`、备注 `notes/note` 可位于顶层或 `transactionInfo`。缺失展示“未提供”，不编造截图数据；私有备注仅展示服务器授权返回的字段。

## 验证边界

静态检查扫描双端所有 JS 语法、JSON、WXML 标签栈、属性引号、页面导航及事件处理器，并包含错误嵌套的反例测试。逻辑测试在隔离环境加载实际共享源码，模拟 `wx/Page/getApp`，不复制业务函数来测试自己。

未使用真实微信账号、微信开发者工具或设备验收，不宣称原生运行时验证。生产联调仍需真实 AppID、合法 HTTPS 域名、隐私指引、微信服务器凭据和审核流程。未接入支付、VR 或真实门锁，不模拟这些能力。服务器未返回联系人姓名时显示“业务联系人/会话联系人”，不会根据 ID 捏造姓名。
