import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Store, User } from "./db.js";
import { ApiError } from "./validation.js";

export const uploadName = /^[a-f0-9]{64}\.(png|jpeg)$/;
const maxBytes = 5 * 1024 * 1024;
function invalid(message: string): never {
  throw new ApiError(400, "INVALID_IMAGE", message);
}
function dimensions(width: number, height: number) {
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 20_000_000
  )
    invalid("图片各边尺寸须为 1–8192 像素，总像素不得超过 2000 万。");
  return { width, height };
}
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 有界校验文件结构和头部，不等同于完整像素解码或恶意软件扫描。 */
export function inspectImage(bytes: Buffer, mime: string) {
  if (!bytes.length) invalid("图片内容为空。");
  if (bytes.length > maxBytes)
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "图片大小超过 5MiB。");
  if (mime === "image/png") {
    if (
      bytes.length < 45 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      invalid("图片内容与 PNG 类型不一致。");
    let offset = 8,
      chunks = 0,
      data = false;
    let size: { width: number; height: number } | undefined;
    while (offset + 12 <= bytes.length && chunks++ < 10_000) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) invalid("PNG 数据块不完整。");
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (
        crc32(bytes.subarray(offset + 4, end - 4)) !==
        bytes.readUInt32BE(end - 4)
      )
        invalid("PNG 校验和无效。");
      if (chunks === 1) {
        if (type !== "IHDR" || length !== 13)
          invalid("PNG 必须以 IHDR 头部开始。");
        size = dimensions(
          bytes.readUInt32BE(offset + 8),
          bytes.readUInt32BE(offset + 12),
        );
        const depth = bytes[offset + 16]!,
          color = bytes[offset + 17]!;
        const depths: Record<number, number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16],
        };
        if (
          !depths[color]?.includes(depth) ||
          bytes[offset + 18] !== 0 ||
          bytes[offset + 19] !== 0 ||
          bytes[offset + 20]! > 1
        )
          invalid("PNG 头部格式不受支持。");
      } else if (type === "IHDR") invalid("PNG 头部重复。");
      if (type === "IDAT" && length > 0) data = true;
      if (type === "IEND") {
        if (length !== 0 || end !== bytes.length || !data || !size)
          invalid("PNG 结束标记无效。");
        return { ...size, extension: "png", mime };
      }
      offset = end;
    }
    invalid("PNG 图片不完整。");
  }
  if (mime === "image/jpeg") {
    if (bytes.length < 20 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
      invalid("图片内容与 JPEG 类型不一致。");
    let offset = 2,
      scanned = false;
    let size: { width: number; height: number } | undefined;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) invalid("JPEG 标记无效。");
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) {
        if (!size || !scanned || offset !== bytes.length)
          invalid("JPEG 结束标记无效。");
        return { ...size, extension: "jpeg", mime };
      }
      if (
        marker === undefined ||
        marker === 0 ||
        marker === 0xd8 ||
        (marker >= 0xd0 && marker <= 0xd7)
      )
        invalid("JPEG 出现非预期标记。");
      if (offset + 2 > bytes.length) invalid("JPEG 数据段不完整。");
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length)
        invalid("JPEG 数据段不完整。");
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (
          size ||
          length < 8 ||
          bytes[offset + 2] !== 8 ||
          ![1, 3, 4].includes(bytes[offset + 7]!) ||
          length !== 8 + 3 * bytes[offset + 7]!
        )
          invalid("JPEG 帧信息无效。");
        size = dimensions(
          bytes.readUInt16BE(offset + 5),
          bytes.readUInt16BE(offset + 3),
        );
      }
      offset += length;
      if (marker === 0xda) {
        if (!size || length < 6) invalid("JPEG 扫描缺少帧信息。");
        scanned = true;
        // 跳过熵编码字节、转义 FF 字节和重启标记。
        while (offset < bytes.length) {
          if (bytes[offset] !== 0xff) {
            offset++;
            continue;
          }
          const next = bytes[offset + 1];
          if (
            next === 0 ||
            (next !== undefined && next >= 0xd0 && next <= 0xd7)
          ) {
            offset += 2;
            continue;
          }
          break;
        }
      }
    }
    invalid("JPEG 图片不完整。");
  }
  throw new ApiError(
    415,
    "UNSUPPORTED_MEDIA_TYPE",
    "请发送 PNG 或 JPEG 原始字节，不接受 multipart 表单。",
  );
}

export function saveUpload(
  store: Store,
  directory: string,
  user: User,
  bytes: Buffer,
  mime: string,
) {
  const info = inspectImage(bytes, mime);
  const name = `${createHash("sha256").update(randomBytes(32)).update(bytes).digest("hex")}.${info.extension}`;
  const root = resolve(directory),
    path = resolve(root, name);
  if (dirname(path) !== root || !uploadName.test(name))
    throw new Error("生成的上传路径不安全。");
  mkdirSync(root, { recursive: true });
  // 独占创建防止覆盖已有文件或符号链接；不使用调用者文件名。
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  const result = {
    id: name,
    createdAt: new Date().toISOString(),
    status: "stored",
    url: `/uploads/${name}`,
    name,
    mime: info.mime,
    size: bytes.length,
    width: info.width,
    height: info.height,
  };
  store.db
    .prepare("INSERT INTO uploads(name,user_id,data) VALUES (?,?,?)")
    .run(name, user.id, JSON.stringify(result));
  return result;
}

export function uploadedFile(store: Store, directory: string, name: string) {
  if (
    !uploadName.test(name) ||
    !store.db.prepare("SELECT name FROM uploads WHERE name=?").get(name)
  )
    throw new ApiError(404, "NOT_FOUND", "图片不存在。");
  const root = resolve(directory),
    path = resolve(root, name);
  if (dirname(path) !== root)
    throw new ApiError(404, "NOT_FOUND", "图片不存在。");
  try {
    if (!lstatSync(path).isFile()) throw new Error("不是普通文件");
  } catch {
    throw new ApiError(404, "NOT_FOUND", "图片不存在。");
  }
  return path;
}
