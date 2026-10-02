import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useStore } from "../store";
import { Empty, MutationButton, RemoteForm } from "./UI";

const names: Record<string, string> = {
  "owner-demo": "林知夏",
  "owner-other": "许星河",
  "agent-demo": "陈予安",
  "agent-other": "周清禾",
  "admin-demo": "演示管理员",
};
export default function Messages({
  initialRecipient,
}: {
  initialRecipient?: string;
}) {
  const { data, role } = useStore();
  const me = data.user!.id;
  const ids = new Set<string>(
    data.messages
      .flatMap((m) => [m.senderId!, m.recipientId!])
      .filter((id) => id !== me),
  );
  data.agents.forEach((a) => {
    if (a.id !== me) ids.add(a.id);
  });
  if (role === "agent")
    data.commissions.forEach((c) => {
      if (c.ownerId) ids.add(c.ownerId);
    });
  if (me !== "admin-demo") ids.add("admin-demo");
  if (initialRecipient && initialRecipient !== me) ids.add(initialRecipient);
  const recipients = [...ids];
  const [selected, setSelected] = useState(
    initialRecipient !== me ? initialRecipient || recipients[0] : recipients[0],
  );
  const messages = data.messages
    .filter(
      (m) =>
        (m.senderId === me && m.recipientId === selected) ||
        (m.senderId === selected && m.recipientId === me),
    )
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>让沟通，离家更近。</h1>
          <p>仅显示当前用户参与的会话。发送结果由服务器确认。</p>
        </div>
      </div>
      <div className="messages-layout">
        <aside className="conversation-list">
          <h2>消息会话</h2>
          {recipients.map((id) => (
            <button
              className={`conversation ${selected === id ? "selected" : ""}`}
              key={id}
              onClick={() => setSelected(id)}
            >
              <span className="avatar">{(names[id] || "演示")[0]}</span>
              <span>
                <strong>{names[id] || id}</strong>
                <small>
                  {id.startsWith("agent")
                    ? "经纪人"
                    : id.startsWith("owner")
                      ? "业主"
                      : "平台支持"}
                </small>
              </span>
              <MessageSquare size={15} />
            </button>
          ))}
        </aside>
        <section className="conversation-panel">
          <header>
            <strong>{names[selected || ""] || "选择会话"}</strong>
            <span>演示会话 · 非即时客服</span>
          </header>
          <div className="message-history" aria-live="polite">
            {messages.length ? (
              messages.map((m) => (
                <div
                  className={`message ${m.senderId === me ? "mine" : ""}`}
                  key={m.id}
                >
                  <small>
                    {names[m.senderId!] || m.senderId} ·{" "}
                    {m.createdAt
                      ? new Date(m.createdAt).toLocaleString("zh-CN")
                      : ""}
                  </small>
                  <p>{m.content}</p>
                  {m.senderId === me ? (
                    <small>
                      {m.status === "read" ? "对方已读" : "服务器已接收"}
                    </small>
                  ) : (
                    m.status === "sent" && (
                      <MutationButton
                        path={`/messages/${m.id}`}
                        body={{ status: "read" }}
                        className="text-button"
                      >
                        标记已读
                      </MutationButton>
                    )
                  )}
                </div>
              ))
            ) : (
              <Empty>还没有消息。从一句问候开始吧。</Empty>
            )}
          </div>
          {selected && (
            <div className="message-composer">
              <RemoteForm
                key={selected}
                path="/messages"
                fixed={{ recipientId: selected }}
                submit="发送消息"
                fields={[
                  {
                    name: "content",
                    label: "消息内容",
                    type: "textarea",
                    placeholder: "输入消息，请勿包含真实敏感信息…",
                    required: true,
                    wide: true,
                  },
                ]}
                success="消息已由服务器接收。"
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
