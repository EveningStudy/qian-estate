import type { Store, RecordData, User } from "./db.js";

/** 仅包含虚构种子数据；所有房源价格均以人民币万元计。 */
export function seed(store: Store): void {
  const stamp = "2026-09-01T08:00:00.000Z";
  const record = (
    id: string,
    fields: Record<string, unknown>,
    status = "active",
  ): RecordData => ({
    ...fields,
    id,
    createdAt: stamp,
    updatedAt: stamp,
    status,
  });
  const users: User[] = [
    { id: "owner-demo", role: "owner", name: "林知夏" },
    { id: "owner-other", role: "owner", name: "许星河" },
    { id: "agent-demo", role: "agent", name: "陈予安" },
    { id: "agent-other", role: "agent", name: "周清禾" },
    { id: "admin-demo", role: "admin", name: "演示管理员" },
  ].map((u) => ({
    ...u,
    role: u.role as User["role"],
    createdAt: stamp,
    updatedAt: stamp,
    status: "active",
    city: "杭州",
  }));
  users.forEach((u) => store.putUser(u));
  store.put(
    "agents",
    record("agent-demo", {
      name: "陈予安",
      company: "栖岸·江南门店（虚构）",
      district: "滨江区",
      city: "杭州",
      specialties: ["改善置业", "社区顾问"],
      experience: 6,
      rating: 4.9,
      completedDeals: 36,
      bio: "认真倾听，陪你找到适合的家。演示人物。",
    }),
  );
  store.put(
    "agents",
    record("agent-other", {
      name: "周清禾",
      company: "栖岸·湖畔门店（虚构）",
      district: "西湖区",
      city: "杭州",
      specialties: ["首套置业", "公园住区"],
      experience: 4,
      rating: 4.8,
      completedDeals: 28,
      bio: "熟悉社区，也关心生活。演示人物。",
    }),
  );
  const fixtures = [
    [
      "property-1",
      "把江南的阳光，装进家里",
      "晴川里",
      "滨江区",
      328,
      89,
      "3室2厅",
      "owner-demo",
      "agent-demo",
      "published",
    ],
    [
      "property-2",
      "临水而居，留一扇窗给风景",
      "栖云花园",
      "西湖区",
      468,
      128,
      "4室2厅",
      "owner-other",
      "agent-other",
      "published",
    ],
    [
      "property-3",
      "小而温暖的城市第一站",
      "青禾公馆",
      "拱墅区",
      198,
      62,
      "2室1厅",
      "owner-other",
      "agent-demo",
      "published",
    ],
    [
      "property-4",
      "有露台的家，日常也有假期",
      "知岸里",
      "滨江区",
      586,
      156,
      "4室2厅",
      "owner-demo",
      "agent-demo",
      "pending",
    ],
    [
      "property-5",
      "从容尺度，安放一家人的生活",
      "云汀雅苑",
      "西湖区",
      398,
      112,
      "3室2厅",
      "owner-other",
      "agent-other",
      "sold",
    ],
    [
      "property-6",
      "收藏一片绿意与安静",
      "梧桐小筑",
      "拱墅区",
      268,
      78,
      "2室2厅",
      "owner-other",
      "agent-other",
      "pending",
    ],
  ] as const;
  fixtures.forEach(
    (
      [
        id,
        title,
        community,
        district,
        price,
        area,
        rooms,
        ownerId,
        agentId,
        status,
      ],
      i,
    ) =>
      store.put(
        "properties",
        record(
          id,
          {
            title,
            community,
            district,
            price,
            area,
            rooms,
            ownerId,
            agentId,
            city: "杭州",
            address: `${district}示例路${100 + i * 18}号（虚构）`,
            floor: `${8 + i}/18层`,
            orientation: "南",
            decoration: "精装",
            year: 2018 + (i % 4),
            tags: [
              "演示房源",
              ...(i % 2 ? ["公园附近", "通透采光"] : ["近地铁", "南向采光"]),
            ],
            images: ["/assets/interior-1.png"],
            description:
              "这是一套用于产品原型的虚构房源。开阔客餐厅与自然采光，描绘舒适的日常生活；所有价格、地址与交易信息均为演示数据。",
            transactionInfo: {
              type: "二手住宅",
              ownership: "演示产权信息，未经核验",
              priceUnit: "万元",
              demo: true,
            },
            views: 128 + i * 73,
            ownerContact: {
              name: ownerId === "owner-demo" ? "林知夏" : "许星河",
              phone: "演示号码-不可拨打",
            },
            privateNotes: "业主私有演示备注",
          },
          status,
        ),
      ),
  );
  store.put(
    "transactions",
    record(
      "transaction-1",
      {
        propertyId: "property-5",
        title: "云汀雅苑 · 成交记录",
        ownerId: "owner-other",
        agentId: "agent-other",
        price: 388,
        area: 112,
        demo: true,
      },
      "completed",
    ),
  );
  store.put(
    "transactions",
    record(
      "transaction-2",
      {
        propertyId: "property-1",
        title: "晴川里 · 历史演示记录",
        ownerId: "owner-demo",
        agentId: "agent-demo",
        price: 320,
        area: 89,
        demo: true,
      },
      "completed",
    ),
  );
  [
    [
      "faq-1",
      "房源信息是真的吗？",
      "本原型全部房源、人物、成交数据均为虚构，不能用于真实交易。",
    ],
    [
      "faq-2",
      "委托出售后会发生什么？",
      "演示经纪人可以受理委托并更新流程；不会建立真实居间合同。",
    ],
    [
      "faq-3",
      "可以远程开锁吗？",
      "不可以。系统仅演示授权申请与审批，真实门锁控制始终关闭。",
    ],
    [
      "faq-4",
      "估价可以作为交易依据吗？",
      "不可以。估值是固定演示算法，不是市场估价或专业评估。",
    ],
  ].forEach(([id, question, answer]) =>
    store.put(
      "faqs",
      record(id!, { question, answer, category: "使用指南" }, "published"),
    ),
  );
  store.put(
    "commissions",
    record(
      "commission-1",
      {
        ownerId: "owner-demo",
        agentId: "agent-demo",
        propertyId: "property-1",
        title: "晴川里出售委托",
        community: "晴川里",
        area: 89,
        price: 328,
        contactName: "林知夏",
        phone: "演示号码",
        note: "工作日傍晚可沟通",
      },
      "accepted",
    ),
  );
  store.put(
    "appointments",
    record(
      "appointment-1",
      {
        ownerId: "owner-demo",
        agentId: "agent-demo",
        propertyId: "property-2",
        scheduledAt: "2026-10-01T06:00:00.000Z",
        note: "演示看房安排",
      },
      "confirmed",
    ),
  );
  // 预约分配遵循房源实际负责经纪人。
  const appointment = store.get("appointments", "appointment-1")!;
  store.put("appointments", { ...appointment, agentId: "agent-other" });
  store.put(
    "clients",
    record("client-1", {
      agentId: "agent-demo",
      name: "叶女士（虚构）",
      phone: "演示号码",
      budget: 350,
      preference: "滨江三居",
      note: "仅用于演示客户管理",
    }),
  );
  store.put(
    "messages",
    record(
      "message-1",
      {
        senderId: "agent-demo",
        recipientId: "owner-demo",
        content: "您好，晴川里的演示资料已经整理好，方便时我们再沟通。",
        propertyId: "property-1",
      },
      "sent",
    ),
  );
  store.put(
    "messages",
    record(
      "message-private",
      {
        senderId: "agent-other",
        recipientId: "owner-other",
        content: "另一组用户的私有演示对话。",
      },
      "sent",
    ),
  );
  for (const user of users)
    store.put(
      "notifications",
      record(
        `notification-${user.id}`,
        {
          userId: user.id,
          title: "欢迎来到栖岸",
          content: "当前为本地演示环境，房源与交易信息均为虚构。",
        },
        "unread",
      ),
    );
}
