import { useState } from "react";
import { ArrowUpRight, MoveRight } from "lucide-react";
import { useStore } from "../store";
import { date, money } from "../data";
import { Empty, PropertyImage, RemoteForm, Section, Status } from "./UI";
import type { Valuation } from "../types";

export function FAQ() {
  const { data } = useStore();
  return (
    <div className="faq-list">
      {data.faqs.map((f) => (
        <details key={f.id}>
          <summary>{f.question}</summary>
          <p>{f.answer}</p>
        </details>
      ))}
    </div>
  );
}
export default function OwnerDashboard({
  openListing,
}: {
  openListing: (id: string) => void;
}) {
  const { data, offline } = useStore();
  const [tab, setTab] = useState<"sell" | "valuation">("sell");
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const featured = data.properties[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>委托出售</h1>
          <p>填写房屋信息，查看委托和预约进度。</p>
        </div>
        <span className="edition">
          栖岸 · 业主服务
          <br />
          杭州 / HANGZHOU
        </span>
      </div>
      <div className="owner-grid">
        <div>
          <div className="tabs" aria-label="业主服务">
            <button
              className={tab === "sell" ? "selected" : ""}
              onClick={() => setTab("sell")}
            >
              委托出售
            </button>
            <button
              className={tab === "valuation" ? "selected" : ""}
              onClick={() => setTab("valuation")}
            >
              房产估价
            </button>
          </div>
          {tab === "sell" ? (
            <Section
              title="房屋信息"
              caption="填写基本信息，经纪人将在演示工作台中收到您的委托。"
            >
              <RemoteForm
                key="commission"
                path="/commissions"
                submit="提交出售委托"
                fields={[
                  {
                    name: "community",
                    label: "小区名称",
                    placeholder: "例如：晴川里",
                    required: true,
                  },
                  {
                    name: "city",
                    label: "所在城市",
                    value: "杭州",
                    required: true,
                  },
                  {
                    name: "area",
                    label: "建筑面积（㎡）",
                    type: "number",
                    placeholder: "89",
                    required: true,
                  },
                  {
                    name: "price",
                    label: "期望总价（万元）",
                    type: "number",
                    placeholder: "328",
                    required: true,
                  },
                  {
                    name: "contactName",
                    label: "联系人",
                    value: data.user?.name,
                    required: true,
                  },
                  {
                    name: "phone",
                    label: "联系电话",
                    type: "tel",
                    placeholder: "演示请勿填写真实号码",
                    required: true,
                  },
                  {
                    name: "note",
                    label: "补充说明",
                    type: "textarea",
                    placeholder: "可沟通时间、房屋情况等（选填）",
                    wide: true,
                  },
                ]}
              >
                <p className="fine-print">
                  仅模拟委托流程，不构成真实居间合同。请勿提交真实个人信息。
                </p>
              </RemoteForm>
            </Section>
          ) : (
            <Section
              title="演示估值"
              caption="固定演示算法，不读取实时市场数据，也不构成专业评估。"
            >
              <RemoteForm
                key="valuation"
                path="/valuation"
                submit="查看演示估价"
                onResult={(v) => setValuation(v as Valuation)}
                fields={[
                  {
                    name: "community",
                    label: "小区名称",
                    required: true,
                    placeholder: "例如：晴川里",
                  },
                  {
                    name: "city",
                    label: "所在城市",
                    value: "杭州",
                    required: true,
                  },
                  {
                    name: "area",
                    label: "建筑面积（㎡）",
                    type: "number",
                    required: true,
                    placeholder: "89",
                  },
                ]}
              />
              {valuation && (
                <div className="valuation-result" role="status">
                  <span>演示估值区间</span>
                  <strong>
                    {money(valuation.low)}–{money(valuation.high)}{" "}
                    <small>万元</small>
                  </strong>
                  <p>{valuation.method}</p>
                  <p>{valuation.disclaimer}</p>
                </div>
              )}
            </Section>
          )}
        </div>
        <aside className="editorial-rail">
          {featured && (
            <>
              <PropertyImage
                src={featured.images?.[0]}
                alt="虚构演示房源室内空间"
              />
              <div className="rail-caption">
                <span>本期房源 / 01</span>
                <h2>{featured.community}</h2>
                <p>
                  {featured.rooms} · {featured.area} ㎡ · {featured.district}
                </p>
                <button
                  className="text-button"
                  onClick={() => openListing(featured.id)}
                >
                  看看这个家 <ArrowUpRight size={17} />
                </button>
              </div>
            </>
          )}
          <div className="rail-note">
            <span className="coral-rule" />
            <h3>好好生活，慢慢选择。</h3>
            <p>
              从一份清晰的委托，到一次安心的沟通。我们把复杂的流程，整理成看得见的下一步。
            </p>
          </div>
        </aside>
      </div>
      <Section
        title="我的委托"
        caption={
          offline
            ? "离线预览不包含您的业务记录。"
            : `${data.commissions.length} 份委托 · 状态由服务器确认`
        }
      >
        <div className="record-list">
          {data.commissions.length ? (
            data.commissions.map((c) => (
              <div className="record-row" key={c.id}>
                <div>
                  <strong>{c.title || c.community}</strong>
                  <p>
                    {c.area} ㎡ · 期望 {money(c.price)} 万元
                  </p>
                </div>
                <Status value={c.status} />
              </div>
            ))
          ) : (
            <Empty />
          )}
        </div>
      </Section>
      <Section title="成交记录" caption="虚构历史记录，仅用于展示交易流程。">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>房源 / 项目</th>
                <th>面积</th>
                <th>成交总价</th>
                <th>记录日期</th>
                <th>状态</th>
                <th>
                  <span className="sr-only">详情</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.title}</strong>
                    <small>演示交易 · 非真实成交</small>
                  </td>
                  <td>{t.area} ㎡</td>
                  <td className="number">{money(t.price)} 万元</td>
                  <td>{date(t.createdAt)}</td>
                  <td>
                    <Status value={t.status} />
                  </td>
                  <td>
                    {t.propertyId && (
                      <button
                        className="icon-button"
                        aria-label={`查看${t.title}`}
                        onClick={() => openListing(t.propertyId!)}
                      >
                        <MoveRight size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.transactions.length && <Empty />}
        </div>
      </Section>
      <Section title="常见问题" caption="在开始之前，您可能想知道。">
        <FAQ />
      </Section>
    </>
  );
}
