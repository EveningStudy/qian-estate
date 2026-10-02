import { useState } from "react";
import { ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";
import { useStore } from "../store";
import { money } from "../data";
import { Empty, PropertyImage, Status } from "./UI";

export default function Listings({
  openListing,
}: {
  openListing: (id: string) => void;
}) {
  const { data, role } = useStore();
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("");
  const [sort, setSort] = useState("new");
  const [onlySaved, setOnlySaved] = useState(false);
  const favorites = new Set(data.favorites.map((f) => f.propertyId));
  const items = data.properties
    .filter(
      (p) =>
        (!district || p.district === district) &&
        (!onlySaved || favorites.has(p.id)) &&
        [p.title, p.community, p.city, p.district, p.address]
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "price-asc"
        ? (a.price || 0) - (b.price || 0)
        : sort === "price-desc"
          ? (b.price || 0) - (a.price || 0)
          : (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {role === "agent"
              ? "联卖房源"
              : "房源列表"}
          </h1>
          <p>一览房源，清楚每一个细节。所有房源与价格均为虚构演示。</p>
        </div>
        <span className="edition">
          PROPERTY
          <br />
          COLLECTION
        </span>
      </div>
      <div className="listing-toolbar">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="搜索房源"
            placeholder="搜索小区、位置或关键词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="filter-select">
          <SlidersHorizontal size={16} />
          <select
            aria-label="区域筛选"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
          >
            <option value="">全部区域</option>
            {Array.from(
              new Set(data.properties.map((p) => p.district).filter(Boolean)),
            ).map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <select
          aria-label="房源排序"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="new">最新发布</option>
          <option value="price-asc">总价从低到高</option>
          <option value="price-desc">总价从高到低</option>
        </select>
      </div>
      <div className="list-count">
        <span>共 {items.length} 套房源</span>
        <label>
          <input
            type="checkbox"
            checked={onlySaved}
            onChange={(e) => setOnlySaved(e.target.checked)}
          />
          只看收藏
        </label>
      </div>
      <div className="property-list">
        {items.map((p, i) => (
          <article className="property-row" key={p.id}>
            <button
              className="image-link"
              onClick={() => openListing(p.id)}
              aria-label={`查看${p.community}`}
            >
              <PropertyImage
                src={p.images?.[0]}
                alt={`${p.community}虚构演示室内`}
              />
            </button>
            <div className="property-copy">
              <div className="property-topline">
                <span>
                  {String(i + 1).padStart(2, "0")} / {p.district}
                </span>
                <Status value={p.status} />
              </div>
              <button
                className="property-title"
                onClick={() => openListing(p.id)}
              >
                {p.community}
              </button>
              <p className="property-description">{p.title}</p>
              <p className="property-facts">
                {p.rooms} <i /> {p.area} ㎡ <i />{" "}
                {p.orientation || "朝向待确认"}
              </p>
              <div className="property-tags">
                {p.tags?.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
            <div className="property-price">
              <strong>
                {money(p.price)}
                <small> 万元</small>
              </strong>
              <span>
                {p.area && p.price
                  ? money(Math.round((p.price * 10000) / p.area))
                  : "—"}{" "}
                元/㎡
              </span>
              <button className="text-button" onClick={() => openListing(p.id)}>
                房源详情 <ArrowUpRight size={19} />
              </button>
            </div>
          </article>
        ))}
        {!items.length && (
          <Empty>没有符合条件的房源。试试其他关键词或筛选条件。</Empty>
        )}
      </div>
    </>
  );
}
