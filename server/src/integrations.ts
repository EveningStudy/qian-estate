/**
 * 仅供服务端导入；不得将配置、签名请求或上游原始错误返回客户端。
 * 官方依据：
 * https://developer.cloud.tencent.com/mcp/server/11471
 * https://cloud.tencent.com/document/api/382/55981
 * https://cloud.tencent.com/document/api/382/52072
 * https://pay.wechatpay.cn/doc/v3/merchant/4012365342
 * https://pay.wechatpay.cn/doc/v3/merchant/4012365339
 * https://pay.wechatpay.cn/doc/v3/merchant/4012791861
 * 主服务负责鉴权、权限、限流、短信收件人授权与模板变量来源。
 * 支付只生成请求，不发送、不落单；主服务必须读取自己的订单金额，不能透传客户端金额。
 * 回调需保留原始字节，验签解密后在数据库事务中核对订单、金额并按通知编号幂等处理。
 * configured 仅表示配置校验通过，不表示已开通服务或已完成真实联调。
 */
import {
  constants,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  createDecipheriv,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { z } from "zod";

export class IntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}
function reject(code: string, message: string): never {
  throw new IntegrationError(code, message);
}
function checked<T>(schema: z.ZodType<T>, input: unknown, config = false): T {
  const result = schema.safeParse(input);
  if (!result.success)
    reject(
      config ? "INVALID_CONFIG" : "INVALID_INPUT",
      config
        ? "服务配置不完整或格式错误，请检查服务端环境变量。"
        : "请求参数格式错误或包含不允许的字段。",
    );
  return result.data;
}
const text = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\r\n\x00]+$/);
const credential = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const rsaId = z
  .string()
  .regex(/^(?:[A-Fa-f0-9]{1,64}|PUB_KEY_ID_[A-Za-z0-9_]{1,100})$/);
const mapsSchema = z.object({ key: credential }).strict();
const smsSchema = z
  .object({
    secretId: credential,
    secretKey: credential,
    sessionToken: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[^\r\n\x00]+$/)
      .optional(),
    appId: z.string().regex(/^\d{5,20}$/),
    signName: text,
    templateId: z.string().regex(/^\d{1,20}$/),
    region: z.enum(["ap-guangzhou", "ap-nanjing", "ap-beijing"]),
  })
  .strict();
const paySchema = z
  .object({
    appId: z.string().regex(/^wx[A-Za-z0-9]{8,32}$/),
    merchantId: z.string().regex(/^\d{6,20}$/),
    serialNo: z.string().regex(/^[A-Fa-f0-9]{1,64}$/),
    privateKeyPem: z.string().min(100).max(20_000),
    apiV3Key: z.string().regex(/^[\x21-\x7e]{32}$/),
    notifyUrl: z
      .string()
      .url()
      .max(2048)
      .refine((s) => {
        const u = new URL(s);
        return u.protocol === "https:" && !u.username && !u.password && !u.hash;
      }),
    platformPublicKeys: z
      .record(rsaId, z.string().min(100).max(20_000))
      .refine((x) => Object.keys(x).length > 0 && Object.keys(x).length <= 10),
  })
  .strict();
export type MapsConfig = z.infer<typeof mapsSchema>;
export type SmsConfig = z.infer<typeof smsSchema>;
export type WechatPayConfig = z.infer<typeof paySchema>;
export interface IntegrationConfig {
  maps?: MapsConfig;
  sms?: SmsConfig;
  wechatPay?: WechatPayConfig;
}
export type ProviderState = {
  supported: boolean;
  configured: boolean;
  liveVerified: false;
  note: string;
};
export type Transport = (url: string, init: RequestInit) => Promise<Response>;
export interface IntegrationOptions {
  transport?: Transport;
  timeoutMs?: number;
  now?: () => number;
  nonce?: () => string;
}
export interface SignedRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** 只读取指定变量；不自动读取文件，不输出密钥，部分配置一律报错而不是悄悄降级。 */
export function loadIntegrationConfig(
  env: Record<string, string | undefined> = process.env,
): IntegrationConfig {
  const has = (names: string[]) =>
    names.some((name) => env[name] !== undefined);
  const config: IntegrationConfig = {};
  if (has(["TENCENT_MAP_KEY"]))
    config.maps = checked(mapsSchema, { key: env.TENCENT_MAP_KEY }, true);
  if (
    has([
      "TENCENT_SMS_SECRET_ID",
      "TENCENT_SMS_SECRET_KEY",
      "TENCENT_SMS_APP_ID",
      "TENCENT_SMS_SIGN_NAME",
      "TENCENT_SMS_TEMPLATE_ID",
      "TENCENT_SMS_REGION",
      "TENCENT_SMS_SESSION_TOKEN",
    ])
  )
    config.sms = checked(
      smsSchema,
      {
        secretId: env.TENCENT_SMS_SECRET_ID,
        secretKey: env.TENCENT_SMS_SECRET_KEY,
        appId: env.TENCENT_SMS_APP_ID,
        signName: env.TENCENT_SMS_SIGN_NAME,
        templateId: env.TENCENT_SMS_TEMPLATE_ID,
        region: env.TENCENT_SMS_REGION,
        sessionToken: env.TENCENT_SMS_SESSION_TOKEN,
      },
      true,
    );
  if (
    has([
      "WECHAT_PAY_APP_ID",
      "WECHAT_PAY_MCH_ID",
      "WECHAT_PAY_SERIAL_NO",
      "WECHAT_PAY_PRIVATE_KEY_PEM",
      "WECHAT_PAY_API_V3_KEY",
      "WECHAT_PAY_NOTIFY_URL",
      "WECHAT_PAY_PLATFORM_PUBLIC_KEYS_JSON",
    ])
  ) {
    let keys: unknown;
    try {
      keys = JSON.parse(env.WECHAT_PAY_PLATFORM_PUBLIC_KEYS_JSON ?? "null");
    } catch {
      reject("INVALID_CONFIG", "微信支付平台公钥映射必须是有效 JSON。");
    }
    config.wechatPay = checked(
      paySchema,
      {
        appId: env.WECHAT_PAY_APP_ID,
        merchantId: env.WECHAT_PAY_MCH_ID,
        serialNo: env.WECHAT_PAY_SERIAL_NO,
        privateKeyPem: env.WECHAT_PAY_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n"),
        apiV3Key: env.WECHAT_PAY_API_V3_KEY,
        notifyUrl: env.WECHAT_PAY_NOTIFY_URL,
        platformPublicKeys: keys,
      },
      true,
    );
    paymentKeys(config.wechatPay);
  }
  return config;
}
function paymentKeys(config: WechatPayConfig) {
  try {
    const privateKey = createPrivateKey(config.privateKeyPem);
    const publicKeys = new Map(
      Object.entries(config.platformPublicKeys).map(([id, pem]) => [
        id,
        createPublicKey(pem),
      ]),
    );
    for (const key of [privateKey, ...publicKeys.values()])
      if (
        key.asymmetricKeyType !== "rsa" ||
        (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      )
        throw new Error();
    return { privateKey, publicKeys };
  } catch {
    return reject(
      "INVALID_CONFIG",
      "微信支付密钥须为有效的至少 2048 位 RSA 密钥；平台公钥必须由服务端可信配置提供。",
    );
  }
}
const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value, "utf8").digest();
const rsaSign = (key: KeyObject, value: string) =>
  sign("RSA-SHA256", Buffer.from(value), {
    key,
    padding: constants.RSA_PKCS1_PADDING,
  }).toString("base64");
function base64(value: string): Buffer {
  if (!value || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    reject("INVALID_SIGNATURE", "签名或密文编码无效。");
  const result = Buffer.from(value, "base64");
  if (result.toString("base64") !== value)
    reject("INVALID_SIGNATURE", "签名或密文编码无效。");
  return result;
}
function json(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return reject("INVALID_RESPONSE", "服务响应不是有效 JSON。");
  }
}
const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const mapResponse = z.object({
  status: z.number(),
  result: z.unknown().optional(),
  data: z.unknown().optional(),
});
const geocodeSchema = z.object({
  location: pointSchema,
  title: z.string().max(500).optional(),
  address_components: z
    .object({
      province: z.string().optional(),
      city: z.string().optional(),
      district: z.string().optional(),
      street: z.string().optional(),
      street_number: z.string().optional(),
    })
    .optional(),
});
const placesSchema = z
  .array(
    z.object({
      id: z.string().max(200),
      title: z.string().max(500),
      address: z.string().max(1000),
      location: pointSchema,
      province: z.string().optional(),
      city: z.string().optional(),
      district: z.string().optional(),
    }),
  )
  .max(100);
export type GeocodeResult = z.infer<typeof geocodeSchema>;
export type AddressResult = z.infer<typeof placesSchema>[number];

/** 只能由服务端已鉴权的订单记录组装，禁止直接使用请求正文作此参数。单位是分。 */
export interface ServerPaymentOrder {
  outTradeNo: string;
  description: string;
  totalFen: number;
  payerOpenId: string;
}
const orderSchema = z
  .object({
    outTradeNo: z.string().regex(/^[A-Za-z0-9_*-]{6,32}$/),
    description: z
      .string()
      .min(1)
      .max(127)
      .refine((s) => Buffer.byteLength(s) <= 127),
    totalFen: z.number().int().min(1).max(100_000_000),
    payerOpenId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .strict();
export interface PaymentExpectation {
  outTradeNo: string;
  totalFen: number;
  payerOpenId: string;
}
const expectedSchema = orderSchema.omit({ description: true });
const transactionSchema = z.object({
  appid: z.string(),
  mchid: z.string(),
  out_trade_no: z.string(),
  transaction_id: z.string().min(1),
  trade_type: z.literal("JSAPI"),
  trade_state: z.literal("SUCCESS"),
  success_time: z.string().datetime({ offset: true }),
  payer: z.object({ openid: z.string() }),
  amount: z.object({
    total: z.number().int().positive(),
    currency: z.literal("CNY"),
  }),
});
export interface VerifiedPaymentNotification {
  id: string;
  eventType: "TRANSACTION.SUCCESS";
  transaction: z.infer<typeof transactionSchema>;
}

/**
 * 默认使用原生 fetch；测试可注入传输、时钟和随机串，生产不应由请求参数控制这些依赖。
 * 所有地址固定为官方 HTTPS，禁止重定向，不重试短信或支付以免重复外部写入。
 * 地图仅支持服务端密钥方式，未实现额外 SK 签名；请在控制台配置服务端 IP 白名单。
 */
export function createIntegrations(
  input: IntegrationConfig = loadIntegrationConfig(),
  options: IntegrationOptions = {},
) {
  const config: IntegrationConfig = {
    maps:
      input.maps === undefined
        ? undefined
        : checked(mapsSchema, input.maps, true),
    sms:
      input.sms === undefined ? undefined : checked(smsSchema, input.sms, true),
    wechatPay:
      input.wechatPay === undefined
        ? undefined
        : checked(paySchema, input.wechatPay, true),
  };
  const keys = config.wechatPay ? paymentKeys(config.wechatPay) : undefined;
  const timeout = checked(
    z.number().int().min(10).max(30_000),
    options.timeoutMs ?? 8000,
    true,
  );
  const clock = options.now ?? Date.now;
  const nonce = () =>
    checked(
      z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
      (options.nonce ?? (() => randomBytes(16).toString("hex")))(),
    );
  const seconds = () =>
    checked(
      z.number().int().min(1).max(99_999_999_999),
      Math.floor(clock() / 1000),
    );
  const need = <T>(value: T | undefined): T =>
    value ?? reject("NOT_CONFIGURED", "此服务尚未配置，未发起外部请求。");
  const status: Record<"maps" | "sms" | "wechatPay" | "s3", ProviderState> = {
    maps: {
      supported: true,
      configured: !!config.maps,
      liveVerified: false,
      note: "已实现地理编码与地址输入搜索，尚未真实联调。",
    },
    sms: {
      supported: true,
      configured: !!config.sms,
      liveVerified: false,
      note: "已实现签名及发送；主服务须鉴权、限流并授权收件人，尚未真实联调。",
    },
    wechatPay: {
      supported: true,
      configured: !!config.wechatPay,
      liveVerified: false,
      note: "已实现签名请求构造、应答验签及通知验签解密；不发送支付请求、不落单，尚未真实联调。",
    },
    s3: {
      supported: false,
      configured: false,
      liveVerified: false,
      note: "对象存储适配延期，未实现。",
    },
  };
  async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_, rejectTimeout) => {
        timer = setTimeout(() => {
          controller.abort();
          rejectTimeout(
            new IntegrationError(
              "UPSTREAM_TIMEOUT",
              "外部服务请求超时，结果可能不确定，请勿自动重发短信。",
            ),
          );
        }, timeout);
      });
      const operation = (async () => {
        const response = await (options.transport ?? fetch)(url, {
          ...init,
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          reject(
            "UPSTREAM_HTTP",
            "外部服务返回异常状态，请由服务端检查配置或稍后查询。",
          );
        }
        if (!response.body) reject("INVALID_RESPONSE", "外部服务返回空响应。");
        const reader = response.body.getReader();
        const parts: Buffer[] = [];
        let length = 0;
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            length += result.value.byteLength;
            if (length > 1024 * 1024) {
              await reader.cancel();
              reject("INVALID_RESPONSE", "外部服务响应超过安全大小限制。");
            }
            parts.push(Buffer.from(result.value));
          }
        } finally {
          reader.releaseLock();
        }
        return json(Buffer.concat(parts).toString("utf8"));
      })();
      return await Promise.race([operation, timedOut]);
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      return reject(
        "UPSTREAM_NETWORK",
        "外部服务连接失败，未返回密钥或上游原始错误；发送结果可能不确定。",
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function mapCall(path: string, parameters: Record<string, string>) {
    const map = need(config.maps);
    const url = new URL(`https://apis.map.qq.com${path}`);
    url.search = new URLSearchParams({
      ...parameters,
      key: map.key,
    }).toString();
    const result = checked(
      mapResponse,
      await fetchJson(url.href, { method: "GET" }),
    );
    if (result.status !== 0)
      reject("MAP_REJECTED", "腾讯地图查询失败，请检查服务权限和额度。");
    return result;
  }
  /** 返回裁剪后的地址信息，不返回密钥、完整请求地址或上游任意字段。 */
  async function geocode(input: {
    address: string;
    city?: string;
  }): Promise<GeocodeResult> {
    const data = checked(
      z.object({ address: text, city: text.optional() }).strict(),
      input,
    );
    const result = await mapCall("/ws/geocoder/v1/", {
      address: data.address,
      ...(data.city ? { region: data.city } : {}),
    });
    return checked(geocodeSchema, result.result);
  }
  /** 地址输入提示按城市限定，主服务仍须限流以保护地图额度。 */
  async function searchAddresses(input: {
    keyword: string;
    city: string;
  }): Promise<AddressResult[]> {
    const data = checked(
      z.object({ keyword: text, city: text }).strict(),
      input,
    );
    return checked(
      placesSchema,
      (
        await mapCall("/ws/place/v1/suggestion", {
          keyword: data.keyword,
          region: data.city,
          region_fix: "1",
        })
      ).data,
    );
  }
  /** 固定已审核模板与签名；收件人和变量必须由主服务授权，不是公开短信网关。 */
  function signSmsRequest(input: {
    phoneNumber: string;
    templateParams: string[];
  }): SignedRequest {
    const sms = need(config.sms);
    const data = checked(
      z
        .object({
          phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
          templateParams: z.array(z.string().max(100)).max(20),
        })
        .strict(),
      input,
    );
    const body = JSON.stringify({
      PhoneNumberSet: [data.phoneNumber],
      SmsSdkAppId: sms.appId,
      SignName: sms.signName,
      TemplateId: sms.templateId,
      TemplateParamSet: data.templateParams,
    });
    const timestamp = seconds();
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const scope = `${date}/sms/tc3_request`;
    const canonicalHeaders =
      "content-type:application/json; charset=utf-8\nhost:sms.tencentcloudapi.com\nx-tc-action:sendsms\n";
    const signedHeaders = "content-type;host;x-tc-action";
    const canonical = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha(body)}`;
    const signingKey = hmac(
      hmac(hmac(`TC3${sms.secretKey}`, date), "sms"),
      "tc3_request",
    );
    const signature = hmac(
      signingKey,
      `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonical)}`,
    ).toString("hex");
    return {
      url: "https://sms.tencentcloudapi.com/",
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Host: "sms.tencentcloudapi.com",
        "X-TC-Action": "SendSms",
        "X-TC-Version": "2021-01-11",
        "X-TC-Region": sms.region,
        "X-TC-Timestamp": String(timestamp),
        ...(sms.sessionToken ? { "X-TC-Token": sms.sessionToken } : {}),
        Authorization: `TC3-HMAC-SHA256 Credential=${sms.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    };
  }
  /** 只发送一次；超时后需人工或业务查询确认，禁止自动换验证码重发。 */
  async function sendSms(input: {
    phoneNumber: string;
    templateParams: string[];
  }): Promise<{ accepted: true; requestId: string; serialNo: string }> {
    const request = signSmsRequest(input);
    const envelope = checked(
      z.object({
        Response: z.object({
          RequestId: z.string(),
          Error: z.unknown().optional(),
          SendStatusSet: z
            .array(
              z.object({
                Code: z.string(),
                SerialNo: z.string(),
                PhoneNumber: z.string(),
              }),
            )
            .optional(),
        }),
      }),
      await fetchJson(request.url, request),
    );
    const response = envelope.Response;
    const item = response.SendStatusSet?.[0];
    if (
      response.Error ||
      response.SendStatusSet?.length !== 1 ||
      !item ||
      item.Code !== "Ok" ||
      !item.SerialNo ||
      item.PhoneNumber !== input.phoneNumber
    )
      reject(
        "SMS_REJECTED",
        "腾讯云未确认短信受理，请检查模板、收件人和额度；不要自动重发。",
      );
    return {
      accepted: true,
      requestId: response.RequestId,
      serialNo: item.SerialNo,
    };
  }
  /** 只构造下单请求。返回值只交给主服务的受控传输层，不能返回客户端。 */
  function buildJsapiOrderRequest(order: ServerPaymentOrder): SignedRequest {
    const pay = need(config.wechatPay);
    const data = checked(orderSchema, order);
    const body = JSON.stringify({
      appid: pay.appId,
      mchid: pay.merchantId,
      description: data.description,
      out_trade_no: data.outTradeNo,
      notify_url: pay.notifyUrl,
      amount: { total: data.totalFen, currency: "CNY" },
      payer: { openid: data.payerOpenId },
    });
    const path = "/v3/pay/transactions/jsapi",
      timestamp = String(seconds()),
      n = nonce();
    const signature = rsaSign(
      need(keys).privateKey,
      `POST\n${path}\n${timestamp}\n${n}\n${body}\n`,
    );
    return {
      url: `https://api.mch.weixin.qq.com${path}`,
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${pay.merchantId}",nonce_str="${n}",timestamp="${timestamp}",serial_no="${pay.serialNo}",signature="${signature}"`,
      },
    };
  }
  /** 仅对已验签下单应答中的 prepay_id 调用；前端支付成功提示不能当作到账凭据。 */
  function signJsapiParameters(prepayId: string) {
    const pay = need(config.wechatPay);
    checked(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), prepayId);
    const timeStamp = String(seconds()),
      nonceStr = nonce(),
      packageValue = `prepay_id=${prepayId}`;
    return {
      appId: pay.appId,
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: "RSA" as const,
      paySign: rsaSign(
        need(keys).privateKey,
        `${pay.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`,
      ),
    };
  }
  /** 应答与回调共用原始字节验签；只信任预配置公钥标识，拒绝过期或未来超过五分钟的消息。 */
  function verifyWechatSignature(rawBody: Buffer, headers: Headers): void {
    const payKeys = need(keys);
    if (!Buffer.isBuffer(rawBody) || rawBody.length > 1024 * 1024)
      reject("INVALID_SIGNATURE", "验签必须提供不超过 1MB 的原始请求字节。");
    const timestamp = headers.get("Wechatpay-Timestamp") ?? "",
      n = headers.get("Wechatpay-Nonce") ?? "",
      serial = headers.get("Wechatpay-Serial") ?? "",
      signature = headers.get("Wechatpay-Signature") ?? "";
    if (
      !/^\d{1,11}$/.test(timestamp) ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(n) ||
      Math.abs(seconds() - Number(timestamp)) > 300 ||
      !payKeys.publicKeys.has(serial)
    )
      reject(
        "INVALID_SIGNATURE",
        "微信支付签名头无效、时间戳过期或公钥标识未受信任。",
      );
    let valid = false;
    try {
      valid = verify(
        "RSA-SHA256",
        Buffer.concat([
          Buffer.from(`${timestamp}\n${n}\n`),
          rawBody,
          Buffer.from("\n"),
        ]),
        {
          key: payKeys.publicKeys.get(serial)!,
          padding: constants.RSA_PKCS1_PADDING,
        },
        base64(signature),
      );
    } catch {
      /* 对外统一验签错误，不泄漏密钥或底层异常。 */
    }
    if (!valid)
      reject("INVALID_SIGNATURE", "微信支付验签失败，拒绝处理此消息。");
  }
  /** 主服务收到下单 HTTP 成功响应后调用，验签通过后才向前端提供二次签名参数。 */
  function parseJsapiOrderResponse(
    rawBody: Buffer,
    headers: Headers,
  ): { prepayId: string } {
    verifyWechatSignature(rawBody, headers);
    const data = checked(
      z.object({ prepay_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }),
      json(rawBody.toString("utf8")),
    );
    return { prepayId: data.prepay_id };
  }
  /**
   * 原始回调先验签再解密，再核对服务端期望订单。返回不等于已入账。
   * 主服务需持久化通知编号去重、验证当前订单状态、事务更新并在提交成功后应答微信。
   * 平台公钥轮换由运维从可信渠道更新配置；这里不自动信任回调附带的证书。
   */
  function verifyAndDecryptNotification(
    rawBody: Buffer,
    headers: Headers,
    expected: PaymentExpectation,
  ): VerifiedPaymentNotification {
    const pay = need(config.wechatPay);
    const order = checked(expectedSchema, expected);
    verifyWechatSignature(rawBody, headers);
    const envelope = checked(
      z.object({
        id: z.string().min(1).max(128),
        event_type: z.literal("TRANSACTION.SUCCESS"),
        resource_type: z.literal("encrypt-resource"),
        resource: z.object({
          algorithm: z.literal("AEAD_AES_256_GCM"),
          original_type: z.literal("transaction"),
          ciphertext: z.string().max(1_000_000),
          nonce: z.string().refine((x) => Buffer.byteLength(x) === 12),
          associated_data: z.string().max(1024).optional(),
        }),
      }),
      json(rawBody.toString("utf8")),
    );
    const resource = envelope.resource,
      ciphertext = base64(resource.ciphertext);
    if (ciphertext.length < 17)
      reject("INVALID_CIPHERTEXT", "微信支付通知密文长度无效。");
    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(pay.apiV3Key),
        Buffer.from(resource.nonce),
      );
      decipher.setAuthTag(ciphertext.subarray(-16));
      decipher.setAAD(Buffer.from(resource.associated_data ?? ""));
      plaintext = Buffer.concat([
        decipher.update(ciphertext.subarray(0, -16)),
        decipher.final(),
      ]);
    } catch {
      return reject(
        "INVALID_CIPHERTEXT",
        "微信支付通知解密失败，拒绝更新订单。",
      );
    }
    const transaction = checked(
      transactionSchema,
      json(plaintext.toString("utf8")),
    );
    if (
      transaction.appid !== pay.appId ||
      transaction.mchid !== pay.merchantId ||
      transaction.out_trade_no !== order.outTradeNo ||
      transaction.amount.total !== order.totalFen ||
      transaction.payer.openid !== order.payerOpenId
    )
      reject(
        "PAYMENT_MISMATCH",
        "支付商户、应用、订单、付款人或金额与服务端记录不一致。",
      );
    return { id: envelope.id, eventType: envelope.event_type, transaction };
  }
  return {
    status,
    geocode,
    searchAddresses,
    signSmsRequest,
    sendSms,
    buildJsapiOrderRequest,
    signJsapiParameters,
    verifyWechatSignature,
    parseJsapiOrderResponse,
    verifyAndDecryptNotification,
  };
}
export type Integrations = ReturnType<typeof createIntegrations>;
