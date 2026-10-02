import type { Express, Response, Request } from "express";
import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Store, User } from "./db.js";
import { ApiError } from "./validation.js";
import { createIntegrations, IntegrationError } from "./integrations.js";
import { createWechat, type MiniApp } from "./wechat.js";
import { loadObjectStorageConfig } from "./object-storage.js";

/** 服务接口不接受任意收件人、商户金额或外部地址，防止把系统变成付费接口代理。 */
export function installServiceRoutes(app: Express, store: Store) {
  const integrations = createIntegrations();
  const wechat = createWechat();
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const me = (res: Response): User => {
    if (!res.locals.user) throw new ApiError(401, "UNAUTHORIZED", "请先登录。");
    return res.locals.user;
  };
  const admin = (res: Response) => {
    const user = me(res);
    if (user.role !== "admin")
      throw new ApiError(403, "FORBIDDEN", "需要管理员权限。");
    return user;
  };
  app.get("/api/legal", (_req, res) =>
    res.json({
      operator: process.env.OPERATOR_NAME || "尚未配置运营主体",
      contact: process.env.SUPPORT_EMAIL || "尚未配置联系方式",
      privacyVersion: process.env.PRIVACY_VERSION || "2026-09-09",
      privacyUrl: process.env.PRIVACY_URL || null,
      termsUrl: process.env.TERMS_URL || null,
      filingNumber: process.env.MINI_FILING_NUMBER || null,
      note: "正式隐私政策、服务协议和备案号由运营主体审核填写，通用模板不代表合规审核通过。",
    }),
  );
  store.db
    .exec(`CREATE TABLE IF NOT EXISTS sms_challenges (user_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, last_sent INTEGER NOT NULL, attempts INTEGER NOT NULL, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS service_delivery (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS property_checks (property_id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  function context(req: Request, user: User) {
    const row = store.db
      .prepare("SELECT app FROM real_sessions WHERE token_hash=?")
      .get(hash((req.headers.authorization || "").slice(7)));
    if (!row || !["owner", "agent"].includes(String(row.app)))
      throw new ApiError(
        403,
        "WECHAT_SESSION_REQUIRED",
        "请使用微信小程序中的真实登录。",
      );
    const appName = row.app as MiniApp;
    const appid = wechat.credentials(appName).appid;
    const identity = store.db
      .prepare(
        "SELECT openid FROM wechat_identities WHERE user_id=? AND appid=?",
      )
      .get(user.id, appid);
    if (!identity)
      throw new ApiError(
        403,
        "WECHAT_SESSION_REQUIRED",
        "未找到当前微信身份。",
      );
    return { appName, openid: String(identity.openid) };
  }
  app.get("/api/integrations/status", (_req, res) => {
    const wx = (name: string) =>
      !!process.env[`WECHAT_${name}_APPID`] &&
      !!process.env[`WECHAT_${name}_SECRET`];
    res.json({
      wechat: {
        supported: true,
        configured: wx("OWNER") && wx("AGENT"),
        liveVerified: false,
        note: "微信登录与手机号授权已实现，需在两个真实小程序中联调。",
      },
      ...integrations.status,
      s3: {
        supported: true,
        configured: !!loadObjectStorageConfig(),
        liveVerified: false,
        note: "已接入私有对象存储上传与短期链接；未配置时使用本地持久卷。",
      },
      subscribeMessage: {
        supported: true,
        configured: !!process.env.WECHAT_SUBSCRIBE_TEMPLATE_ID,
        liveVerified: false,
        note: "已实现用户主动订阅与受控发送，需模板权限。",
      },
      identity: {
        supported: false,
        configured: false,
        liveVerified: false,
        note: "经纪人入驻人工审核已实现；身份证人脸核验未选择供应商。",
      },
      propertyVerify: {
        supported: true,
        configured: true,
        liveVerified: false,
        note: "已实现人工核验登记与发布门禁；未接入地方住建平台自动核验。",
      },
      smartLock: {
        supported: false,
        configured: false,
        liveVerified: false,
        note: "设备控制关闭，仅支持申请审核流程。",
      },
    });
  });
  app.get("/api/map/geocode", async (req, res) => {
    me(res);
    const input = z
      .object({
        address: z.string().min(1).max(200),
        city: z.string().min(1).max(100).optional(),
      })
      .strict()
      .parse(req.query);
    res.json(await integrations.geocode(input));
  });
  app.get("/api/map/search", async (req, res) => {
    me(res);
    const input = z
      .object({
        keyword: z.string().min(1).max(100),
        city: z.string().min(1).max(100),
      })
      .strict()
      .parse(req.query);
    res.json(await integrations.searchAddresses(input));
  });
  app.post("/api/sms/challenge", async (req, res) => {
    const user = me(res);
    z.object({ consent: z.literal(true) })
      .strict()
      .parse(req.body);
    if (!user.phone || !/^1\d{10}$/.test(user.phone))
      throw new ApiError(400, "PHONE_REQUIRED", "请先通过微信授权绑定手机号。");
    if (!integrations.status.sms.configured)
      throw new ApiError(
        503,
        "SMS_NOT_CONFIGURED",
        "短信服务尚未配置，未发送短信。",
      );
    const old = store.db
      .prepare("SELECT last_sent FROM sms_challenges WHERE user_id=?")
      .get(user.id);
    if (old && Date.now() - Number(old.last_sent) < 300000)
      throw new ApiError(
        429,
        "SMS_COOLDOWN",
        "五分钟内只允许申请一次验证码；超时结果不确定时也请勿重复发送。",
      );
    const code = String(randomInt(100000, 1000000));
    store.db
      .prepare(
        "INSERT INTO sms_challenges VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,last_sent=excluded.last_sent,attempts=0,status=excluded.status",
      )
      .run(
        user.id,
        hash(user.id + ":" + code),
        Date.now() + 300000,
        Date.now(),
        0,
        "sending",
      );
    try {
      await integrations.sendSms({
        phoneNumber: "+86" + user.phone,
        templateParams: [code],
      });
      store.db
        .prepare("UPDATE sms_challenges SET status=? WHERE user_id=?")
        .run("sent", user.id);
      res.json({
        accepted: true,
        expiresIn: 300,
        message: "短信已由服务商受理，验证码五分钟内有效。",
      });
    } catch (error) {
      store.db
        .prepare("UPDATE sms_challenges SET status=? WHERE user_id=?")
        .run("unknown", user.id);
      throw error;
    }
  });
  app.post("/api/sms/verify", (req, res) => {
    const user = me(res);
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(req.body);
    const result = store.transaction(() => {
      const row = store.db
        .prepare("SELECT * FROM sms_challenges WHERE user_id=?")
        .get(user.id);
      if (
        !row ||
        Number(row.expires_at) < Date.now() ||
        Number(row.attempts) >= 5 ||
        !["sent", "unknown"].includes(String(row.status))
      )
        return false;
      store.db
        .prepare(
          "UPDATE sms_challenges SET attempts=attempts+1 WHERE user_id=?",
        )
        .run(user.id);
      const valid = timingSafeEqual(
        Buffer.from(String(row.code_hash)),
        Buffer.from(hash(user.id + ":" + code)),
      );
      if (valid)
        store.db
          .prepare("UPDATE sms_challenges SET status=? WHERE user_id=?")
          .run("verified", user.id);
      return valid;
    });
    if (!result)
      throw new ApiError(400, "CODE_INVALID", "验证码无效、已使用或已过期。");
    res.json({ verified: true, message: "手机号验证码校验通过。" });
  });
  app.get("/api/subscriptions/template", (_req, res) =>
    res.json({ templateId: process.env.WECHAT_SUBSCRIBE_TEMPLATE_ID || null }),
  );
  app.post("/api/subscriptions/grant", (req, res) => {
    const user = me(res);
    const { appName } = context(req, user);
    const { templateId } = z
      .object({
        templateId: z.string().min(1).max(200),
        accepted: z.literal(true),
      })
      .strict()
      .parse(req.body);
    if (
      !process.env.WECHAT_SUBSCRIBE_TEMPLATE_ID ||
      templateId !== process.env.WECHAT_SUBSCRIBE_TEMPLATE_ID
    )
      throw new ApiError(400, "TEMPLATE_INVALID", "订阅模板未配置或不匹配。");
    store.db
      .prepare(
        "INSERT INTO subscription_grants VALUES (?,?,?,?) ON CONFLICT(user_id,app,template) DO UPDATE SET accepted_at=excluded.accepted_at",
      )
      .run(user.id, appName, templateId, new Date().toISOString());
    res.json({
      recorded: true,
      message: "已记录订阅意愿，实际发送权限仍由微信判定。",
    });
  });
  app.post("/api/notifications/:id/deliver", async (req, res) => {
    admin(res);
    const notice = store.get("notifications", String(req.params.id));
    if (!notice) throw new ApiError(404, "NOT_FOUND", "通知不存在。");
    const template = process.env.WECHAT_SUBSCRIBE_TEMPLATE_ID;
    if (!template)
      throw new ApiError(
        503,
        "TEMPLATE_NOT_CONFIGURED",
        "尚未配置订阅消息模板。",
      );
    const grant = store.db
      .prepare(
        "SELECT * FROM subscription_grants WHERE user_id=? AND template=?",
      )
      .get(String(notice.userId), template);
    if (!grant)
      throw new ApiError(409, "SUBSCRIPTION_REQUIRED", "用户尚未订阅该模板。");
    const appName = grant.app as MiniApp;
    const identity = store.db
      .prepare(
        "SELECT openid FROM wechat_identities WHERE user_id=? AND appid=?",
      )
      .get(String(notice.userId), wechat.credentials(appName).appid);
    if (!identity)
      throw new ApiError(404, "NOT_FOUND", "未找到收件人微信身份。");
    // 字段名必须与在微信平台申请的模板一致；不接受前端任意消息正文。
    const field = process.env.WECHAT_SUBSCRIBE_TITLE_FIELD || "thing1";
    if (!/^thing\d+$/.test(field))
      throw new ApiError(503, "TEMPLATE_INVALID", "订阅模板标题字段配置错误。");
    store.transaction(() => {
      if (
        store.db
          .prepare("SELECT id FROM service_delivery WHERE id=?")
          .get(notice.id)
      )
        throw new ApiError(
          409,
          "DELIVERY_EXISTS",
          "该通知已发送或结果待确认，不自动重发。",
        );
      store.db
        .prepare("INSERT INTO service_delivery VALUES (?,?,?,?)")
        .run(
          notice.id,
          String(notice.userId),
          "sending",
          new Date().toISOString(),
        );
      store.db
        .prepare(
          "DELETE FROM subscription_grants WHERE user_id=? AND app=? AND template=?",
        )
        .run(String(notice.userId), appName, template);
    });
    try {
      await wechat.subscribe(appName, String(identity.openid), template, {
        [field]: { value: String(notice.title).slice(0, 20) },
      });
      store.db
        .prepare("UPDATE service_delivery SET status=? WHERE id=?")
        .run("sent", notice.id);
      res.json({ accepted: true });
    } catch (error) {
      store.db
        .prepare("UPDATE service_delivery SET status=? WHERE id=?")
        .run("unknown", notice.id);
      throw error;
    }
  });
  app.put("/api/property-checks/:id", (req, res) => {
    const reviewer = admin(res);
    const id = String(req.params.id);
    if (!store.get("properties", id))
      throw new ApiError(404, "NOT_FOUND", "房源不存在。");
    const input = z
      .object({
        verified: z.boolean(),
        authorizationConfirmed: z.boolean(),
        code: z.string().trim().min(1).max(100),
        agencyRegistration: z.string().trim().min(1).max(100),
        note: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    const data = {
      ...input,
      propertyId: id,
      reviewerId: reviewer.id,
      checkedAt: new Date().toISOString(),
    };
    store.transaction(() => {
      store.db
        .prepare(
          "INSERT INTO property_checks VALUES (?,?) ON CONFLICT(property_id) DO UPDATE SET data=excluded.data",
        )
        .run(id, JSON.stringify(data));
      store.put("audit", {
        id: randomUUID(),
        createdAt: data.checkedAt,
        updatedAt: data.checkedAt,
        status: "recorded",
        actorId: reviewer.id,
        actorRole: reviewer.role,
        action: "房源人工核验",
        collection: "properties",
        recordId: id,
      });
    });
    res.json(data);
  });
  app.get("/api/property-checks/:id", (req, res) => {
    admin(res);
    const row = store.db
      .prepare("SELECT data FROM property_checks WHERE property_id=?")
      .get(String(req.params.id));
    res.json(row ? JSON.parse(String(row.data)) : null);
  });
  app.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      next: (error?: unknown) => void,
    ) => {
      if (error instanceof IntegrationError) {
        res
          .status(502)
          .json({ error: { code: error.code, message: error.message } });
        return;
      }
      next(error);
    },
  );
}
