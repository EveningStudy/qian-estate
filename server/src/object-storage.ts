/**
 * 服务端可选 S3 适配，不注册路由，不读写数据库或本地文件，不接受用户文件名。
 * 官方依据：
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Class/PutObjectCommand/
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/
 * 主服务须先鉴权并核对对象归属，再调用 upload/getUrl。密钥配置只能来自服务端。
 * 上传只返回对象 key；主服务应保存 key，不能保存短期签名 URL 或将 key 当作访问授权。
 * 不设置公开 ACL，兼容禁用 ACL 的桶；运维仍须开启阻止公共访问并禁用公开桶策略。
 * configured 只表示本地配置完整，不证明远端桶私有、凭证有效或已完成真实联调。
 * 不提供流式代理；授权后的签名 GET URL 支持客户端直接读取，主服务不缓存文件内容。
 */
import { randomBytes } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { inspectImage } from "./uploads.js";

export const OBJECT_PREFIX = "qian-estate/uploads/";
export const OBJECT_MAX_BYTES = 5 * 1024 * 1024;
export type ObjectMime = "image/png" | "image/jpeg";
const mimeSchema = z.enum(["image/png", "image/jpeg"]);
const keySchema = z
  .string()
  .regex(/^qian-estate\/uploads\/[a-f0-9]{64}\.(png|jpeg)$/);
export class ObjectStorageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ObjectStorageError";
  }
}
function fail(code: string, message: string): never {
  throw new ObjectStorageError(code, message);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, config = false): T {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(
      config ? "INVALID_CONFIG" : "INVALID_INPUT",
      config
        ? "对象存储配置不完整或格式错误，请检查服务端环境变量。"
        : "对象 key、类型或参数格式无效。",
    );
  return result.data;
}
const configSchema = z
  .object({
    endpoint: z.string().url().max(2048).optional(),
    region: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    bucket: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)
      .refine(
        (s) =>
          !s.includes("..") &&
          !s.includes(".-") &&
          !s.includes("-.") &&
          !/^\d+\.\d+\.\d+\.\d+$/.test(s),
      ),
    accessKeyId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
    secretAccessKey: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[\x21-\x7e]+$/),
    forcePathStyle: z.boolean().default(false),
    nodeEnv: z
      .enum(["development", "test", "production"])
      .default("development"),
  })
  .strict();
export type ObjectStorageConfig = z.infer<typeof configSchema>;
export type ObjectStorageConfigInput = z.input<typeof configSchema>;
export interface ObjectStorageOptions {
  timeoutMs?: number;
  getUrlExpiresIn?: number;
  /** 仅供可信测试依赖注入，禁止由请求正文指定传输器。 */
  requestHandler?: S3ClientConfig["requestHandler"];
}
export interface StoredObject {
  key: string;
  size: number;
  mime: ObjectMime;
  etag?: string;
}
export interface ObjectStorageStatus {
  supported: true;
  configured: boolean;
  liveVerified: false;
  access: "private";
  note: string;
}

function validateConfig(input: ObjectStorageConfigInput): ObjectStorageConfig {
  const config = parse(configSchema, input, true);
  if (config.endpoint) {
    const url = new URL(config.endpoint);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && local && config.nodeEnv !== "production"))
    )
      fail(
        "INVALID_CONFIG",
        "对象存储端点必须为无路径、凭证和查询参数的 HTTPS 地址；仅本地开发或测试允许回环 HTTP。",
      );
    config.endpoint = url.origin;
  }
  return config;
}

/** 不设置任何 S3 变量即禁用；部分配置报错。AWS 可省略端点，兼容存储需指定端点。 */
export function loadObjectStorageConfig(
  env: Record<string, string | undefined> = process.env,
): ObjectStorageConfig | undefined {
  const names = [
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_FORCE_PATH_STYLE",
  ];
  if (!names.some((name) => env[name] !== undefined)) return undefined;
  if (
    env.S3_FORCE_PATH_STYLE !== undefined &&
    !["true", "false"].includes(env.S3_FORCE_PATH_STYLE)
  )
    fail("INVALID_CONFIG", "S3_FORCE_PATH_STYLE 只能设置为 true 或 false。");
  return validateConfig({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION!,
    bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    nodeEnv: (env.NODE_ENV ?? "development") as ObjectStorageConfig["nodeEnv"],
  });
}

/** 在服务端生成 key，禁止用原始文件名或客户端传入的 key 替代；随机名称不是鉴权机制。 */
export function createObjectKey(mime: ObjectMime): string {
  const valid = parse(mimeSchema, mime);
  return `${OBJECT_PREFIX}${randomBytes(32).toString("hex")}.${valid === "image/png" ? "png" : "jpeg"}`;
}

/**
 * 默认关闭 SDK 自动重试；超时结果可能不确定，主服务应保留 key 并核对后再决定下一步。
 * 固定前缀与 IfNoneMatch 防止任意键写入和覆盖；兼容服务不支持条件写入时直接报错，不降级。
 * 预签名 URL 是短期持有者凭证，禁止日志记录和长期存储；生成链接不会检查对象是否存在。
 */
export function createObjectStorage(
  input: ObjectStorageConfigInput | undefined = loadObjectStorageConfig(),
  options: ObjectStorageOptions = {},
) {
  const config = input === undefined ? undefined : validateConfig(input);
  const timeoutMs = parse(
    z.number().int().min(10).max(30_000),
    options.timeoutMs ?? 8000,
    true,
  );
  const expiresIn = parse(
    z.number().int().min(1).max(900),
    options.getUrlExpiresIn ?? 300,
    true,
  );
  const client = config
    ? new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle: config.forcePathStyle,
        maxAttempts: 1,
        followRegionRedirects: false,
        requestHandler: options.requestHandler,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      })
    : undefined;
  let closed = false;
  const status: Readonly<ObjectStorageStatus> = Object.freeze({
    supported: true,
    configured: !!config,
    liveVerified: false,
    access: "private",
    note: "默认不公开对象；需运维确认桶策略及公共访问阻止设置，尚未真实联调。",
  });
  function requireClient(): S3Client {
    if (closed) fail("STORAGE_CLOSED", "对象存储适配器已关闭。");
    return (
      client ?? fail("NOT_CONFIGURED", "对象存储未配置，未发起上传或读取请求。")
    );
  }
  async function bounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new ObjectStorageError(
              "STORAGE_TIMEOUT",
              "对象存储请求超时，上传结果可能不确定，请保留 key 核对后再处理。",
            ),
          );
        }, timeoutMs);
      });
      return await Promise.race([operation(controller.signal), deadline]);
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      if (
        error &&
        typeof error === "object" &&
        "$metadata" in error &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 412
      )
        fail("OBJECT_EXISTS", "对象 key 已存在，已拒绝覆盖。");
      return fail(
        "STORAGE_FAILED",
        "对象存储操作失败；请由服务端核对配置、权限和对象状态，不自动重试。",
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  /** 支持已校验的 PNG/JPEG 缓冲区，最大 5MiB；复用图片结构与像素尺寸校验。 */
  async function upload(
    key: string,
    body: Buffer,
    mime: ObjectMime,
  ): Promise<StoredObject> {
    const s3 = requireClient();
    const validKey = parse(keySchema, key),
      validMime = parse(mimeSchema, mime);
    if (
      !Buffer.isBuffer(body) ||
      body.length === 0 ||
      body.length > OBJECT_MAX_BYTES
    )
      fail("INVALID_BODY", "上传内容必须为非空 Buffer，且不能超过 5MiB。");
    if (!validKey.endsWith(validMime === "image/png" ? ".png" : ".jpeg"))
      fail("INVALID_INPUT", "对象 key 扩展名与图片类型不一致。");
    // 复制缓冲区，避免调用方在校验之后改变实际上传内容。
    const bytes = Buffer.from(body);
    try {
      inspectImage(bytes, validMime);
    } catch {
      fail(
        "INVALID_IMAGE",
        "图片内容、类型或尺寸无效，只接受结构完整且不超过 20MP 的 PNG/JPEG。",
      );
    }
    const result = await bounded((signal) =>
      s3.send(
        new PutObjectCommand({
          Bucket: config!.bucket,
          Key: validKey,
          Body: bytes,
          ContentType: validMime,
          ContentLength: bytes.length,
          CacheControl: "private, no-store",
          ContentDisposition: "inline",
          IfNoneMatch: "*",
        }),
        { abortSignal: signal },
      ),
    );
    return {
      key: validKey,
      size: bytes.length,
      mime: validMime,
      ...(result.ETag ? { etag: result.ETag } : {}),
    };
  }
  /** 必须先核对调用者的对象读取权限；只生成有效期固定、最多十五分钟的 GET 链接。 */
  async function getUrl(key: string): Promise<string> {
    const s3 = requireClient();
    const validKey = parse(keySchema, key);
    return bounded(() =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: config!.bucket,
          Key: validKey,
          ResponseCacheControl: "private, no-store",
          ResponseContentType: validKey.endsWith(".png")
            ? "image/png"
            : "image/jpeg",
          ResponseContentDisposition: "inline",
        }),
        { expiresIn },
      ),
    );
  }
  /** 应用退出时释放 SDK 连接池；不会删除任何对象。 */
  function close(): void {
    if (!closed) {
      closed = true;
      client?.destroy();
    }
  }
  return { status, createKey: createObjectKey, upload, getUrl, close };
}
export type ObjectStorage = ReturnType<typeof createObjectStorage>;
