export type Role = "owner" | "agent" | "admin";
export type View =
  | "integrations"
  | "dashboard"
  | "listings"
  | "collaborations"
  | "clients"
  | "tasks"
  | "messages"
  | "profile"
  | "help"
  | "privacy"
  | "admin"
  | "detail";
export interface User {
  id: string;
  name: string;
  role: Role;
  phone?: string;
  city?: string;
  bio?: string;
}
export interface RecordItem {
  id: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  name?: string;
  community?: string;
  city?: string;
  district?: string;
  address?: string;
  price?: number;
  area?: number;
  rooms?: string;
  floor?: string;
  orientation?: string;
  decoration?: string;
  year?: number;
  images?: string[];
  tags?: string[];
  description?: string;
  views?: number;
  transactionInfo?: {
    type?: string;
    ownership?: string;
    priceUnit?: string;
    demo?: boolean;
  };
  ownerId?: string;
  agentId?: string;
  targetAgentId?: string;
  requesterId?: string;
  propertyId?: string;
  userId?: string;
  senderId?: string;
  recipientId?: string;
  content?: string;
  note?: string;
  reason?: string;
  question?: string;
  answer?: string;
  category?: string;
  phone?: string;
  budget?: number;
  preference?: string;
  scheduledAt?: string;
  action?: string;
  collection?: string;
  actorId?: string;
  recordId?: string;
}
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
export type Snapshot = {
  user: User | null;
  demo: boolean;
  realLocksEnabled: boolean;
} & Record<Collection, RecordItem[]>;
export type Payload = Record<string, string | number | boolean | string[]>;
export interface Valuation {
  low: number;
  high: number;
  unit: string;
  method: string;
  disclaimer: string;
}
