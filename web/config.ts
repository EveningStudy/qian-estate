export const production =
  import.meta.env.PROD || import.meta.env.VITE_APP_MODE === "production";
// 基地址填写服务端源站或反向代理前缀，不包含末尾的 /api。
export const apiBase = (import.meta.env.VITE_API_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");
export const assetUrl = (path: string) =>
  path.startsWith("/") && !path.startsWith("//") ? `${apiBase}${path}` : "";
