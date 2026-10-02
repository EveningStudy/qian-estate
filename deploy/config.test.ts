import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../server/src/config.js";

const production = {
  NODE_ENV: "production",
  DATA_DIR: resolve("deploy/测试数据目录"),
  WECHAT_OWNER_APPID: "wx1234567890abcdef",
  WECHAT_OWNER_SECRET: "1234567890abcdef1234567890abcdef",
  WECHAT_AGENT_APPID: "wxfedcba0987654321",
  WECHAT_AGENT_SECRET: "fedcba0987654321fedcba0987654321",
  PUBLIC_APP_URL: "https://example.com",
};
test("生产默认监听容器网卡，无需未消费的会话密钥", () => {
  assert.equal(loadConfig(production).HOST, "0.0.0.0");
  assert.equal(loadConfig({}).HOST, "127.0.0.1");
  assert.equal(
    loadConfig({ ...production, HOST: "127.0.0.1" }).HOST,
    "127.0.0.1",
  );
});
test("缺失、空白、占位符及不成对的微信配置必须拒绝", () => {
  for (const key of [
    "WECHAT_OWNER_APPID",
    "WECHAT_OWNER_SECRET",
    "WECHAT_AGENT_APPID",
    "WECHAT_AGENT_SECRET",
  ]) {
    for (const value of [undefined, "", "   ", "请填写真实凭据"]) {
      assert.throws(
        () => loadConfig({ ...production, [key]: value }),
        /WECHAT_(OWNER|AGENT)/,
      );
    }
  }
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /WECHAT_OWNER/);
  assert.throws(
    () => loadConfig({ WECHAT_OWNER_APPID: production.WECHAT_OWNER_APPID }),
    /WECHAT_OWNER/,
  );
});
test("无效监听参数、运行模式和非绝对生产路径必须拒绝", () => {
  for (const PORT of ["", "0", "65536", "1.5", "无效"])
    assert.throws(() => loadConfig({ ...production, PORT }), /PORT/);
  assert.throws(
    () => loadConfig({ ...production, HOST: "https://example.com" }),
    /HOST/,
  );
  assert.throws(() => loadConfig({ NODE_ENV: "prod" }), /NODE_ENV/);
  assert.throws(
    () => loadConfig({ ...production, DATA_DIR: "relative" }),
    /DATA_DIR/,
  );
});
test("校验错误不泄露敏感值", () => {
  const secret = "不应出现在日志中的密钥";
  try {
    loadConfig({ ...production, WECHAT_OWNER_SECRET: secret });
    assert.fail();
  } catch (error) {
    assert.equal(String(error).includes(secret), false);
  }
});
test("联卖端配置成对，HTTPS 来源不允许路径或通配符", () => {
  assert.throws(
    () =>
      loadConfig({
        ...production,
        WECHAT_AGENT_APPID: production.WECHAT_OWNER_APPID,
        WECHAT_AGENT_SECRET: undefined,
      }),
    /WECHAT_AGENT/,
  );
  for (const origin of [
    "http://example.com",
    "https://example.com/",
    "*",
    "https://user:pass@example.com",
  ])
    assert.throws(
      () => loadConfig({ ...production, CORS_ORIGINS: origin }),
      /CORS_ORIGINS/,
    );
  assert.equal(
    loadConfig({
      ...production,
      CORS_ORIGINS: "https://example.com,https://admin.example.com",
    }).HOST,
    "0.0.0.0",
  );
});
test("生产公开地址必须为有效 HTTPS 根地址", () => {
  for (const PUBLIC_APP_URL of [
    undefined,
    "",
    "无效",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com/?token=secret",
    "https://example.com/#fragment",
    "https://*.example.com",
  ])
    assert.throws(
      () => loadConfig({ ...production, PUBLIC_APP_URL }),
      /PUBLIC_APP_URL/,
    );
  assert.equal(
    loadConfig({ ...production, PUBLIC_APP_URL: "https://example.com/" })
      .PUBLIC_APP_URL,
    "https://example.com/",
  );
});
test("实际入口缺少微信配置时在打开数据库之前退出", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "server/src/server.ts"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        NODE_ENV: "production",
        WECHAT_OWNER_APPID: "",
        WECHAT_OWNER_SECRET: "",
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /WECHAT_OWNER_APPID/);
  assert.doesNotMatch(result.stdout, /服务已启动/);
});
test("部署静态契约：私网端口、健康依赖、证书和静态目录一致", () => {
  const read = (name: string) =>
    readFileSync(new URL(name, import.meta.url), "utf8");
  const compose = read("docker-compose.yml");
  assert.doesNotMatch(compose.split("  nginx:")[0]!, /^\s+ports:/m);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /create_host_path: false/);
  assert.match(compose, /env_file:[\s\S]*QIAN_ENV_FILE:-\.env\.production/);
  assert.doesNotMatch(compose, /WECHAT_OWNER_SECRET:/);
  assert.match(
    read("start-production.ps1"),
    /\$env:QIAN_ENV_FILE = \$resolvedEnv/,
  );
  assert.match(read("start-production.ps1"), /finally/);
  assert.match(
    read("Dockerfile"),
    /COPY --from=build \/app\/build\/scripts .\/scripts/,
  );
  const nginx = read("nginx.conf");
  for (const route of ["/api", "/api/", "/uploads", "/uploads/"])
    assert.ok(nginx.includes(`${route} { proxy_pass $api; }`));
  assert.match(nginx, /listen 443 ssl/);
  assert.match(nginx, /root \/usr\/share\/nginx\/html/);
  assert.match(
    read("Dockerfile"),
    /\/app\/dist\/web \/usr\/share\/nginx\/html/,
  );
  assert.match(read("Dockerfile"), /CMD \["node", "server\/src\/server.js"\]/);
});
