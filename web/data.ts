import {
  collections,
  type Role,
  type Snapshot,
  type RecordItem,
} from "./types";

export const roleLabels: Record<Role, string> = {
  owner: "业主",
  agent: "经纪人",
  admin: "管理员",
};
export const statusLabels: Record<string, string> = {
  published: "展示中",
  pending: "待审核",
  sold: "已成交",
  rejected: "已拒绝",
  accepted: "已受理",
  completed: "已完成",
  cancelled: "已取消",
  confirmed: "已确认",
  active: "跟进中",
  contacted: "已联系",
  converted: "已转化",
  archived: "已归档",
  sent: "已发送",
  read: "已读",
  open: "待处理",
  in_progress: "处理中",
  resolved: "已解决",
  answered: "已答复",
  approved: "已批准",
  revoked: "已撤销",
  recorded: "已记录",
};
export const money = (value?: number) =>
  value == null
    ? "待确认"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
        value,
      );
export const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString("zh-CN") : "—";
export function previewData(role: Role): Snapshot {
  const empty = Object.fromEntries(
    collections.map((c) => [c, [] as RecordItem[]]),
  ) as Record<(typeof collections)[number], RecordItem[]>;
  return {
    ...empty,
    user: {
      id: `${role}-demo`,
      role,
      name:
        role === "owner"
          ? "林知夏"
          : role === "agent"
            ? "陈予安"
            : "演示管理员",
      city: "杭州",
    },
    demo: true,
    realLocksEnabled: false,
    properties: [
      {
        id: "property-1",
        title: "把江南的阳光，装进家里",
        community: "晴川里",
        city: "杭州",
        district: "滨江区",
        price: 328,
        area: 89,
        rooms: "3室2厅",
        status: "published",
        images: ["/assets/interior-1.png"],
        agentId: "agent-demo",
        tags: ["虚构房源", "南向采光"],
        views: 128,
      },
      {
        id: "property-2",
        title: "临水而居，留一扇窗给风景",
        community: "栖云花园",
        city: "杭州",
        district: "西湖区",
        price: 468,
        area: 128,
        rooms: "4室2厅",
        status: "published",
        images: ["/assets/interior-2.png"],
        agentId: "agent-other",
        tags: ["虚构房源", "公园附近"],
        views: 201,
      },
      {
        id: "property-3",
        title: "小而温暖的城市第一站",
        community: "青禾公馆",
        city: "杭州",
        district: "拱墅区",
        price: 198,
        area: 62,
        rooms: "2室1厅",
        status: "published",
        images: ["/assets/interior-3.png"],
        agentId: "agent-demo",
        tags: ["虚构房源", "近地铁"],
        views: 274,
      },
    ],
    faqs: [
      {
        id: "preview-faq-1",
        status: "published",
        question: "这里的房源与估价是真的吗？",
        answer:
          "所有房源、人物和价格都是虚构演示，不可用于真实交易。估价仅展示固定算法，不是市场评估。",
      },
      {
        id: "preview-faq-2",
        status: "published",
        question: "未连接后端时可以提交吗？",
        answer:
          "不可以。离线页面仅供浏览，所有提交都必须由服务器确认。请连接本地 API 后重试。",
      },
    ],
  };
}
