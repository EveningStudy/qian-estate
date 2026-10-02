import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? undefined : value),
  z.string().trim().min(1).optional(),
);
export const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z
    .string()
    .refine((host) => isIP(host) !== 0 || host === "localhost")
    .optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  DATA_DIR: optionalText,
  WECHAT_OWNER_APPID: optionalText,
  WECHAT_OWNER_SECRET: optionalText,
  WECHAT_AGENT_APPID: optionalText,
  WECHAT_AGENT_SECRET: optionalText,
  CORS_ORIGINS: optionalText,
  DEFAULT_AGENT_ID: optionalText,
  PUBLIC_APP_URL: optionalText,
});
export type AppConfig = z.infer<typeof configSchema> & { HOST: string };

/** 仅检查配置完整性，不验证远端凭据真实性，也不输出凭据值。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `环境变量格式无效：${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join("、")}。`,
    );
  const config = result.data;
  config.HOST ??= config.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
  const { WECHAT_OWNER_APPID: appid, WECHAT_OWNER_SECRET: secret } = config;
  if (config.NODE_ENV === "production" || appid || secret) {
    if (!appid || !secret)
      throw new Error(
        "必须同时配置 WECHAT_OWNER_APPID 和 WECHAT_OWNER_SECRET；生产环境不允许缺少微信业主登录配置。",
      );
    if (!/^wx[a-fA-F0-9]{16}$/.test(appid) || !/^[a-fA-F0-9]{32}$/.test(secret))
      throw new Error(
        "WECHAT_OWNER_APPID 或 WECHAT_OWNER_SECRET 格式无效，请填写微信平台提供的凭据，不要使用模板占位符。",
      );
  }
  if (
    config.NODE_ENV === "production" &&
    (!config.DATA_DIR || !isAbsolute(config.DATA_DIR))
  )
    throw new Error("生产环境 DATA_DIR 必须是持久化数据目录的绝对路径。");
  if (
    config.NODE_ENV === "production" ||
    config.WECHAT_AGENT_APPID ||
    config.WECHAT_AGENT_SECRET
  ) {
    if (
      !/^wx[a-fA-F0-9]{16}$/.test(config.WECHAT_AGENT_APPID ?? "") ||
      !/^[a-fA-F0-9]{32}$/.test(config.WECHAT_AGENT_SECRET ?? "")
    )
      throw new Error(
        "WECHAT_AGENT_APPID 和 WECHAT_AGENT_SECRET 必须成对填写有效格式的联卖端凭据。",
      );
  }
  if (config.NODE_ENV === "production" || config.PUBLIC_APP_URL) {
    try {
      const url = new URL(config.PUBLIC_APP_URL ?? "");
      if (
        url.protocol !== "https:" ||
        !url.hostname ||
        url.hostname.includes("*") ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw new Error();
    } catch {
      throw new Error(
        "PUBLIC_APP_URL 必须配置为有效的 HTTPS 站点根地址，不允许用户信息、查询参数或片段。",
      );
    }
  }
  if (config.CORS_ORIGINS) {
    for (const origin of config.CORS_ORIGINS.split(",").map((value) =>
      value.trim(),
    )) {
      try {
        const url = new URL(origin);
        if (
          url.origin !== origin ||
          url.username ||
          url.password ||
          (config.NODE_ENV === "production"
            ? url.protocol !== "https:"
            : !["http:", "https:"].includes(url.protocol))
        )
          throw new Error();
      } catch {
        throw new Error(
          "CORS_ORIGINS 必须是逗号分隔的精确来源地址，生产环境只允许 HTTPS，不能包含路径、通配符或用户信息。",
        );
      }
    }
  }
  if (
    config.DEFAULT_AGENT_ID &&
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(config.DEFAULT_AGENT_ID)
  )
    throw new Error(
      "DEFAULT_AGENT_ID 格式无效，必须指向已有的正式经纪人账户。",
    );
  return { ...config, HOST: config.HOST };
}
