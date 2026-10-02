import { Store } from "../server/src/db.js";
import { initializeAuth } from "../server/src/auth.js";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// 只允许持有服务器终端权限的维护人员授予角色，不创建默认管理员密码。
const [id, role, confirm] = process.argv.slice(2);
if (
  !id ||
  !["admin", "agent", "owner"].includes(role || "") ||
  confirm !== "--confirm"
) {
  console.error(
    "用法：npm run account:role -- 用户编号 admin|agent|owner --confirm",
  );
  process.exit(1);
}
const store = new Store(
  resolve(process.env.DATA_DIR || "server/data", "qian-estate.sqlite"),
);
try {
  initializeAuth(store);
  const user = store.user(id);
  if (!user || user.status !== "active")
    throw new Error("用户不存在或已停用，请先在微信小程序中登录。");
  if (id.endsWith("-demo") || id.endsWith("-other"))
    throw new Error("不得通过本命令提升演示身份权限。");
  const now = new Date().toISOString();
  store.transaction(() => {
    store.putUser({
      ...user,
      role: role as "owner" | "agent" | "admin",
      updatedAt: now,
    });
    if (role === "agent")
      store.put("agents", {
        id,
        name: user.name,
        city: user.city || "",
        company: "待完善机构信息",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    else {
      const old = store.get("agents", id);
      if (old)
        store.put("agents", { ...old, status: "inactive", updatedAt: now });
    }
    store.db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    store.put("audit", {
      id: randomUUID(),
      status: "recorded",
      createdAt: now,
      updatedAt: now,
      actorId: "server-operator",
      actorRole: "admin",
      action: "服务器角色授权",
      collection: "users",
      recordId: id,
      role,
    });
  });
  console.log("角色已更新，旧会话已失效。请在小程序中重新登录。");
} finally {
  store.close();
}
