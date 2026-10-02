import { useState } from "react";
import { useStore } from "../store";
import { date, money } from "../data";
import { Empty, MutationButton, RemoteForm, Section, Status } from "./UI";
import type { Collection, RecordItem } from "../types";

function transitions(
  collection: Collection,
  item: RecordItem,
  userId: string,
  admin: boolean,
) {
  if (collection === "clients")
    return (
      (
        {
          active: ["contacted", "archived"],
          contacted: ["converted", "archived"],
          converted: ["archived"],
          archived: ["active"],
        } as Record<string, string[]>
      )[item.status] || []
    );
  if (collection === "collaborations" && item.agentId === userId)
    return ["pending", "accepted"].includes(item.status) ? ["cancelled"] : [];
  if (!admin && item.agentId !== userId && item.targetAgentId !== userId)
    return [];
  return item.status === "pending"
    ? [collection === "appointments" ? "confirmed" : "accepted", "rejected"]
    : ["accepted", "confirmed"].includes(item.status)
      ? ["completed", "cancelled"]
      : [];
}
const actionLabels: Record<string, string> = {
  contacted: "标记已联系",
  archived: "归档",
  converted: "标记已转化",
  active: "重新跟进",
  cancelled: "取消",
  confirmed: "确认预约",
  accepted: "受理",
  rejected: "拒绝",
  completed: "完成",
};
export function TaskRows({ collection }: { collection: Collection }) {
  const { data, role } = useStore();
  const items = data[collection];
  return (
    <div className="record-list">
      {items.length ? (
        items.map((item) => (
          <div className="record-row task-row" key={item.id}>
            <div>
              <strong>
                {item.title ||
                  item.name ||
                  data.properties.find((p) => p.id === item.propertyId)
                    ?.community ||
                  "协作请求"}
              </strong>
              <p>
                {item.scheduledAt
                  ? new Date(item.scheduledAt).toLocaleString("zh-CN")
                  : item.note || item.preference || "暂无补充说明"}
              </p>
              {item.budget && (
                <small>
                  预算 {money(item.budget)} 万元 · {item.phone || "未留电话"}
                </small>
              )}
            </div>
            <Status value={item.status} />
            <div className="row-actions">
              {transitions(
                collection,
                item,
                data.user!.id,
                role === "admin",
              ).map((status) => (
                <MutationButton
                  key={status}
                  path={`/${collection}/${item.id}`}
                  body={{ status }}
                >
                  {actionLabels[status]}
                </MutationButton>
              ))}
            </div>
          </div>
        ))
      ) : (
        <Empty />
      )}
    </div>
  );
}
export default function Workspace({
  view,
}: {
  view: "collaborations" | "clients" | "tasks";
}) {
  const { data } = useStore();
  const [showForm, setShowForm] = useState(false);
  const titles = {
    collaborations: "协作，让好房遇见对的人。",
    clients: "每一次沟通，都值得记住。",
    tasks: "下一步，井然有序。",
  };
  const eligible = data.properties.filter(
    (p) => p.agentId !== data.user?.id && p.status === "published",
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{titles[view]}</h1>
          <p>真实 API 驱动的演示工作流。状态更新后同步到关联用户。</p>
        </div>
      </div>
      {view === "clients" ? (
        <>
          <Section
            title="客户管理"
            action={
              <button
                className="button primary"
                onClick={() => setShowForm(!showForm)}
              >
                {showForm ? "收起表单" : "新增客户"}
              </button>
            }
          >
            {showForm && (
              <div className="inline-form">
                <RemoteForm
                  path="/clients"
                  submit="保存客户"
                  fields={[
                    {
                      name: "name",
                      label: "客户姓名",
                      required: true,
                      placeholder: "请使用虚构姓名",
                    },
                    { name: "phone", label: "联系电话", type: "tel" },
                    { name: "budget", label: "预算（万元）", type: "number" },
                    {
                      name: "preference",
                      label: "置业偏好",
                      placeholder: "区域、户型、通勤需求",
                    },
                  ]}
                />
              </div>
            )}
            <TaskRows collection="clients" />
          </Section>
        </>
      ) : view === "collaborations" ? (
        <>
          <Section
            title="发起房源协作"
            caption="向其他经纪人的在售房源发起协作，审核由对方或管理员处理。"
          >
            {eligible.length ? (
              <RemoteForm
                path="/collaborations"
                submit="发送协作请求"
                fields={[
                  {
                    name: "propertyId",
                    label: "选择房源",
                    required: true,
                    options: eligible.map((p) => ({
                      value: p.id,
                      label: `${p.community} · ${p.district}`,
                    })),
                  },
                  {
                    name: "note",
                    label: "协作说明",
                    placeholder: "例如：有客户希望周末看房",
                    required: true,
                  },
                ]}
              />
            ) : (
              <Empty>暂无可协作的其他经纪人房源。</Empty>
            )}
          </Section>
          <Section title="协作记录">
            <TaskRows collection="collaborations" />
          </Section>
        </>
      ) : (
        <>
          <Section title="出售委托">
            <TaskRows collection="commissions" />
          </Section>
          <Section title="看房预约">
            <TaskRows collection="appointments" />
          </Section>
          <Section title="协作任务">
            <TaskRows collection="collaborations" />
          </Section>
        </>
      )}
      <p className="fine-print">
        记录最后同步于服务器响应；页面不会自动伪造任务完成。日期示例：
        {date(data[view === "tasks" ? "commissions" : view][0]?.updatedAt)}
      </p>
    </>
  );
}
