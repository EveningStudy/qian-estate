import { z } from "zod";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
const short = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(5000);
const positive = z.number().finite().positive().max(1_000_000);
const image = z
  .string()
  .regex(
    /^(?:\/assets\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|svg)|\/uploads\/[a-f0-9]{64}\.(?:png|jpeg))$/,
  );
export const propertyFields = {
  title: short,
  community: short,
  city: short,
  district: short,
  address: short,
  price: positive,
  area: positive,
  rooms: short,
  floor: short.optional(),
  orientation: short.optional(),
  decoration: short.optional(),
  year: z.number().int().min(1800).max(2200).optional(),
  tags: z.array(short).max(20).optional(),
  images: z.array(image).max(12).optional(),
  description: text.optional(),
  ownership: short.optional(),
  tax: short.optional(),
  occupancy: short.optional(),
  delivery: short.optional(),
  viewing: short.optional(),
  mortgage: short.optional(),
  notes: text.optional(),
};
export const propertyEditSchema = z
  .object(propertyFields)
  .partial()
  .strict()
  .refine((x) => Object.keys(x).length > 0, "请至少填写一个可编辑房源字段。");
// 业务字段使用明确白名单；身份与流程字段由服务端管理。
const protectedKeys = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "status",
  "role",
  "roles",
  "ownerId",
  "userId",
  "senderId",
  "requesterId",
  "sourceAgentId",
  "participantIds",
  "participants",
  "createdBy",
  "actorId",
  "actorRole",
  "approvedBy",
  "reviewedBy",
  "permissions",
  "token",
  "password",
  "views",
  "transactionInfo",
  "lockEnabled",
  "unlockEnabled",
  "unlocked",
  "unlockToken",
  "__proto__",
  "constructor",
  "prototype",
]);
export function safePayload(body: unknown): Record<string, unknown> {
  const result = z.record(z.string(), z.unknown()).parse(body);
  for (const key of Object.keys(result))
    if (protectedKeys.has(key))
      throw new ApiError(
        400,
        "PROTECTED_FIELD",
        `字段 '${key}' 由服务端管理。`,
      );
  return result;
}
const flexible = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict();
export const createSchemas = {
  properties: flexible({ ...propertyFields, agentId: identifier.optional() }),
  commissions: flexible({
    propertyId: identifier.optional(),
    agentId: identifier.optional(),
    title: short.optional(),
    community: short.optional(),
    city: short.optional(),
    area: positive.optional(),
    price: positive.optional(),
    phone: short.optional(),
    contactName: short.optional(),
    note: text.optional(),
  }).refine(
    (x) => Boolean(x.propertyId || (x.community && x.area && x.price)),
    "请提供房源编号，或填写小区、面积和价格。",
  ),
  appointments: flexible({
    propertyId: identifier,
    agentId: identifier.optional(),
    scheduledAt: z.iso.datetime({ offset: true }),
    note: text.optional(),
    phone: short.optional(),
    contactName: short.optional(),
  }),
  collaborations: flexible({
    propertyId: identifier,
    targetAgentId: identifier.optional(),
    note: text.optional(),
  }),
  clients: flexible({
    name: short,
    phone: short.optional(),
    budget: positive.optional(),
    preference: text.optional(),
    note: text.optional(),
  }),
  messages: flexible({
    recipientId: identifier,
    propertyId: identifier.optional(),
    content: text,
  }),
  feedback: flexible({
    content: text,
    category: short.optional(),
    contact: short.optional(),
  }),
  lockRequests: flexible({ propertyId: identifier, reason: text }),
  questions: flexible({
    question: text,
    propertyId: identifier.optional(),
    category: short.optional(),
  }),
};
export type MutableCollection = keyof typeof createSchemas;
export const patchSchema = z
  .object({ status: short, note: text.optional(), answer: text.optional() })
  .strict();
export const profileSchema = z
  .object({
    name: short.optional(),
    phone: z.string().trim().max(50).optional(),
    avatar: image.optional(),
    city: short.optional(),
    bio: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0, "请至少填写一个个人资料字段。");
export const valuationSchema = z
  .object({ area: positive, community: short, city: short })
  .strict();
