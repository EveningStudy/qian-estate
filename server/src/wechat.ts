import { ApiError } from "./validation.js";

export type MiniApp = "owner" | "agent";
export interface WechatIdentity {
  openid: string;
  unionid?: string;
}
type Transport = typeof fetch;

/** 密钥只在服务端读取；两端分别缓存凭证，不把会话密钥返回客户端。 */
export function createWechat(
  env: NodeJS.ProcessEnv = process.env,
  transport: Transport = fetch,
) {
  const tokens = new Map<string, { value: string; expires: number }>();
  const pending = new Map<string, Promise<string>>();
  function credentials(app: MiniApp) {
    const prefix = `WECHAT_${app.toUpperCase()}`;
    const appid = env[`${prefix}_APPID`];
    const secret = env[`${prefix}_SECRET`];
    if (!appid || !secret)
      throw new ApiError(
        503,
        "WECHAT_NOT_CONFIGURED",
        `尚未配置${app === "owner" ? "业主端" : "联卖端"}微信应用凭证，请联系部署人员。`,
      );
    return { appid, secret };
  }
  async function call(url: URL, body?: unknown): Promise<Record<string, any>> {
    let response: Response;
    try {
      response = await transport(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
    } catch {
      throw new ApiError(
        502,
        "WECHAT_UNAVAILABLE",
        "微信服务请求失败或超时，请重新授权后再试。",
      );
    }
    let result: Record<string, any>;
    try {
      result = await response.json();
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw new Error();
    } catch {
      throw new ApiError(
        502,
        "WECHAT_RESPONSE_INVALID",
        "微信服务返回格式异常。",
      );
    }
    if (!response.ok || (result.errcode && result.errcode !== 0)) {
      throw new ApiError(
        502,
        "WECHAT_REJECTED",
        `微信服务未接受本次请求（编号：${Number(result.errcode) || response.status}），请检查应用权限或重新授权。`,
      );
    }
    return result;
  }
  async function token(app: MiniApp): Promise<string> {
    const { appid, secret } = credentials(app);
    const cached = tokens.get(appid);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (pending.has(appid)) return pending.get(appid)!;
    const operation = (async () => {
      const result = await call(
        new URL("https://api.weixin.qq.com/cgi-bin/stable_token"),
        {
          grant_type: "client_credential",
          appid,
          secret,
          force_refresh: false,
        },
      );
      if (
        typeof result.access_token !== "string" ||
        !Number.isFinite(result.expires_in) ||
        result.expires_in <= 0
      )
        throw new ApiError(
          502,
          "WECHAT_RESPONSE_INVALID",
          "微信未返回有效接口凭证。",
        );
      tokens.set(appid, {
        value: result.access_token,
        expires: Date.now() + Math.max(1, result.expires_in - 120) * 1000,
      });
      return result.access_token as string;
    })();
    pending.set(appid, operation);
    try {
      return await operation;
    } finally {
      pending.delete(appid);
    }
  }
  async function login(app: MiniApp, code: string): Promise<WechatIdentity> {
    const { appid, secret } = credentials(app);
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.search = new URLSearchParams({
      appid,
      secret,
      js_code: code,
      grant_type: "authorization_code",
    }).toString();
    const result = await call(url);
    if (typeof result.openid !== "string" || !result.openid)
      throw new ApiError(
        502,
        "WECHAT_RESPONSE_INVALID",
        "微信未返回用户标识。",
      );
    return {
      openid: result.openid,
      ...(typeof result.unionid === "string"
        ? { unionid: result.unionid }
        : {}),
    };
  }
  async function phone(app: MiniApp, code: string): Promise<string> {
    const url = new URL(
      "https://api.weixin.qq.com/wxa/business/getuserphonenumber",
    );
    url.searchParams.set("access_token", await token(app));
    const result = await call(url, { code });
    const info = result.phone_info;
    if (
      !info ||
      String(info.countryCode) !== "86" ||
      !/^1\d{10}$/.test(info.purePhoneNumber) ||
      info.watermark?.appid !== credentials(app).appid
    )
      throw new ApiError(
        502,
        "PHONE_RESPONSE_INVALID",
        "微信未返回当前应用的有效中国大陆手机号。",
      );
    return info.purePhoneNumber;
  }
  async function subscribe(
    app: MiniApp,
    openid: string,
    template: string,
    data: Record<string, { value: string }>,
    page = "pages/home/index",
  ) {
    const url = new URL(
      "https://api.weixin.qq.com/cgi-bin/message/subscribe/send",
    );
    url.searchParams.set("access_token", await token(app));
    await call(url, {
      touser: openid,
      template_id: template,
      page,
      data,
      miniprogram_state: env.NODE_ENV === "production" ? "formal" : "trial",
      lang: "zh_CN",
    });
  }
  async function checkText(app: MiniApp, openid: string, content: string) {
    const url = new URL("https://api.weixin.qq.com/wxa/msg_sec_check");
    url.searchParams.set("access_token", await token(app));
    const result = await call(url, { openid, scene: 2, version: 2, content });
    if (result.result?.suggest !== "pass")
      throw new ApiError(
        422,
        "CONTENT_REJECTED",
        "内容未通过安全检查，请修改后再提交。",
      );
  }
  return { login, phone, subscribe, checkText, credentials };
}
