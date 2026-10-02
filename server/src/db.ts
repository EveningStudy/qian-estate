import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { seed } from "./seed.js";

export type Role = "owner" | "agent" | "admin";
export type RecordData = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  [key: string]: unknown;
};
export type User = {
  id: string;
  role: Role;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  phone?: string;
  avatar?: string;
  city?: string;
  bio?: string;
};
export const collections = [
  "properties",
  "agents",
  "transactions",
  "faqs",
  "favorites",
  "appointments",
  "commissions",
  "collaborations",
  "clients",
  "messages",
  "feedback",
  "lockRequests",
  "notifications",
  "audit",
  "questions",
] as const;
export type Collection = (typeof collections)[number];

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS uploads (name TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS idempotency (user_id TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,key));
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    if (
      process.env.NODE_ENV !== "production" &&
      !this.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get("seedVersion")
    ) {
      this.transaction(() => {
        seed(this);
        this.db
          .prepare("INSERT INTO metadata VALUES (?,?)")
          .run("seedVersion", "1");
      });
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  all(collection: Collection): RecordData[] {
    return this.db
      .prepare("SELECT data FROM records WHERE collection=? ORDER BY rowid")
      .all(collection)
      .map((row) => JSON.parse(row.data as string));
  }
  get(collection: Collection, id: string): RecordData | undefined {
    const row = this.db
      .prepare("SELECT data FROM records WHERE collection=? AND id=?")
      .get(collection, id);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  put(collection: Collection, record: RecordData): void {
    this.db
      .prepare(
        "INSERT INTO records VALUES (?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data",
      )
      .run(collection, record.id, JSON.stringify(record));
  }
  remove(collection: Collection, id: string): void {
    this.db
      .prepare("DELETE FROM records WHERE collection=? AND id=?")
      .run(collection, id);
  }
  user(id: string): User | undefined {
    const row = this.db.prepare("SELECT data FROM users WHERE id=?").get(id);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  putUser(user: User): void {
    this.db
      .prepare(
        "INSERT INTO users VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(user.id, JSON.stringify(user));
  }
  close(): void {
    this.db.close();
  }
}
