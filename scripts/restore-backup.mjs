import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, access, cp } from "node:fs/promises";
import { resolve, join } from "node:path";

// 恢复只写入全新目录，绝不覆盖当前服务的数据或自动切换线上目录。
const [sourceInput, targetInput] = process.argv.slice(2);
if (!sourceInput || !targetInput)
  throw new Error(
    "用法：node scripts/restore-backup.mjs 备份目录 新的恢复目录",
  );
const source = resolve(sourceInput),
  target = resolve(targetInput);
try {
  await access(target);
  throw new Error("恢复目标已存在，拒绝覆盖，请指定全新目录。");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const db = new DatabaseSync(join(source, "qian-estate.sqlite"), {
  readOnly: true,
});
try {
  const checks = db.prepare("PRAGMA integrity_check").all();
  if (checks.length !== 1 || Object.values(checks[0])[0] !== "ok")
    throw new Error("备份数据库完整性检查失败，未开始恢复。");
  await mkdir(target, { recursive: false });
  await backup(db, join(target, "qian-estate.sqlite"));
  try {
    await cp(join(source, "uploads"), join(target, "uploads"), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const restored = new DatabaseSync(join(target, "qian-estate.sqlite"));
  try {
    restored.exec("DELETE FROM sessions");
    if (
      restored
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='real_sessions'",
        )
        .get()
    )
      restored.exec("DELETE FROM real_sessions");
    if (
      restored
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_pairing'",
        )
        .get()
    )
      restored.exec("DELETE FROM admin_pairing");
  } finally {
    restored.close();
  }
  console.log(
    `已恢复到新目录：${target}。旧会话已撤销；未切换线上服务，未改变原备份或原数据库。`,
  );
  console.log(
    "对象存储文件需单独核对版本；恢复前后发生的业务和注销请求需人工对账。",
  );
} finally {
  db.close();
}
