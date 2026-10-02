import {
  PropertyCheck,
  AgentApplications,
  AccountRequests,
} from "./Management";
import { production } from "../config";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useStore } from "../store";
import { date } from "../data";
import { Empty, MutationButton, RemoteForm, Section, Status } from "./UI";
import type { Collection } from "../types";

const queues: { key: Collection; label: string }[] = [
  { key: "properties", label: "房源审核" },
  { key: "questions", label: "问答审核" },
  { key: "feedback", label: "反馈处理" },
  { key: "lockRequests", label: "门锁申请" },
];
export default function AdminReview({
  openListing,
}: {
  openListing: (id: string) => void;
}) {
  const { data } = useStore();
  const [queue, setQueue] = useState<Collection>("properties");
  const [onlyPending, setOnlyPending] = useState(true);
  const items = data[queue].filter(
    (r) =>
      !onlyPending || ["pending", "open", "in_progress"].includes(r.status),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>审核工作台</h1>
          <p>审核结果由服务器校验权限并记录审计日志。</p>
        </div>
        <ShieldCheck size={40} strokeWidth={1} />
      </div>
      <div className="tabs admin-tabs">
        {queues.map((q) => (
          <button
            className={queue === q.key ? "selected" : ""}
            key={q.key}
            onClick={() => setQueue(q.key)}
          >
            {q.label}
            <span>
              {
                data[q.key].filter((r) =>
                  ["pending", "open", "in_progress"].includes(r.status),
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="list-count">
        <span>{items.length} 条记录</span>
        <label>
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
          />
          仅看待处理
        </label>
      </div>
      {queue === "lockRequests" && (
        <div className="notice">
          门锁未连接。批准仅更新演示申请状态，绝不会触发真实开锁。
        </div>
      )}
      <div className="review-list">
        {items.length ? (
          items.map((r) => (
            <article className="review-item" key={r.id}>
              <div className="review-heading">
                <div>
                  <h2>
                    {r.community ||
                      r.question ||
                      r.content ||
                      data.properties.find((p) => p.id === r.propertyId)
                        ?.community ||
                      "授权申请"}
                  </h2>
                  <small>
                    {r.id} · {date(r.createdAt)}
                  </small>
                </div>
                <Status value={r.status} />
              </div>
              <p>{r.description || r.reason || r.note}</p>
              {r.answer && <p className="review-answer">已答复：{r.answer}</p>}
              <div className="row-actions">
                {queue === "properties" && (
                  <button
                    className="text-button"
                    onClick={() => openListing(r.id)}
                  >
                    查看房源详情
                  </button>
                )}
                {queue === "properties" && r.status === "pending" && (
                  <>
                    {production ? (
                      <PropertyCheck id={r.id} />
                    ) : (
                      <MutationButton
                        path={`/properties/${r.id}`}
                        body={{ status: "published" }}
                        className="button primary"
                      >
                        审核通过
                      </MutationButton>
                    )}
                    <MutationButton
                      path={`/properties/${r.id}`}
                      body={{ status: "rejected" }}
                    >
                      拒绝发布
                    </MutationButton>
                  </>
                )}
                {queue === "feedback" &&
                  ["open", "in_progress"].includes(r.status) && (
                    <>
                      {r.status === "open" && (
                        <MutationButton
                          path={`/feedback/${r.id}`}
                          body={{ status: "in_progress" }}
                        >
                          开始处理
                        </MutationButton>
                      )}
                      <MutationButton
                        path={`/feedback/${r.id}`}
                        body={{ status: "resolved" }}
                        className="button primary"
                      >
                        标记已解决
                      </MutationButton>
                    </>
                  )}
                {queue === "lockRequests" && r.status === "pending" && (
                  <>
                    <MutationButton
                      path={`/lockRequests/${r.id}`}
                      body={{ status: "approved" }}
                    >
                      批准演示申请（不开锁）
                    </MutationButton>
                    <MutationButton
                      path={`/lockRequests/${r.id}`}
                      body={{ status: "rejected" }}
                    >
                      拒绝
                    </MutationButton>
                  </>
                )}
                {queue === "lockRequests" && r.status === "approved" && (
                  <MutationButton
                    path={`/lockRequests/${r.id}`}
                    body={{ status: "revoked" }}
                  >
                    撤销授权
                  </MutationButton>
                )}
              </div>
              {queue === "questions" && r.status === "pending" && (
                <>
                  <RemoteForm
                    path={`/questions/${r.id}`}
                    method="PATCH"
                    fixed={{ status: "answered" }}
                    submit="发布答复"
                    fields={[
                      {
                        name: "answer",
                        label: "答复内容（将公开显示在常见问题）",
                        type: "textarea",
                        wide: true,
                        required: true,
                      },
                    ]}
                  />
                  <MutationButton
                    path={`/questions/${r.id}`}
                    body={{ status: "rejected" }}
                  >
                    拒绝问题
                  </MutationButton>
                </>
              )}
            </article>
          ))
        ) : (
          <Empty>当前队列已处理完毕，或尚无申请。</Empty>
        )}
      </div>
      <AgentApplications />
      <AccountRequests />
      <Section title="操作审计" caption="服务端记录，展示最近 12 条可见操作。">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>操作</th>
                <th>执行人</th>
                <th>对象</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {[...data.audit]
                .reverse()
                .slice(0, 12)
                .map((a) => (
                  <tr key={a.id}>
                    <td>{a.action}</td>
                    <td>{a.actorId}</td>
                    <td>{a.collection}</td>
                    <td>{date(a.createdAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!data.audit.length && <Empty />}
        </div>
      </Section>
    </>
  );
}
