import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, cp, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

// SQLite's backup API includes WAL contents; copying a live .sqlite file does not.
const source = resolve(process.env.DATA_DIR || "server/data");
const database = join(source, "qian-estate.sqlite");
await stat(database);
const destination = resolve(
  process.env.BACKUP_DIR || "backups",
  new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(destination, { recursive: true });
const db = new DatabaseSync(database, { readOnly: true });
try {
  await backup(db, join(destination, "qian-estate.sqlite"));
  try {
    await cp(join(source, "uploads"), join(destination, "uploads"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(`Backup saved: ${destination}`);
  console.log(
    "No source files were changed. Store this directory securely; it contains private data.",
  );
} finally {
  db.close();
}
