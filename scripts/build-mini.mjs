import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const mode = process.env.MINI_MODE || "production";
if (!["demo", "production"].includes(mode))
  throw new Error("MINI_MODE 仅允许 demo 或 production");
const baseURL = (
  process.env.MINI_API_BASE_URL ||
  (mode === "demo" ? "http://localhost:4310" : "https://api.example.invalid")
).replace(/\/$/, "");
const url = new URL(baseURL);
if (mode === "production" && url.hostname.endsWith(".invalid"))
  throw new Error("请配置真实 MINI_API_BASE_URL，不允许 .invalid 域名");
const privacyVersion = process.env.PRIVACY_VERSION || "2026-09-09";
if (!privacyVersion.trim() || privacyVersion.length > 100)
  throw new Error("PRIVACY_VERSION 必须为1至100字符");
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/" ||
  (mode === "production" && url.protocol !== "https:")
)
  throw new Error("生产 API 必须是无凭据、无路径的 HTTPS 源地址");
const roles = await Promise.all(
  ["owner", "agent"].map(async (role) => ({
    ...JSON.parse(
      await readFile(resolve(root, "mini/roles", role + ".json"), "utf8"),
    ),
    appid:
      process.env["WECHAT_" + role.toUpperCase() + "_APPID"] ||
      (mode === "demo" ? "touristappid" : ""),
  })),
);
for (const role of roles)
  if (mode === "production" && !/^wx[a-f0-9]{16}$/i.test(role.appid))
    throw new Error("请设置真实 WECHAT_" + role.role.toUpperCase() + "_APPID");
const pages = [
  "home",
  "listings",
  "workspace",
  "messages",
  "profile",
  "detail",
  "form",
  "feed",
  "cards",
].map((name) => "pages/" + name + "/index");
async function writeIfChanged(path, content) {
  try { if(await readFile(path,'utf8')===content)return; }catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(path,content);
}
for (const role of roles) {
  const out = resolve(root, "dist/mini-" + role.role);
  // 保留用户在开发者工具中填写的测试应用编号，不覆盖私有工程设置。
  let previous = {};
  try { previous = JSON.parse(await readFile(resolve(out,'project.config.json'),'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  await mkdir(out, { recursive: true });
  await cp(resolve(root, "mini/shared"), out, { recursive: true });
  await writeIfChanged(
    resolve(out, "config.js"),
    "module.exports = " +
      JSON.stringify(
        { role: role.role, name: role.name, mode, baseURL, privacyVersion },
        null,
        2,
      ) +
      ";\n",
  );
  const json = (name, data) =>
    writeIfChanged(resolve(out, name), JSON.stringify(data, null, 2) + "\n");
  await json("app.json", {
    pages,
    // 小型单包不启用按需注入，避免共享页面工厂与热重载导致未注册的白屏页。
    __usePrivacyCheck__: true,
    window: {
      navigationBarTitleText: role.name,
      navigationBarBackgroundColor: "#ffffff",
      navigationBarTextStyle: "black",
      enablePullDownRefresh: true,
    },
    tabBar: {
      color: "#6f7c83",
      selectedColor: "#256b65",
      backgroundColor: '#ffffff',
      borderStyle: 'white',
      list: (role.role === 'owner' ? [['home','首页'],['listings','找房'],['messages','消息'],['profile','我的']] : [['home','首页'],['listings','房源'],['workspace','工作台'],['messages','消息'],['profile','我的']]).map(([name,text]) => ({
        pagePath: 'pages/'+name+'/index',
        text,
        iconPath: 'assets/tab/'+name+'-normal.png',
        selectedIconPath: 'assets/tab/'+name+'-active.png',
      })),
    },
  });
  for (const page of pages)
    await json(page + ".json", { navigationBarTitleText: role.name });
  await json("project.config.json", {
    ...previous,
    appid: mode === 'demo' && !process.env['WECHAT_'+role.role.toUpperCase()+'_APPID'] && previous.appid ? previous.appid : role.appid,
    projectname: "qian-" + role.role,
    compileType: "miniprogram",
    miniprogramRoot: "./",
    setting: { ...previous.setting, es6: true, minified: true, urlCheck: mode === "production" },
  });
}
console.log("已构建双端小程序，模式：" + mode);
