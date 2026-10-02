import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { Store, User } from "./db.js";
import { ApiError } from "./validation.js";
import { createWechat, type MiniApp } from "./wechat.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const stamp = () => new Date().toISOString();
export const publicUser = (user: User) => ({
  ...user,
  phone: user.phone
    ? user.phone.slice(0, 3) + "****" + user.phone.slice(-4)
    : undefined,
});
export function initializeAuth(store: Store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS wechat_identities (appid TEXT NOT NULL, openid TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(appid,openid));
    CREATE TABLE IF NOT EXISTS real_sessions (token_hash TEXT PRIMARY KEY, app TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_applications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_pairing (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscription_grants (user_id TEXT NOT NULL, app TEXT NOT NULL, template TEXT NOT NULL, accepted_at TEXT NOT NULL, PRIMARY KEY(user_id,app,template));
  `);
}
export function installAuth(
  app: Express,
  store: Store,
  wechat = createWechat(),
) {
  initializeAuth(store);
  const me = (res: Response): User => {
    if (!res.locals.user) throw new ApiError(401, "UNAUTHORIZED", "请先登录。");
    return res.locals.user;
  };
  const admin = (res: Response) => {
    const user = me(res);
    if (user.role !== "admin")
      throw new ApiError(403, "FORBIDDEN", "仅管理员可以执行此操作。");
    return user;
  };
  const sessionApp = (req: Request): MiniApp => {
    const row = store.db
      .prepare("SELECT app FROM real_sessions WHERE token_hash=?")
      .get(digest((req.headers.authorization || "").slice(7)));
    if (!row || !["owner", "agent"].includes(String(row.app)))
      throw new ApiError(
        403,
        "WECHAT_SESSION_REQUIRED",
        "请在微信小程序中登录后授权。",
      );
    return row.app as MiniApp;
  };
  const issue = (user: User, appName: MiniApp | "admin") => {
    const token = randomBytes(32).toString("hex");
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(digest(token), user.id, Date.now() + 12 * 3600000);
    store.db
      .prepare("INSERT INTO real_sessions VALUES (?,?)")
      .run(digest(token), appName);
    return { token, user: publicUser(user) };
  };
  const audit = (user: User, action: string, recordId: string) =>
    store.put("audit", {
      id: randomUUID(),
      createdAt: stamp(),
      updatedAt: stamp(),
      status: "recorded",
      actorId: user.id,
      actorRole: user.role,
      action,
      collection: "users",
      recordId,
    });

  app.post("/api/auth/wechat/login", async (req, res) => {
    const input = z
      .object({
        code: z.string().min(1).max(256),
        app: z.enum(["owner", "agent"]),
        privacyVersion: z.string().min(1).max(100),
      })
      .strict()
      .parse(req.body);
    if (input.privacyVersion !== (process.env.PRIVACY_VERSION || "2026-09-09"))
      throw new ApiError(
        409,
        "PRIVACY_VERSION_CHANGED",
        "隐私说明版本已更新，请更新小程序并重新阅读确认。",
      );
    const identity = await wechat.login(input.app, input.code);
    const appid = wechat.credentials(input.app).appid;
    const result = store.transaction(() => {
      const old = store.db
        .prepare(
          "SELECT user_id FROM wechat_identities WHERE appid=? AND openid=?",
        )
        .get(appid, identity.openid);
      let user = old ? store.user(String(old.user_id)) : undefined;
      if (!user) {
        user = {
          id: randomUUID(),
          name: "微信用户",
          role: "owner",
          createdAt: stamp(),
          updatedAt: stamp(),
          status: "active",
        };
        store.putUser(user);
        store.db
          .prepare("INSERT INTO wechat_identities VALUES (?,?,?)")
          .run(appid, identity.openid, user.id);
      }
      if (user.status !== "active")
        throw new ApiError(
          403,
          "ACCOUNT_DISABLED",
          "账号已停用，请联系管理员。",
        );
      // 两端使用独立身份，绝不依据客户端角色或手机号自动合并账户。
      audit(user, `隐私同意:${input.privacyVersion}`, user.id);
      return issue(user, input.app);
    });
    res.json(result);
  });
  app.post("/api/auth/wechat/phone", async (req, res) => {
    const user = me(res);
    const appName = sessionApp(req);
    const { code } = z
      .object({ code: z.string().min(1).max(256) })
      .strict()
      .parse(req.body);
    const phone = await wechat.phone(appName, code);
    store.transaction(() => {
      store.putUser({ ...user, phone, updatedAt: stamp() });
      audit(user, "微信手机号绑定", user.id);
    });
    res.json({ user: publicUser({ ...user, phone }), phoneVerified: true });
  });
  app.get("/api/auth/me", (_req, res) =>
    res.json({ user: publicUser(me(res)) }),
  );
  app.post("/api/admin/pairing", (req, res) => {
    const user = admin(res);
    sessionApp(req);
    const code = String(randomInt(10000000, 100000000));
    store.db
      .prepare("DELETE FROM admin_pairing WHERE user_id=? OR expires_at<?")
      .run(user.id, Date.now());
    store.db
      .prepare("INSERT INTO admin_pairing VALUES (?,?,?)")
      .run(digest(code), user.id, Date.now() + 60000);
    res.json({
      code,
      expiresIn: 60,
      message: "仅在您自己的管理后台输入，一分钟内有效，请勿转发。",
    });
  });
  app.post("/api/auth/admin/pair", (req, res) => {
    const { code } = z
      .object({ code: z.string().regex(/^\d{8}$/) })
      .strict()
      .parse(req.body);
    const result = store.transaction(() => {
      const row = store.db
        .prepare(
          "SELECT user_id,expires_at FROM admin_pairing WHERE code_hash=?",
        )
        .get(digest(code));
      if (!row || Number(row.expires_at) <= Date.now())
        throw new ApiError(401, "PAIRING_INVALID", "配对码无效或已过期。");
      const user = store.user(String(row.user_id));
      if (!user || user.role !== "admin" || user.status !== "active")
        throw new ApiError(403, "FORBIDDEN", "账号没有管理权限。");
      store.db
        .prepare("DELETE FROM admin_pairing WHERE code_hash=?")
        .run(digest(code));
      audit(user, "管理后台配对登录", user.id);
      return issue(user, "admin");
    });
    res.json(result);
  });
  const application = z
    .object({
      name: z.string().trim().min(1).max(50),
      company: z.string().trim().min(1).max(200),
      licenseNumber: z.string().trim().min(1).max(100),
      city: z.string().trim().min(1).max(50),
      phone: z.string().regex(/^1\d{10}$/),
    })
    .strict();
  app.get("/api/agent-applications", (_req, res) => {
    const user = me(res);
    const rows =
      user.role === "admin"
        ? store.db.prepare("SELECT data FROM agent_applications").all()
        : store.db
            .prepare("SELECT data FROM agent_applications WHERE user_id=?")
            .all(user.id);
    res.json(rows.map((row) => JSON.parse(String(row.data))));
  });
  app.post("/api/agent-applications", (req, res) => {
    const user = me(res);
    const input = application.parse(req.body);
    if (!user.phone || input.phone !== user.phone)
      throw new ApiError(
        400,
        "PHONE_REQUIRED",
        "请先通过微信绑定本人手机号，并填写相同的号码。",
      );
    const result = store.transaction(() => {
      const rows = store.db
        .prepare("SELECT data FROM agent_applications WHERE user_id=?")
        .all(user.id)
        .map((row) => JSON.parse(String(row.data)));
      if (rows.some((row) => row.status === "pending"))
        throw new ApiError(
          409,
          "APPLICATION_PENDING",
          "已有入驻申请待审核，请勿重复提交。",
        );
      const item = {
        ...input,
        id: randomUUID(),
        userId: user.id,
        createdAt: stamp(),
        status: "pending",
      };
      store.db
        .prepare("INSERT INTO agent_applications VALUES (?,?,?)")
        .run(item.id, user.id, JSON.stringify(item));
      audit(user, "经纪人入驻申请", item.id);
      return item;
    });
    res.status(201).json(result);
  });
  app.patch("/api/agent-applications/:id", (req, res) => {
    const reviewer = admin(res);
    const input = z
      .object({
        status: z.enum(["approved", "rejected"]),
        note: z.string().trim().min(1).max(1000),
      })
      .strict()
      .parse(req.body);
    const result = store.transaction(() => {
      const row = store.db
        .prepare("SELECT data FROM agent_applications WHERE id=?")
        .get(String(req.params.id));
      if (!row) throw new ApiError(404, "NOT_FOUND", "申请不存在。");
      const item = JSON.parse(String(row.data));
      if (item.status !== "pending")
        throw new ApiError(409, "INVALID_STATE", "申请已处理。");
      const user = store.user(item.userId)!;
      if (input.status === "approved" && user.role === "owner") {
        store.putUser({
          ...user,
          role: "agent",
          name: item.name,
          city: item.city,
          updatedAt: stamp(),
        });
        store.put("agents", {
          id: user.id,
          name: item.name,
          company: item.company,
          city: item.city,
          status: "active",
          createdAt: stamp(),
          updatedAt: stamp(),
        });
      }
      const updated = {
        ...item,
        ...input,
        reviewedBy: reviewer.id,
        updatedAt: stamp(),
      };
      store.db
        .prepare("UPDATE agent_applications SET data=? WHERE id=?")
        .run(JSON.stringify(updated), item.id);
      audit(reviewer, "经纪人入驻审核", item.id);
      return updated;
    });
    res.json(result);
  });
  app.get("/api/account/export", (_req, res) => {
    const user = me(res);
    const own = (name: Parameters<Store["all"]>[0]) =>
      store
        .all(name)
        .filter(
          (row) =>
            row.userId === user.id ||
            row.ownerId === user.id ||
            row.senderId === user.id,
        );
    res.json({
      user: publicUser(user),
      properties: own("properties"),
      commissions: own("commissions"),
      appointments: own("appointments"),
      messages: own("messages"),
      generatedAt: stamp(),
    });
  });
  app.post("/api/account/deletion-request", (req, res) => {
    const user = me(res);
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    const item = {
      id,
      userId: user.id,
      status: "pending",
      createdAt: stamp(),
      type: "deletion",
    };
    store.db
      .prepare("INSERT INTO account_requests VALUES (?,?,?)")
      .run(id, user.id, JSON.stringify(item));
    res
      .status(202)
      .json({
        ...item,
        message:
          "注销申请已登记，需管理员核对未结业务和依法保留事项；尚未删除数据。",
      });
  });
  app.get("/api/account/requests", (_req, res) => {
    admin(res);
    res.json(
      store.db
        .prepare("SELECT data FROM account_requests")
        .all()
        .map((row) => JSON.parse(String(row.data))),
    );
  });
  return { sessionApp };
}
