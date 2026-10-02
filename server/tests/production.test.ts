import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createWechat } from "../src/wechat.js";
import { Store } from "../src/db.js";

// 所有微信及短信出站请求均使用 mock；只启动临时回环 HTTP 服务。
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const PRIVACY = "production-test-v1";
const wxEnv = {
  WECHAT_OWNER_APPID: "wxowner12345678",
  WECHAT_OWNER_SECRET: "mock-owner-secret",
  WECHAT_AGENT_APPID: "wxagent12345678",
  WECHAT_AGENT_SECRET: "mock-agent-secret",
};
async function fixture(
  run: (f: {
    app: ReturnType<typeof createApp>;
    request: (
      path: string,
      token?: string,
      body?: unknown,
      method?: string,
    ) => Promise<{ status: number; data: any }>;
    login: (
      code: string,
      appName?: "owner" | "agent",
    ) => Promise<{ token: string; user: any }>;
    upstream: string[];
  }) => Promise<void>,
  sms = false,
) {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), "qian-production-regression-"));
  const upstream: string[] = [];
  let app: ReturnType<typeof createApp> | undefined;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    for (const key of Object.keys(process.env))
      if (
        /^(S3_|WECHAT_|TENCENT_|DEFAULT_AGENT_ID|CORS_ORIGINS|PRIVACY_VERSION)/.test(
          key,
        )
      )
        delete process.env[key];
    Object.assign(process.env, wxEnv, {
      NODE_ENV: "production",
      DATA_DIR: directory,
      PRIVACY_VERSION: PRIVACY,
      WECHAT_SUBSCRIBE_TEMPLATE_ID: "mock-template",
    });
    if (sms)
      Object.assign(process.env, {
        TENCENT_SMS_SECRET_ID: "MOCKID",
        TENCENT_SMS_SECRET_KEY: "MOCKKEY",
        TENCENT_SMS_APP_ID: "1400000000",
        TENCENT_SMS_SIGN_NAME: "测试签名",
        TENCENT_SMS_TEMPLATE_ID: "10001",
        TENCENT_SMS_REGION: "ap-guangzhou",
      });
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      upstream.push(url.hostname + url.pathname);
      if (url.pathname === "/sns/jscode2session")
        return Response.json({
          openid: "openid_" + url.searchParams.get("js_code"),
          session_key: "never-expose-session-key",
        });
      if (url.pathname.endsWith("/stable_token"))
        return Response.json({
          access_token: "mock-access-token",
          expires_in: 7200,
        });
      if (url.pathname.endsWith("/msg_sec_check"))
        return Response.json({ result: { suggest: "pass" } });
      // 模拟服务商可能已接收，但连接在响应前失败；不返回可重试成功假象。
      throw new Error("模拟连接中断，结果未知");
    };
    globalThis.fetch = transport;
    app = createApp(":memory:", {
      wechat: createWechat(process.env, transport),
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = async (
      path: string,
      token?: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) => {
      const response = await realFetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };
    const login = async (
      code: string,
      appName: "owner" | "agent" = "owner",
    ) => {
      const response = await request("/api/auth/wechat/login", undefined, {
        code,
        app: appName,
        privacyVersion: PRIVACY,
      });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      return response.data;
    };
    await run({ app, request, login, upstream });
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    app?.locals.close();
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    // 仅清理本测试创建的精确临时目录，不触碰现有数据目录。
    assert.ok(
      directory.startsWith(join(tmpdir(), "qian-production-regression-")),
    );
    rmSync(directory, { recursive: true, force: true });
  }
}
function role(
  app: ReturnType<typeof createApp>,
  id: string,
  roleName: "admin" | "agent",
  phone?: string,
) {
  const row = app.locals.db
    .prepare("SELECT data FROM users WHERE id=?")
    .get(id);
  const user = {
    ...JSON.parse(row.data),
    role: roleName,
    ...(phone ? { phone } : {}),
  };
  app.locals.db
    .prepare("UPDATE users SET data=? WHERE id=?")
    .run(JSON.stringify(user), id);
}
function chinese(
  result: { status: number; data: any },
  status: number,
  code?: string,
) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  assert.match(result.data.error.message, /[\u4e00-\u9fff]/);
  if (code) assert.equal(result.data.error.code, code);
}

test("生产启动拒绝已种子化演示数据库，原有数据保留", async () => {
  await fixture(async () => {
    const dir = mkdtempSync(join(tmpdir(), "qian-production-seed-"));
    try {
      process.env.NODE_ENV = "test";
      const db = new Store(join(dir, "seed.sqlite"));
      const count = db.all("properties").length;
      db.close();
      process.env.NODE_ENV = "production";
      assert.throws(
        () => createApp(join(dir, "seed.sqlite")),
        /生产环境不得使用含演示身份/,
      );
      const reopened = new Store(join(dir, "seed.sqlite"));
      assert.equal(reopened.all("properties").length, count);
      reopened.close();
    } finally {
      process.env.NODE_ENV = "production";
      assert.ok(dir.startsWith(join(tmpdir(), "qian-production-seed-")));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("真实微信会话可在生产鉴权，两端首次登录均为业主且不能伪造角色", async () => {
  await fixture(async ({ app, request, login, upstream }) => {
    const owner = await login("owner-code");
    const agentAppUser = await login("agent-code", "agent");
    for (const result of [owner, agentAppUser]) {
      assert.equal(result.user.role, "owner");
      assert.ok(!JSON.stringify(result).includes("session_key"));
      assert.equal((await request("/api/auth/me", result.token)).status, 200);
    }
    const bootstrap = await request("/api/bootstrap", owner.token);
    assert.equal(bootstrap.data.demo, false);
    assert.deepEqual(bootstrap.data.properties, []);
    const before = upstream.length;
    chinese(
      await request("/api/auth/wechat/login", undefined, {
        code: "forge",
        app: "agent",
        privacyVersion: PRIVACY,
        role: "admin",
      }),
      400,
    );
    assert.equal(upstream.length, before);
    chinese(await request("/api/auth/demo", undefined, { role: "admin" }), 403);
    app.locals.db
      .prepare("DELETE FROM real_sessions WHERE token_hash=?")
      .run(digest(owner.token));
    chinese(await request("/api/auth/me", owner.token), 401);
    app.locals.db
      .prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
      .run(Date.now() - 1, digest(agentAppUser.token));
    chinese(await request("/api/auth/me", agentAppUser.token), 401);
  });
});

test("管理员配对须授权、仅可使用一次、过期与未签发码均拒绝", async () => {
  await fixture(async ({ app, request, login }) => {
    const user = await login("admin-candidate");
    chinese(await request("/api/admin/pairing", user.token, {}), 403);
    role(app, user.user.id, "admin");
    const issued = await request("/api/admin/pairing", user.token, {});
    assert.equal(issued.status, 200);
    const paired = await request("/api/auth/admin/pair", undefined, {
      code: issued.data.code,
    });
    assert.equal(paired.status, 200);
    assert.equal(paired.data.user.role, "admin");
    assert.equal(
      (await request("/api/auth/me", paired.data.token)).status,
      200,
    );
    chinese(
      await request("/api/auth/admin/pair", undefined, {
        code: issued.data.code,
      }),
      401,
      "PAIRING_INVALID",
    );
    const expired = await request("/api/admin/pairing", user.token, {});
    app.locals.db
      .prepare("UPDATE admin_pairing SET expires_at=? WHERE code_hash=?")
      .run(Date.now() - 1, digest(expired.data.code));
    chinese(
      await request("/api/auth/admin/pair", undefined, {
        code: expired.data.code,
      }),
      401,
      "PAIRING_INVALID",
    );
    chinese(
      await request("/api/auth/admin/pair", undefined, { code: "00000000" }),
      401,
      "PAIRING_INVALID",
    );
  });
});

test("非本人对象图片引用和未注册对象均不可挂到房源", async () => {
  await fixture(async ({ app, request, login }) => {
    const user = await login("image-owner");
    const other = await login("other-owner");
    const name = "a".repeat(64) + ".png";
    app.locals.db
      .prepare("INSERT INTO uploads(name,user_id,data) VALUES (?,?,?)")
      .run(
        name,
        other.user.id,
        JSON.stringify({ objectKey: "qian-estate/uploads/" + name }),
      );
    const input = {
      title: "测试房源",
      community: "测试社区",
      city: "杭州",
      district: "滨江区",
      address: "测试路",
      area: 89,
      price: 300,
      rooms: "3室2厅",
      images: ["/uploads/" + name],
    };
    chinese(
      await request("/api/properties", user.token, input),
      403,
      "IMAGE_FORBIDDEN",
    );
    chinese(
      await request("/api/properties", user.token, {
        ...input,
        images: ["/uploads/" + "b".repeat(64) + ".png"],
      }),
      403,
      "IMAGE_FORBIDDEN",
    );
    chinese(
      await request("/api/properties", user.token, {
        ...input,
        images: ["/assets/interior-1.png"],
      }),
      400,
      "DEMO_IMAGE_FORBIDDEN",
    );
    chinese(await request("/uploads/" + name), 403, "IMAGE_FORBIDDEN");
  });
});

test("服务接口先鉴权，缺失地图或短信配置不外呼且错误中文", async () => {
  await fixture(async ({ app, request, login, upstream }) => {
    for (const [path, body] of [
      ["/api/map/geocode?address=test", undefined],
      ["/api/map/search?keyword=test&city=test", undefined],
      ["/api/sms/challenge", { consent: true }],
      ["/api/notifications/test/deliver", {}],
      [
        "/api/subscriptions/grant",
        { templateId: "mock-template", accepted: true },
      ],
    ] as const)
      chinese(await request(path, undefined, body), 401);
    assert.equal(upstream.length, 0);
    const user = await login("service-user");
    role(app, user.user.id, "agent", "13800000000");
    const before = upstream.length;
    chinese(
      await request("/api/map/geocode?address=test", user.token),
      502,
      "NOT_CONFIGURED",
    );
    chinese(
      await request("/api/sms/challenge", user.token, { consent: true }),
      503,
      "SMS_NOT_CONFIGURED",
    );
    chinese(
      await request("/api/notifications/test/deliver", user.token, {}),
      403,
    );
    assert.equal(upstream.length, before);
    chinese(
      await request("/api/profile", user.token, { role: "admin" }, "PUT"),
      400,
    );
    chinese(await request("/api/unknown"), 404);
  });
});

test("短信响应不确定保留 unknown，冷却期间拒绝再次发送", async () => {
  await fixture(async ({ app, request, login, upstream }) => {
    const user = await login("sms-user");
    role(app, user.user.id, "agent", "13800000000");
    chinese(
      await request("/api/sms/challenge", user.token, { consent: true }),
      502,
    );
    assert.equal(
      app.locals.db
        .prepare("SELECT status FROM sms_challenges WHERE user_id=?")
        .get(user.user.id).status,
      "unknown",
    );
    const sent = upstream.filter((s) =>
      s.startsWith("sms.tencentcloudapi.com"),
    ).length;
    assert.equal(sent, 1);
    chinese(
      await request("/api/sms/challenge", user.token, { consent: true }),
      429,
      "SMS_COOLDOWN",
    );
    assert.equal(
      upstream.filter((s) => s.startsWith("sms.tencentcloudapi.com")).length,
      sent,
    );
  }, true);
});

test("订阅发送不确定保留记录且不得重复发出", async () => {
  await fixture(async ({ app, request, login, upstream }) => {
    const user = await login("notice-user");
    role(app, user.user.id, "admin");
    const stamp = new Date().toISOString();
    app.locals.db
      .prepare("INSERT INTO records(collection,id,data) VALUES (?,?,?)")
      .run(
        "notifications",
        "notice-1",
        JSON.stringify({
          id: "notice-1",
          userId: user.user.id,
          title: "测试通知",
          status: "unread",
          createdAt: stamp,
          updatedAt: stamp,
        }),
      );
    const grant = () =>
      app.locals.db
        .prepare("INSERT OR REPLACE INTO subscription_grants VALUES (?,?,?,?)")
        .run(user.user.id, "owner", "mock-template", stamp);
    grant();
    chinese(
      await request("/api/notifications/notice-1/deliver", user.token, {}),
      502,
    );
    assert.equal(
      app.locals.db
        .prepare("SELECT status FROM service_delivery WHERE id=?")
        .get("notice-1").status,
      "unknown",
    );
    grant();
    const count = upstream.length;
    chinese(
      await request("/api/notifications/notice-1/deliver", user.token, {}),
      409,
      "DELIVERY_EXISTS",
    );
    assert.equal(upstream.length, count);
  });
});

// 隐私版本过期时必须重新获得当前版本同意。
test(
  "拒绝与服务端当前版本不一致的隐私授权",
  async () => {
    await fixture(async ({ request }) => {
      const result = await request("/api/auth/wechat/login", undefined, {
        code: "privacy-code",
        app: "owner",
        privacyVersion: "obsolete-version",
      });
      assert.equal(result.status, 409);
    });
  },
);
