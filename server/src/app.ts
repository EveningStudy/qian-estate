import express, {
  type Request,
  type Response,
  type NextFunction,
  type ErrorRequestHandler,
} from "express";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { initializeAuth, installAuth, publicUser } from "./auth.js";
import { installServiceRoutes } from "./service-routes.js";
import { createWechat } from "./wechat.js";
import { inspectImage, saveUpload, uploadedFile } from "./uploads.js";
import { createObjectStorage, ObjectStorageError } from "./object-storage.js";
import {
  Store,
  collections,
  type Collection,
  type RecordData,
  type User,
} from "./db.js";
import {
  ApiError,
  createSchemas,
  identifier,
  patchSchema,
  profileSchema,
  safePayload,
  valuationSchema,
  type MutableCollection,
} from "./validation.js";

const now = () => new Date().toISOString();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
const requireRole = (user: User, roles: User["role"][]) => {
  if (!roles.includes(user.role))
    fail(403, "FORBIDDEN", "当前角色无权执行此操作。");
};
const loopback = (host: string) =>
  ["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"].includes(host);
const defaultPath = () =>
  resolve(
    process.env.DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url)),
    "qian-estate.sqlite",
  );
const publicPropertyFields = [
  "id",
  "createdAt",
  "updatedAt",
  "status",
  "title",
  "community",
  "city",
  "district",
  "address",
  "price",
  "area",
  "rooms",
  "floor",
  "orientation",
  "decoration",
  "year",
  "tags",
  "images",
  "agentId",
  "description",
  "transactionInfo",
  "views",
];
const pick = (item: RecordData, keys: string[]) =>
  Object.fromEntries(
    keys.filter((key) => key in item).map((key) => [key, item[key]]),
  );
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

/** 创建应用不会监听端口；app.locals.close() 释放 SQLite 连接。 */
export function createApp(
  dbPath: string = defaultPath(),
  options: { wechat?: ReturnType<typeof createWechat> } = {},
) {
  const store = new Store(dbPath);
  const objectStorage = createObjectStorage();
  const imageKey = randomBytes(32);
  const signImage = (path: string) => {
    if (!path.startsWith("/uploads/")) return path;
    const expires = String(Date.now() + 15 * 60000);
    return `${path}?expires=${expires}&signature=${createHmac(
      "sha256",
      imageKey,
    )
      .update(path + ":" + expires)
      .digest("hex")}`;
  };
  function imageAccess(req: Request) {
    const url = "/uploads/" + String(req.params.name);
    if (
      store
        .all("properties")
        .some(
          (p) =>
            ["published", "sold"].includes(p.status) &&
            Array.isArray(p.images) &&
            p.images.includes(url),
        )
    )
      return;
    const { expires, signature } = req.query;
    const expected = createHmac("sha256", imageKey)
      .update(url + ":" + String(expires))
      .digest("hex");
    if (
      typeof expires !== "string" ||
      Number(expires) < Date.now() ||
      typeof signature !== "string" ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    )
      fail(
        403,
        "IMAGE_FORBIDDEN",
        "图片链接已过期或尚未公开，请刷新房源资料。",
      );
  }
  initializeAuth(store);
  const production = () => process.env.NODE_ENV === "production";
  if (
    production() &&
    store.db.prepare("SELECT id FROM users WHERE id='admin-demo'").get()
  ) {
    store.close();
    throw new Error(
      "生产环境不得使用含演示身份的数据目录，请选择全新的生产数据目录。",
    );
  }
  const uploadDirectory = resolve(
    process.env.DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url)),
    "uploads",
  );
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  const buckets = new Map<string, { count: number; at: number }>();
  app.use((req, res, next) => {
    const sensitive =
      req.path.startsWith("/api/auth") || req.path === "/api/admin/pairing";
    const key = `${req.ip}:${sensitive ? "登录" : "普通"}`;
    const time = Date.now();
    for (const [id, bucket] of buckets)
      if (time - bucket.at >= 60000) buckets.delete(id);
    if (buckets.size > 10000) {
      res
        .status(503)
        .json({ error: { code: "BUSY", message: "服务繁忙，请稍后重试。" } });
      return;
    }
    const bucket = buckets.get(key) || { count: 0, at: time };
    buckets.set(key, bucket);
    if (++bucket.count > (production() && sensitive ? 10 : 600)) {
      res.setHeader("Retry-After", "60");
      res
        .status(429)
        .json({
          error: {
            code: "RATE_LIMITED",
            message: "请求过于频繁，请稍后重试。",
          },
        });
      return;
    }
    next();
  });
  app.locals.db = store.db;
  app.locals.close = () => {
    objectStorage.close();
    store.close();
  };

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          !(production()
            ? (process.env.CORS_ORIGINS || "")
                .split(",")
                .map((value) => value.trim())
                .includes(origin)
            : loopback(parsed.hostname)) ||
          parsed.origin !== origin ||
          parsed.username ||
          parsed.password
        )
          return next(
            new ApiError(403, "ORIGIN_DENIED", "浏览器来源未获允许。"),
          );
      } catch {
        return next(new ApiError(403, "ORIGIN_DENIED", "浏览器来源格式无效。"));
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PATCH,PUT,OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type,Idempotency-Key",
      );
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(
    "/assets",
    express.static(
      fileURLToPath(new URL("../../public/assets/", import.meta.url)),
      { dotfiles: "deny", index: false, fallthrough: true, maxAge: 0 },
    ),
  );
  app.get("/uploads/:name", async (req, res, next) => {
    try {
      imageAccess(req);
      const row = store.db
        .prepare("SELECT data FROM uploads WHERE name=?")
        .get(String(req.params.name));
      const stored = row ? JSON.parse(String(row.data)) : null;
      if (stored?.objectKey) {
        res.redirect(302, await objectStorage.getUrl(stored.objectKey));
        return;
      }
      res.sendFile(
        uploadedFile(store, uploadDirectory, String(req.params.name)),
      );
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use("/api", (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth) return next();
    const match = /^Bearer ([a-f0-9]{64})$/.exec(auth);
    if (!match)
      return next(new ApiError(401, "UNAUTHORIZED", "登录令牌无效。"));
    const row = store.db
      .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash=?")
      .get(hash(match[1]!));
    // 切换到生产环境后不允许复用演示会话。
    if (
      (production() &&
        !store.db
          .prepare("SELECT token_hash FROM real_sessions WHERE token_hash=?")
          .get(hash(match[1]!))) ||
      !row ||
      Number(row.expires_at) <= Date.now()
    )
      return next(new ApiError(401, "UNAUTHORIZED", "登录会话无效或已过期。"));
    const user = store.user(row.user_id as string);
    if (!user || user.status !== "active")
      return next(new ApiError(401, "UNAUTHORIZED", "登录会话无效。"));
    res.locals.user = user;
    next();
  });
  const authServices = installAuth(app, store, options.wechat);
  installServiceRoutes(app, store);
  const contentProvider = createWechat();
  async function checkContent(
    req: Request,
    user: User,
    input: Record<string, unknown>,
  ) {
    if (!production()) return;
    if (process.env.WECHAT_CONTENT_CHECK !== "true")
      fail(
        503,
        "CONTENT_CHECK_REQUIRED",
        "生产内容发布必须启用微信内容安全检查。",
      );
    const appName = authServices.sessionApp(req);
    const identity = store.db
      .prepare(
        "SELECT openid FROM wechat_identities WHERE user_id=? AND appid=?",
      )
      .get(user.id, contentProvider.credentials(appName).appid);
    if (!identity)
      fail(403, "WECHAT_SESSION_REQUIRED", "请在微信小程序中发布内容。");
    const content = Object.entries(input)
      .filter(
        ([key, value]) =>
          typeof value === "string" &&
          [
            "title",
            "description",
            "note",
            "content",
            "question",
            "preference",
            "community",
            "address",
            "name",
          ].includes(key),
      )
      .map(([, value]) => value)
      .join("\n")
      .slice(0, 10000);
    if (content)
      await contentProvider.checkText(
        appName,
        String(identity!.openid),
        content,
      );
  }
  const current = (res: Response): User | undefined => res.locals.user;
  const authenticated = (res: Response): User =>
    current(res) ?? fail(401, "UNAUTHORIZED", "请先登录后再继续。");
  const idParam = (req: Request, key = "id") =>
    identifier.parse(req.params[key]);
  const make = (
    fields: Record<string, unknown>,
    status: string,
  ): RecordData => {
    const stamp = now();
    return {
      ...fields,
      id: randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
      status,
    };
  };
  const audit = (
    user: User,
    action: string,
    collection: string,
    recordId: string,
  ) =>
    store.put(
      "audit",
      make(
        {
          actorId: user.id,
          actorRole: user.role,
          action,
          collection,
          recordId,
        },
        "recorded",
      ),
    );
  const notify = (userId: string, title: string, recordId: string) =>
    store.put(
      "notifications",
      make(
        { userId, title, content: "演示流程已更新，请查看详情。", recordId },
        "unread",
      ),
    );
  const related = (r: RecordData, user: User) =>
    [r.ownerId, r.agentId, r.requesterId, r.targetAgentId, r.userId].includes(
      user.id,
    );
  const propertyVisible = (p: RecordData, user?: User) =>
    p.status === "published" ||
    p.status === "sold" ||
    Boolean(
      user &&
      (user.role === "admin" || p.ownerId === user.id || p.agentId === user.id),
    );
  const rawProperty = (p: RecordData, user?: User) =>
    user && (user.role === "admin" || p.ownerId === user.id)
      ? p
      : pick(p, publicPropertyFields);
  const viewProperty = (p: RecordData, user?: User) => {
    const result = rawProperty(p, user);
    return {
      ...result,
      images: Array.isArray(p.images)
        ? p.images.map((path: string) =>
            production() ? signImage(path) : path,
          )
        : [],
    };
  };
  function checkImages(input: Record<string, unknown>, user: User) {
    if (!Array.isArray(input.images)) return;
    input.images = input.images.map((value: unknown) => {
      if (typeof value !== "string")
        fail(400, "INVALID_IMAGE", "图片地址格式错误。");
      const path = (value as string).split("?")[0]!;
      if (path.startsWith("/uploads/")) {
        const upload = store.db
          .prepare("SELECT user_id FROM uploads WHERE name=?")
          .get(path.slice("/uploads/".length));
        if (!upload || (user.role !== "admin" && upload.user_id !== user.id))
          fail(403, "IMAGE_FORBIDDEN", "只能使用本人上传或管理员审核的图片。");
      } else if (production())
        fail(400, "DEMO_IMAGE_FORBIDDEN", "生产房源不得使用内置演示图片。");
      return path;
    });
  }
  const property = (id: string, user?: User): RecordData => {
    const p = store.get("properties", id);
    if (!p || !propertyVisible(p, user))
      return fail(404, "NOT_FOUND", "房源不存在或不可访问。");
    return p;
  };
  const agent = (id: unknown) => {
    if (typeof id !== "string" || store.user(id)?.role !== "agent")
      fail(400, "INVALID_AGENT", "请选择有效的经纪人。");
    return id as string;
  };
  const visible = (
    collection: Collection,
    r: RecordData,
    user?: User,
  ): boolean => {
    if (collection === "properties") return propertyVisible(r, user);
    if (collection === "agents" || collection === "faqs")
      return r.status === "active" || r.status === "published";
    if (!user) return false;
    // 管理员也不能读取自己未参与的私人对话。
    if (collection === "messages")
      return r.senderId === user.id || r.recipientId === user.id;
    if (collection === "favorites" || collection === "notifications")
      return r.userId === user.id;
    if (collection === "audit")
      return user.role === "admin" || r.actorId === user.id;
    if (user.role === "admin") return true;
    if (collection === "clients") return r.agentId === user.id;
    if (collection === "questions" || collection === "feedback")
      return r.userId === user.id;
    return related(r, user);
  };
  const project = (
    collection: Collection,
    r: RecordData,
    user?: User,
  ): unknown => {
    if (collection === "properties") return viewProperty(r, user);
    if (collection === "lockRequests")
      return {
        ...r,
        lockEnabled: false,
        unlockEnabled: false,
        unlocked: false,
      };
    return r;
  };
  const submission = (
    req: Request,
    res: Response,
    user: User,
    operation: () => unknown,
    statusCode = 201,
  ) => {
    const key = req.headers["idempotency-key"];
    if (
      key !== undefined &&
      (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
    )
      fail(
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "幂等键须为 1–128 位英文字母、数字、点、冒号、下划线或连字符。",
      );
    const fingerprint = hash(
      `${req.method}:${req.originalUrl}:${canonical(req.body)}`,
    );
    let replayed = false;
    const result = store.transaction(() => {
      if (key) {
        const previous = store.db
          .prepare(
            "SELECT fingerprint,response FROM idempotency WHERE user_id=? AND key=?",
          )
          .get(user.id, key);
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            fail(409, "IDEMPOTENCY_CONFLICT", "此幂等键已用于其他请求。");
          replayed = true;
          return JSON.parse(previous.response as string);
        }
      }
      const value = operation();
      if (key)
        store.db
          .prepare("INSERT INTO idempotency VALUES (?,?,?,?)")
          .run(user.id, key, fingerprint, JSON.stringify(value));
      return value;
    });
    if (replayed) res.setHeader("Idempotency-Replayed", "true");
    res.status(statusCode).json(result);
  };

  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", demo: !production(), realLocksEnabled: false }),
  );
  app.get("/api/providers", (_req, res) =>
    res.redirect(307, "/api/integrations/status"),
  );
  // 禁止提供任意服务商透传入口，以免调用付费服务或绕过业务权限。
  app.post("/api/auth/demo", (req, res) => {
    if (
      !["development", "test", undefined].includes(process.env.NODE_ENV) ||
      !loopback(req.socket.remoteAddress ?? "")
    )
      fail(
        403,
        "DEMO_AUTH_DISABLED",
        "演示登录仅限本地开发；生产环境必须使用真实身份认证。",
      );
    const { role } = z
      .object({ role: z.enum(["owner", "agent", "admin"]) })
      .strict()
      .parse(req.body);
    const user = store.user(`${role}-demo`)!;
    const token = randomBytes(32).toString("hex");
    store.transaction(() => {
      store.db
        .prepare("DELETE FROM sessions WHERE expires_at<=?")
        .run(Date.now());
      store.db
        .prepare("INSERT INTO sessions VALUES (?,?,?)")
        .run(hash(token), user.id, Date.now() + 12 * 60 * 60 * 1000);
      audit(user, "demo.login", "users", user.id);
    });
    res.json({ token, user });
  });
  app.post(
    "/api/uploads",
    express.raw({ type: ["image/png", "image/jpeg"], limit: "5mb" }),
    async (req, res) => {
      const user = authenticated(res);
      if (!Buffer.isBuffer(req.body))
        fail(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "请发送 PNG 或 JPEG 原始图片字节。",
        );
      const mime = String(req.headers["content-type"] || "")
        .split(";", 1)[0]!
        .toLowerCase();
      if (objectStorage.status.configured) {
        const info = inspectImage(req.body, mime);
        const key = objectStorage.createKey(
          info.mime as "image/png" | "image/jpeg",
        );
        const name = key.split("/").pop()!;
        const item = {
          id: name,
          name,
          url: "/uploads/" + name,
          objectKey: key,
          mime,
          size: req.body.length,
          createdAt: now(),
          status: "uploading",
        };
        store.db
          .prepare("INSERT INTO uploads VALUES (?,?,?)")
          .run(name, user.id, JSON.stringify(item));
        try {
          await objectStorage.upload(
            key,
            req.body,
            info.mime as "image/png" | "image/jpeg",
          );
        } catch {
          throw new ApiError(
            502,
            "UPLOAD_UNCONFIRMED",
            "对象存储上传结果未确认，请联系管理员核对，不要连续重传。",
          );
        }
        store.db
          .prepare("UPDATE uploads SET data=? WHERE name=?")
          .run(JSON.stringify({ ...item, status: "stored" }), name);
        res
          .status(201)
          .json({
            url: item.url,
            previewUrl: signImage(item.url),
            name,
            status: "stored",
          });
        return;
      }
      const saved = saveUpload(
        store,
        uploadDirectory,
        user,
        req.body,
        String(req.headers["content-type"] || "")
          .split(";", 1)[0]
          .toLowerCase(),
      );
      res.status(201).json({ ...saved, previewUrl: signImage(saved.url) });
    },
  );
  app.post("/api/auth/logout", (_req, res) => {
    const user = authenticated(res);
    const token = _req.headers.authorization!.slice(7);
    store.transaction(() => {
      store.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(hash(token));
      audit(user, "logout", "users", user.id);
    });
    res.json({ ok: true });
  });
  app.get("/api/bootstrap", (_req, res) => {
    const user = current(res);
    const data = Object.fromEntries(
      collections.map((c) => [
        c,
        store
          .all(c)
          .filter((r) => visible(c, r, user))
          .map((r) => project(c, r, user)),
      ]),
    );
    const answered = store
      .all("questions")
      .filter((q) => q.status === "answered")
      .map((q) =>
        pick(q, [
          "id",
          "createdAt",
          "updatedAt",
          "status",
          "question",
          "answer",
          "category",
        ]),
      );
    res.json({
      user: user ? publicUser(user) : null,
      ...data,
      faqs: [...data.faqs!, ...answered],
      demo: !production(),
      realLocksEnabled: false,
    });
  });
  app.get("/api/properties/:id", (req, res) => {
    // 读取不会增加浏览次数；种子计数仅为演示。
    res.json(viewProperty(property(idParam(req), current(res)), current(res)));
  });
  app.put("/api/profile", (req, res) => {
    const user = authenticated(res);
    const fields = profileSchema.parse(req.body);
    if (production() && "phone" in fields)
      fail(
        400,
        "PHONE_AUTH_REQUIRED",
        "手机号必须通过微信授权绑定，不能手动修改。",
      );
    submission(
      req,
      res,
      user,
      () => {
        const updated = { ...user, ...fields, updatedAt: now() };
        store.putUser(updated);
        if (user.role === "agent") {
          const publicFields = Object.fromEntries(
            Object.entries(fields).filter(([k]) =>
              ["name", "avatar", "city", "bio"].includes(k),
            ),
          );
          const existing = store.get("agents", user.id)!;
          store.put("agents", {
            ...existing,
            ...publicFields,
            updatedAt: now(),
          });
        }
        audit(user, "profile.update", "users", user.id);
        return publicUser(updated);
      },
      200,
    );
  });
  app.post("/api/valuation", (req, res) => {
    if (production())
      fail(
        503,
        "VALUATION_NOT_CONFIGURED",
        "尚未接入真实估值服务，请预约人工评估。",
      );
    authenticated(res);
    const input = valuationSchema.parse(req.body);
    // 固定演示算法，不使用真实市场或私有成交数据。
    const midpoint = input.area * 3;
    res.json({
      ...input,
      demo: true,
      indicativeOnly: true,
      currency: "CNY",
      unit: "万元",
      low: Math.round(midpoint * 0.85 * 100) / 100,
      high: Math.round(midpoint * 1.15 * 100) / 100,
      referenceUnitPrice: 30000,
      method: "固定演示单价 30,000 元/平方米，区间 ±15%，不查询市场数据。",
      disclaimer:
        "仅为虚构演示的指示性区间，不是真实房产估价、专业评估或交易建议。",
      createdAt: now(),
    });
  });
  app.post("/api/favorites/:propertyId", (req, res) => {
    const user = authenticated(res);
    const propertyId = idParam(req, "propertyId");
    property(propertyId, user);
    if (req.body !== undefined) z.object({}).strict().parse(req.body);
    submission(
      req,
      res,
      user,
      () => {
        const existing = store
          .all("favorites")
          .find((f) => f.userId === user.id && f.propertyId === propertyId);
        if (existing) store.remove("favorites", existing.id);
        else
          store.put(
            "favorites",
            make({ userId: user.id, propertyId }, "active"),
          );
        audit(
          user,
          existing ? "favorite.remove" : "favorite.add",
          "properties",
          propertyId,
        );
        return {
          propertyId,
          favorited: !existing,
          favorites: store.all("favorites").filter((f) => f.userId === user.id),
        };
      },
      200,
    );
  });

  app.post("/api/:collection", async (req, res) => {
    const user = authenticated(res);
    const name = idParam(req, "collection");
    if (!Object.hasOwn(createSchemas, name))
      fail(404, "NOT_FOUND", "此数据集合不允许写入。");
    const collection = name as MutableCollection;
    const creationRoles: Partial<Record<MutableCollection, User["role"][]>> = {
      properties: ["owner"],
      commissions: ["owner"],
      appointments: ["owner"],
      collaborations: ["agent"],
      clients: ["agent"],
    };
    const allowedCreationRoles = creationRoles[collection];
    if (allowedCreationRoles) requireRole(user, allowedCreationRoles);
    const payload = safePayload(req.body);
    checkImages(payload, user);
    const referenceFields: Record<string, string[]> = {
      agentId: ["properties", "commissions", "appointments"],
      targetAgentId: ["collaborations"],
      recipientId: ["messages"],
    };
    for (const [field, allowed] of Object.entries(referenceFields))
      if (field in payload && !allowed.includes(collection))
        fail(
          400,
          "PROTECTED_FIELD",
          `Field '${field}' is not allowed for this collection.`,
        );
    const input = createSchemas[collection].parse(payload) as Record<
      string,
      unknown
    >;
    await checkContent(req, user, input);
    submission(req, res, user, () => {
      let fields: Record<string, unknown> = { ...input };
      let status = "pending";
      switch (collection) {
        case "properties": {
          requireRole(user, ["owner"]);
          fields = {
            floor: "待补充",
            orientation: "待补充",
            decoration: "待补充",
            year: 2020,
            tags: production() ? [] : ["演示房源"],
            images: production() ? [] : ["/assets/interior-1.png"],
            description: "业主提交的房源，待审核。",
            ...input,
            ownerId: user.id,
            agentId: agent(
              input.agentId ??
                (production() ? process.env.DEFAULT_AGENT_ID : "agent-demo"),
            ),
            views: 0,
            transactionInfo: {
              demo: !production(),
              priceUnit: "万元",
              ownership: "待核验",
            },
          };
          break;
        }
        case "commissions": {
          requireRole(user, ["owner"]);
          let assigned = agent(
            input.agentId ??
              (production() ? process.env.DEFAULT_AGENT_ID : "agent-demo"),
          );
          if (input.propertyId) {
            const p = property(input.propertyId as string, user);
            if (p.ownerId !== user.id)
              fail(403, "FORBIDDEN", "只能委托出售自己的房源。");
            if (p.status === "sold")
              fail(409, "INVALID_STATE", "已售房源不能再提交出售委托。");
            assigned = agent(p.agentId);
            if (input.agentId && input.agentId !== assigned)
              fail(400, "INVALID_AGENT", "经纪人必须与房源指定经纪人一致。");
            fields = {
              title: p.title,
              community: p.community,
              city: p.city,
              area: p.area,
              price: p.price,
              ...input,
            };
          }
          fields = { ...fields, ownerId: user.id, agentId: assigned };
          break;
        }
        case "appointments": {
          requireRole(user, ["owner"]);
          const p = property(input.propertyId as string, user);
          if (p.status !== "published")
            fail(409, "INVALID_STATE", "仅已发布房源可以预约。");
          if (Date.parse(input.scheduledAt as string) <= Date.now())
            fail(400, "INVALID_DATE", "预约时间必须晚于当前时间。");
          if (input.agentId && input.agentId !== p.agentId)
            fail(400, "INVALID_AGENT", "经纪人必须与房源指定经纪人一致。");
          fields = { ...input, ownerId: user.id, agentId: agent(p.agentId) };
          break;
        }
        case "collaborations": {
          requireRole(user, ["agent"]);
          const p = property(input.propertyId as string, user);
          if (p.status !== "published")
            fail(409, "INVALID_STATE", "仅已发布房源支持协作。");
          const target = agent(p.agentId);
          if (target === user.id)
            fail(400, "INVALID_TARGET", "请选择其他经纪人负责的房源。");
          if (input.targetAgentId && input.targetAgentId !== target)
            fail(400, "INVALID_AGENT", "接收人必须为该房源负责经纪人。");
          fields = { ...input, agentId: user.id, targetAgentId: target };
          break;
        }
        case "clients":
          requireRole(user, ["agent"]);
          fields = { ...input, agentId: user.id };
          status = "active";
          break;
        case "messages": {
          const recipient = store.user(input.recipientId as string);
          if (
            !recipient ||
            recipient.id === user.id ||
            recipient.status !== "active"
          )
            fail(400, "INVALID_RECIPIENT", "请选择另一位有效用户。");
          // 业主可以联系经纪人或管理员；经纪人联系业主须已有业务关系。
          if (user.role === "owner" && recipient.role === "owner")
            fail(403, "FORBIDDEN", "业主不能向其他业主发送私信。");
          if (user.role === "agent" && recipient.role === "owner") {
            const relationship = [
              "properties",
              "appointments",
              "commissions",
            ].some((c) =>
              store
                .all(c as Collection)
                .some(
                  (r) => r.ownerId === recipient.id && r.agentId === user.id,
                ),
            );
            if (!relationship)
              fail(403, "FORBIDDEN", "与该接收人尚无业务关系。");
          }
          if (input.propertyId) property(input.propertyId as string, user);
          fields = { ...input, senderId: user.id };
          status = "sent";
          break;
        }
        case "feedback":
          fields = { ...input, userId: user.id };
          status = "open";
          break;
        case "questions":
          if (input.propertyId) property(input.propertyId as string, user);
          fields = { ...input, userId: user.id };
          break;
        case "lockRequests": {
          requireRole(user, ["owner", "agent"]);
          const p = property(input.propertyId as string, user);
          if (p.ownerId !== user.id && p.agentId !== user.id)
            fail(403, "FORBIDDEN", "仅业主或指定经纪人可申请模拟门锁审批。");
          fields = {
            ...input,
            requesterId: user.id,
            ownerId: p.ownerId,
            agentId: p.agentId,
            lockEnabled: false,
            unlockEnabled: false,
            unlocked: false,
            disclaimer: "仅模拟申请，审批不触发开锁，未连接任何门锁。",
          };
          break;
        }
      }
      const item = make(fields, status);
      store.put(collection, item);
      audit(user, "create", collection, item.id);
      const recipient =
        collection === "messages"
          ? item.recipientId
          : collection === "collaborations"
            ? item.targetAgentId
            : item.agentId;
      if (typeof recipient === "string" && recipient !== user.id)
        notify(recipient, "收到新的演示请求", item.id);
      return project(collection, item, user);
    });
  });

  app.put("/api/properties/:id", async (req, res) => {
    const user = authenticated(res);
    checkImages(req.body, user);
    const id = idParam(req);
    const input = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        community: z.string().trim().min(1).max(200).optional(),
        city: z.string().trim().min(1).max(200).optional(),
        district: z.string().trim().min(1).max(200).optional(),
        address: z.string().trim().min(1).max(200).optional(),
        price: z.number().finite().positive().max(1_000_000).optional(),
        area: z.number().finite().positive().max(1_000_000).optional(),
        rooms: z.string().trim().min(1).max(200).optional(),
        floor: z.string().trim().min(1).max(200).optional(),
        orientation: z.string().trim().min(1).max(200).optional(),
        decoration: z.string().trim().min(1).max(200).optional(),
        year: z.number().int().min(1800).max(2200).optional(),
        tags: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        images: z
          .array(
            z
              .string()
              .regex(
                /^(?:\/assets\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|svg)|\/uploads\/[a-f0-9]{64}\.(?:png|jpeg))$/,
              ),
          )
          .max(12)
          .optional(),
        description: z.string().trim().min(1).max(5000).optional(),
        ownership: z.string().trim().min(1).max(200).optional(),
        tax: z.string().trim().min(1).max(200).optional(),
        occupancy: z.string().trim().min(1).max(200).optional(),
        delivery: z.string().trim().min(1).max(200).optional(),
        viewing: z.string().trim().min(1).max(200).optional(),
        mortgage: z.string().trim().min(1).max(200).optional(),
        notes: z.string().trim().min(1).max(5000).optional(),
        originalPrice: z.number().finite().positive().max(1_000_000).optional(),
        featured: z.boolean().optional(),
        publishedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .refine(
        (x) => Object.keys(x).length > 0,
        "请至少填写一个可修改的房源字段。",
      )
      .parse(req.body);
    if (user.role !== "admin") await checkContent(req, user, input);
    submission(
      req,
      res,
      user,
      () => {
        const existing = property(id, user);
        if (user.role !== "admin" && existing.ownerId !== user.id)
          fail(403, "FORBIDDEN", "仅房源业主或管理员可以编辑此房源。");
        const updated = {
          ...existing,
          ...input,
          updatedAt: now(),
          ...(existing.status === "published" && user.role !== "admin"
            ? { status: "pending" }
            : {}),
        };
        store.db
          .prepare("DELETE FROM property_checks WHERE property_id=?")
          .run(id);
        if (production() && updated.status === "published")
          updated.status = "pending";
        store.put("properties", updated);
        audit(user, "property.update", "properties", id);
        return project("properties", updated, user);
      },
      200,
    );
  });

  app.patch("/api/:collection/:id", (req, res) => {
    const user = authenticated(res);
    const name = idParam(req, "collection");
    const writable = [...Object.keys(createSchemas), "notifications"];
    if (!writable.includes(name))
      fail(404, "NOT_FOUND", "此数据集合不支持状态修改。");
    const collection = name as Collection;
    const id = idParam(req);
    const input = patchSchema.parse(req.body);
    submission(
      req,
      res,
      user,
      () => {
        const item = store.get(collection, id);
        if (!item || !visible(collection, item, user))
          fail(404, "NOT_FOUND", "记录不存在或不可访问。");
        const r = item!;
        const admin = user.role === "admin";
        const own = r.ownerId === user.id;
        const assigned = user.role === "agent" && r.agentId === user.id;
        let transitions: Record<string, string[]> = {};
        switch (collection) {
          case "properties":
            if (admin)
              transitions = {
                pending: ["published", "rejected"],
                published: ["sold", "pending"],
                rejected: ["pending"],
              };
            else if (own)
              transitions = { rejected: ["pending"], published: ["pending"] };
            break;
          case "commissions":
            if (admin || assigned)
              transitions = {
                pending: ["accepted", "rejected"],
                accepted: ["completed", "cancelled"],
              };
            if (own)
              transitions = { pending: ["cancelled"], accepted: ["cancelled"] };
            break;
          case "appointments":
            if (admin || assigned)
              transitions = {
                pending: ["confirmed", "rejected"],
                confirmed: ["completed", "cancelled"],
              };
            if (own)
              transitions = {
                pending: ["cancelled"],
                confirmed: ["cancelled"],
              };
            break;
          case "collaborations":
            if (admin || r.targetAgentId === user.id)
              transitions = {
                pending: ["accepted", "rejected"],
                accepted: ["completed", "cancelled"],
              };
            if (r.agentId === user.id)
              transitions = { pending: ["cancelled"], accepted: ["cancelled"] };
            break;
          case "clients":
            if (admin || assigned)
              transitions = {
                active: ["contacted", "archived"],
                contacted: ["converted", "archived"],
                converted: ["archived"],
                archived: ["active"],
              };
            break;
          case "messages":
            if (r.recipientId === user.id) transitions = { sent: ["read"] };
            break;
          case "feedback":
            if (admin)
              transitions = {
                open: ["in_progress", "resolved"],
                in_progress: ["resolved"],
              };
            break;
          case "questions":
            if (admin) transitions = { pending: ["answered", "rejected"] };
            break;
          case "lockRequests":
            if (admin || (own && r.requesterId !== user.id))
              transitions = {
                pending: ["approved", "rejected"],
                approved: ["revoked"],
              };
            if (r.requesterId === user.id)
              transitions = { pending: ["cancelled"] };
            break;
          case "notifications":
            if (r.userId === user.id) transitions = { unread: ["read"] };
            break;
        }
        if (!Object.keys(transitions).length)
          fail(403, "FORBIDDEN", "无权修改此记录的状态。");
        if (!transitions[r.status]?.includes(input.status))
          fail(
            409,
            "INVALID_TRANSITION",
            `Cannot change '${r.status}' to '${input.status}'.`,
          );
        if (
          input.answer &&
          !(collection === "questions" && admin && input.status === "answered")
        )
          fail(400, "INVALID_FIELD", "仅管理员回答问题时可以填写答案。");
        if (
          collection === "questions" &&
          input.status === "answered" &&
          !input.answer
        )
          fail(400, "ANSWER_REQUIRED", "请填写答案。");
        if (
          production() &&
          collection === "properties" &&
          input.status === "published"
        ) {
          const checked = store.db
            .prepare("SELECT data FROM property_checks WHERE property_id=?")
            .get(id);
          const info = checked ? JSON.parse(String(checked.data)) : null;
          if (!info?.verified || !info.authorizationConfirmed)
            fail(
              409,
              "PROPERTY_CHECK_REQUIRED",
              "发布前必须完成人工房源核验与业主授权核对。",
            );
        }
        const updated: RecordData = {
          ...r,
          status: input.status,
          updatedAt: now(),
          ...(input.note ? { statusNote: input.note } : {}),
          ...(input.answer ? { answer: input.answer } : {}),
        };
        if (collection === "lockRequests")
          Object.assign(updated, {
            lockEnabled: false,
            unlockEnabled: false,
            unlocked: false,
          });
        store.put(collection, updated);
        audit(user, `status.${input.status}`, collection, id);
        const recipients = new Set([
          r.ownerId,
          r.agentId,
          r.targetAgentId,
          r.requesterId,
          r.userId,
          r.senderId,
        ]);
        for (const recipient of recipients)
          if (typeof recipient === "string" && recipient !== user.id)
            notify(recipient, "演示流程状态已更新", id);
        return project(collection, updated, user);
      },
      200,
    );
  });
  app.use((_req, _res, next) =>
    next(new ApiError(404, "NOT_FOUND", "接口不存在。")),
  );
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ObjectStorageError) {
      res
        .status(502)
        .json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          message: error.issues
            .map(
              (issue) =>
                `${issue.path.join(".") || "请求正文"}：字段格式无效或不允许提交。`,
            )
            .join("; "),
          code: "VALIDATION_ERROR",
        },
      });
      return;
    }
    if (error instanceof ApiError) {
      res
        .status(error.statusCode)
        .json({ error: { message: error.message, code: error.code } });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({
        error: {
          message: "请求正文超过大小限制；JSON 上限为 1MiB，图片上限为 5MiB。",
          code: "PAYLOAD_TOO_LARGE",
        },
      });
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({
        error: { message: "JSON 请求正文格式错误。", code: "INVALID_JSON" },
      });
      return;
    }
    if (error instanceof URIError) {
      res.status(400).json({
        error: {
          message: "网址参数编码错误。",
          code: "VALIDATION_ERROR",
        },
      });
      return;
    }
    if (
      typeof error?.status === "number" &&
      error.status >= 400 &&
      error.status < 500
    ) {
      res.status(error.status).json({
        error: {
          message: "请求正文或编码无效。",
          code: "INVALID_REQUEST",
        },
      });
      return;
    }
    // 禁止返回 SQL 细节、堆栈、请求内容或凭证。
    res.status(500).json({
      error: {
        message: "服务器发生异常，请稍后重试。",
        code: "INTERNAL_ERROR",
      },
    });
  };
  app.use(errorHandler);
  return app;
}
