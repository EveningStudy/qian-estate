import { apiBase, production } from "./config";
import {
  collections,
  type Role,
  type User,
  type Snapshot,
  type Payload,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public unavailable = false,
  ) {
    super(message);
  }
}
export class ApiClient {
  private token = "";
  private base = apiBase;
  async request<T>(
    path: string,
    method = "GET",
    body?: Payload,
    key?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${this.base}/api${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(
          "服务端返回的数据格式无效，请检查连接后重试。",
          response.status,
          response.status >= 500 || response.status === 404,
        );
      }
      if (!response.ok) {
        const error = data as { error?: { message?: string } | string };
        const detail =
          typeof error.error === "string" ? error.error : error.error?.message;
        if (response.status === 401) this.token = "";
        throw new ApiError(
          detail && /[\u3400-\u9fff]/.test(detail)
            ? detail
            : response.status === 401
              ? "登录已失效或配对码无效，请重新登录。"
              : `请求失败（${response.status}），请检查输入、权限和服务配置后重试。`,
          response.status,
          response.status >= 500,
        );
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "无法连接服务端或请求超时。结果尚未确认；请连接后使用同一表单重试。",
        0,
        true,
      );
    } finally {
      window.clearTimeout(timer);
    }
  }
  clear() {
    this.token = "";
  }
  async pair(code: string) {
    const result = await this.request<{ token: string; user: User }>(
      "/auth/admin/pair",
      "POST",
      { code },
    );
    if (!result.token || result.user?.role !== "admin")
      throw new ApiError("配对响应无效，未建立管理会话。");
    this.token = result.token;
    return result.user;
  }
  async login(role: Role) {
    if (production) throw new ApiError("正式环境禁止演示登录。");
    const result = await this.request<{ token: string; user: User }>(
      "/auth/demo",
      "POST",
      { role },
    );
    if (!result.token || result.user?.role !== role)
      throw new ApiError("演示登录响应无效。");
    this.token = result.token;
    return result.user;
  }
  async bootstrap(): Promise<Snapshot> {
    const data = await this.request<Snapshot>("/bootstrap");
    if (!data.user || collections.some((c) => !Array.isArray(data[c])))
      throw new ApiError("初始化响应不完整，请重试。");
    return data;
  }
  async upload(file: File): Promise<{ url: string }> {
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 5 * 1024 * 1024 ||
      !file.size
    )
      throw new ApiError("请选择不超过 5 兆字节的 PNG 或 JPEG 图片。");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${this.base}/api/uploads`, {
        method: "POST",
        body: file,
        signal: controller.signal,
        headers: {
          "Content-Type": file.type,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new ApiError(
          (data as { error?: { message?: string } }).error?.message ||
            `上传失败（${response.status}）`,
          response.status,
        );
      if (
        typeof data.url !== "string" ||
        !/^\/(uploads|assets)\//.test(data.url)
      )
        throw new ApiError("上传结果未确认：服务器未返回有效图片地址。");
      return data as { url: string };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "图片上传结果未确认，请检查网络后重试；尚未写入房源图片列表。",
        0,
        true,
      );
    } finally {
      window.clearTimeout(timer);
    }
  }
}
