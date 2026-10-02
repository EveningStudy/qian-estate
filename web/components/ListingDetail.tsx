import { useEffect, useState } from "react";
import { ArrowLeft, Heart, Eye, MapPin, ShieldCheck } from "lucide-react";
import { useStore } from "../store";
import { money } from "../data";
import {
  Empty,
  MutationButton,
  PropertyImage,
  RemoteForm,
  Section,
  Status,
} from "./UI";
import type { RecordItem } from "../types";

export default function ListingDetail({
  id,
  back,
  message,
}: {
  id: string;
  back: () => void;
  message: (recipient: string) => void;
}) {
  const { data, role, request, offline } = useStore();
  const [detail, setDetail] = useState<RecordItem | null>(null);
  const [error, setError] = useState("");
  const [image, setImage] = useState(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setError("");
    if (!offline)
      void request<RecordItem>(`/properties/${encodeURIComponent(id)}`)
        .then((p) => {
          if (current) setDetail(p);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [id, offline, retry]);
  const p = detail || data.properties.find((p) => p.id === id);
  if (!p)
    return (
      <>
        <button className="text-button" onClick={back}>
          <ArrowLeft size={17} />
          返回房源
        </button>
        <Empty>{error || "未找到房源或您没有查看权限。"}</Empty>
        <button
          className="button secondary"
          onClick={() => setRetry((n) => n + 1)}
        >
          重试读取
        </button>
      </>
    );
  const images = p.images?.length ? p.images : ["/assets/interior-1.png"];
  const saved = data.favorites.some((f) => f.propertyId === id);
  return (
    <>
      <button className="text-button back" onClick={back}>
        <ArrowLeft size={16} />
        返回房源列表
      </button>
      <div className="detail-heading">
        <div>
          <div className="detail-location">
            <MapPin size={14} />
            {p.city} · {p.district} <Status value={p.status} />
          </div>
          <h1>{p.community}</h1>
          <p>{p.title}</p>
        </div>
        <div className="detail-price">
          <strong>
            {money(p.price)}
            <small> 万元</small>
          </strong>
          <p>
            {p.price && p.area
              ? money(Math.round((p.price * 10000) / p.area))
              : "—"}{" "}
            元/㎡ · 演示价格
          </p>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            重试读取
          </button>
        </div>
      )}
      <div className="gallery">
        <PropertyImage
          key={images[image]}
          src={images[image]}
          alt={`${p.community}室内演示图 ${image + 1}`}
        />
        <span className="gallery-count">
          {image + 1} / {images.length} · 演示图片
        </span>
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbnails">
          {images.map((src, i) => (
            <button
              key={src + i}
              className={image === i ? "selected" : ""}
              aria-label={`查看图片 ${i + 1}`}
              onClick={() => setImage(i)}
            >
              <PropertyImage src={src} alt={`缩略图 ${i + 1}`} />
            </button>
          ))}
        </div>
      )}
      <div className="detail-columns">
        <div>
          <div className="facts-band">
            <div>
              <strong>{p.rooms}</strong>
              <span>房屋户型</span>
            </div>
            <div>
              <strong>
                {p.area}
                <small> ㎡</small>
              </strong>
              <span>建筑面积</span>
            </div>
            <div>
              <strong>{p.orientation || "待补充"}</strong>
              <span>房屋朝向</span>
            </div>
          </div>
          <Section title="空间与日常">
            <p className="body-copy">
              {p.description || "虚构演示房源，详细信息待补充。"}
            </p>
            <dl className="facts-grid">
              <dt>所在楼层</dt>
              <dd>{p.floor || "待补充"}</dd>
              <dt>装修情况</dt>
              <dd>{p.decoration || "待补充"}</dd>
              <dt>建成年份</dt>
              <dd>{p.year || "待确认"}</dd>
              <dt>房屋地址</dt>
              <dd>{p.address || "虚构地址待补充"}</dd>
            </dl>
          </Section>
          <Section
            title="交易信息"
            caption="以下资料均为演示，产权与价格未经真实核验。"
          >
            <dl className="facts-grid">
              <dt>交易类型</dt>
              <dd>{p.transactionInfo?.type || "待确认"}</dd>
              <dt>产权说明</dt>
              <dd>{p.transactionInfo?.ownership || "待核验"}</dd>
            </dl>
            <div className="detail-metrics">
              <span>
                <Eye size={17} /> {p.views ?? 0} 次展示浏览（服务器演示计数）
              </span>
              <span>
                <Heart size={16} /> {saved ? "已加入我的收藏" : "未收藏"}
              </span>
            </div>
            <p className="fine-print">
              浏览量读取服务器数据；重复打开页面不会虚增计数。
            </p>
          </Section>
        </div>
        <aside className="detail-aside">
          <h2>从一次沟通开始。</h2>
          <p>
            房源经纪人 ·{" "}
            {data.agents.find((a) => a.id === p.agentId)?.name || "演示顾问"}
          </p>
          <button
            className="button primary full"
            onClick={() => message(p.agentId || "agent-demo")}
          >
            联系经纪人
          </button>
          <MutationButton
            path={`/favorites/${id}`}
            method="POST"
            className="button secondary full"
          >
            <Heart size={16} fill={saved ? "currentColor" : "none"} />
            {saved ? "取消收藏" : "收藏房源"}
          </MutationButton>
          <div className="safety-note">
            <ShieldCheck size={19} />
            <p>虚构演示环境，请勿支付费用或提供真实证件。</p>
          </div>
        </aside>
      </div>
      {role === "owner" && p.status === "published" && (
        <Section title="预约看房" caption="仅创建演示预约，不安排真实带看。">
          <RemoteForm
            path="/appointments"
            fixed={{ propertyId: id }}
            submit="提交看房预约"
            fields={[
              {
                name: "scheduledAt",
                label: "预约时间",
                type: "datetime-local",
                required: true,
              },
              {
                name: "contactName",
                label: "联系人",
                value: data.user?.name,
                required: true,
              },
              { name: "phone", label: "联系电话（演示）", type: "tel" },
              { name: "note", label: "备注", placeholder: "其他看房需求" },
            ]}
          />
        </Section>
      )}
      {role === "agent" &&
        p.agentId !== data.user?.id &&
        p.status === "published" && (
          <Section title="房源协作">
            <RemoteForm
              path="/collaborations"
              fixed={{ propertyId: id }}
              submit="发起协作"
              fields={[
                { name: "note", label: "协作说明", required: true, wide: true },
              ]}
            />
          </Section>
        )}
    </>
  );
}
