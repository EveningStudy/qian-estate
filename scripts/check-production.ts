import { loadConfig } from "../server/src/config.js";
import { loadIntegrationConfig } from "../server/src/integrations.js";
import { loadObjectStorageConfig } from "../server/src/object-storage.js";
import { existsSync } from "node:fs";

// 不外呼、不打印密钥、不创建数据库，适合交接前运行。
let failures = 0;
function check(name: string, run: () => void) {
  try {
    run();
    console.log(`通过：${name}`);
  } catch (error) {
    failures++;
    console.log(
      `未通过：${name} — ${error instanceof Error ? error.message : "配置异常"}`,
    );
  }
}
check("生产基础配置", () => {
  loadConfig({ ...process.env, NODE_ENV: "production" });
});
check("地图、短信、支付配置格式", () => {
  loadIntegrationConfig();
});
check("对象存储配置格式", () => {
  loadObjectStorageConfig();
});
check("生产文本安全检查", () => {
  if (process.env.WECHAT_CONTENT_CHECK !== "true")
    throw new Error(
      "需要设置 WECHAT_CONTENT_CHECK=true 并在微信后台开通对应接口。",
    );
});
check("运营者信息", () => {
  for (const name of [
    "OPERATOR_NAME",
    "SUPPORT_EMAIL",
    "PRIVACY_VERSION",
    "PUBLIC_APP_URL",
  ])
    if (!process.env[name]) throw new Error(`尚未填写 ${name}。`);
});
check("构建所需文件", () => {
  for (const path of [
    "package-lock.json",
    "deploy/Dockerfile",
    "deploy/nginx.conf",
    "mini/shared/app.js",
  ])
    if (!existsSync(path)) throw new Error(`缺少 ${path}。`);
});
console.log(
  "本检查不验证凭证真实性、备案、资质、微信审核或真实业务；这些仍需部署方联调。",
);
process.exitCode = failures ? 1 : 0;
