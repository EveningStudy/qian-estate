import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Building2,
  CalendarCheck2,
  ChevronRight,
  CircleHelp,
  Handshake,
  LayoutDashboard,
  Menu,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { production } from "./config";
import PairLogin from "./components/PairLogin";
import Integrations from "./components/Integrations";
import { AccountExport } from "./components/Management";
import { useStore } from "./store";
import { roleLabels } from "./data";
import OwnerDashboard from "./components/OwnerDashboard";
import Listings from "./components/Listings";
import ListingDetail from "./components/ListingDetail";
import Workspace from "./components/Workspace";
import Messages from "./components/Messages";
import AdminReview from "./components/AdminReview";
import AccountPages from "./components/AccountPages";
import type { Role, View } from "./types";

const pageLabels: Record<View, string> = {
  dashboard: "业主首页",
  listings: "房源精选",
  collaborations: "房源协作",
  clients: "客户管理",
  tasks: "我的任务",
  messages: "消息中心",
  profile: "个人资料",
  help: "帮助中心",
  privacy: "隐私与说明",
  admin: "审核工作台",
  integrations: "服务商状态",
  detail: "房源详情",
};
const icons = {
  dashboard: LayoutDashboard,
  listings: Building2,
  collaborations: Handshake,
  clients: Users,
  tasks: CalendarCheck2,
  messages: MessageSquare,
  admin: ShieldCheck,
};
function initialRoute(): { view: View; id: string } {
  const parts = location.hash.slice(1).split("/");
  return {
    view: parts[0] && parts[0] in pageLabels ? (parts[0] as View) : "dashboard",
    id: parts[1] || "",
  };
}
export default function App() {
  const { data, role, loading, offline, error, busy, connect, logout } =
    useStore();
  const [route, setRoute] = useState(initialRoute);
  const [mobileNav, setMobileNav] = useState(false);
  const [recipient, setRecipient] = useState<string>();
  useEffect(() => {
    const sync = () => {
      setRoute(initialRoute());
      setMobileNav(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const navigate = (view: View, id = "") => {
    location.hash = `${view}${id ? `/${encodeURIComponent(id)}` : ""}`;
    setRoute({ view, id });
    setMobileNav(false);
    window.scrollTo(0, 0);
  };
  const switchRole = (next: Role) => {
    navigate(
      next === "owner" ? "dashboard" : next === "agent" ? "listings" : "admin",
    );
    connect(next);
  };
  const nav = (
    role === "owner"
      ? ["dashboard", "listings", "messages"]
      : role === "agent"
        ? ["listings", "collaborations", "clients", "tasks", "messages"]
        : ["admin", "listings", "tasks", "messages"]
  ) as (keyof typeof icons)[];
  const restricted =
    (route.view === "admin" && role !== "admin") ||
    (["clients", "collaborations"].includes(route.view) && role !== "agent") ||
    (route.view === "dashboard" && role !== "owner") ||
    (route.view === "tasks" && role === "owner");
  const view = restricted
    ? role === "owner"
      ? "dashboard"
      : role === "admin"
        ? "admin"
        : "listings"
    : route.view;
  const openListing = (id: string) => navigate("detail", id);
  if (production && !data.user) return <PairLogin />;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳至主要内容
      </a>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <button
          className="brand"
          onClick={() =>
            navigate(
              role === "owner"
                ? "dashboard"
                : role === "admin"
                  ? "admin"
                  : "listings",
            )
          }
        >
          <span className="brand-symbol">栖</span>
          <span>
            栖岸<small>房产管理</small>
          </span>
        </button>
        <button
          className="mobile-close icon-button"
          aria-label="关闭菜单"
          onClick={() => setMobileNav(false)}
        >
          <X size={20} />
        </button>
        {!production && (
          <label className="role-switch">
            我的工作视角
            <select
              aria-label="切换角色"
              value={role}
              disabled={loading || busy > 0}
              onChange={(e) => switchRole(e.target.value as Role)}
            >
              {Object.entries(roleLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label} · 演示登录
                </option>
              ))}
            </select>
          </label>
        )}
        <nav aria-label="主导航">
          {nav.map((v) => {
            const Icon = icons[v];
            return (
              <button
                className={
                  view === v || (view === "detail" && v === "listings")
                    ? "active"
                    : ""
                }
                onClick={() => navigate(v)}
                key={v}
              >
                <Icon size={19} strokeWidth={1.6} />
                {pageLabels[v]}
                {v === "messages" &&
                  data.messages.some(
                    (m) =>
                      m.recipientId === data.user?.id && m.status === "sent",
                  ) && <i className="unread-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <p>
            房产管理
            <br />
            协作工作台
          </p>
          <button onClick={() => navigate("integrations")}>
            服务商配置状态
          </button>
          <button onClick={() => navigate("help")}>
            <CircleHelp size={17} />
            帮助中心
            <ArrowUpRight size={15} />
          </button>
          <button onClick={() => navigate("privacy")}>
            <ShieldCheck size={17} />
            隐私与说明
          </button>
          <span>
            {production ? "正式环境 · 管理员访问" : "开发环境 · 虚构演示数据"}
          </span>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="打开菜单"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              工作空间 <ChevronRight size={13} />{" "}
              <strong>{pageLabels[view]}</strong>
            </span>
          </div>
          <button className="user-button" onClick={() => navigate("profile")}>
            <span className="avatar">{data.user?.name[0]}</span>
            <span>
              {data.user?.name}
              <small>{roleLabels[role]}</small>
            </span>
            <ChevronRight size={15} />
          </button>
        </header>
        <div
          className={`connection-bar ${offline ? "disconnected" : ""}`}
          role="status"
        >
          <span>
            <i />
            {loading
              ? "正在连接服务器…"
              : offline
                ? production
                  ? "连接异常，请重试"
                  : "后端未连接 · 本地种子只读预览 · 不会保存提交"
                : production
                  ? "正式环境 · 服务器已连接 · 门锁控制关闭"
                  : "开发环境 · 虚构演示数据 · 门锁控制关闭"}
          </span>
          <button onClick={() => connect(role)} disabled={loading || busy > 0}>
            <RefreshCw size={13} />
            {offline ? "重新连接" : "刷新数据"}
          </button>
        </div>
        {error && (
          <div className="connection-error" role="alert">
            {error}
          </div>
        )}
        <main id="main-content" key={role} tabIndex={-1}>
          {view === "integrations" ? (
            <Integrations />
          ) : view === "dashboard" ? (
            <OwnerDashboard openListing={openListing} />
          ) : view === "listings" ? (
            <Listings openListing={openListing} />
          ) : view === "detail" ? (
            <ListingDetail
              key={route.id}
              id={route.id}
              back={() => navigate("listings")}
              message={(id) => {
                setRecipient(id);
                navigate("messages");
              }}
            />
          ) : view === "messages" ? (
            <Messages initialRecipient={recipient} />
          ) : view === "admin" ? (
            <AdminReview openListing={openListing} />
          ) : view === "tasks" ||
            view === "clients" ||
            view === "collaborations" ? (
            <Workspace key={view} view={view} />
          ) : (
            <AccountPages
              key={view}
              view={view as "profile" | "help" | "privacy"}
            />
          )}
          {view === "profile" && <AccountExport />}
          {production && view === "profile" && (
            <button
              className="button secondary"
              onClick={() => {
                void logout().catch((e) =>
                  window.alert(
                    e instanceof Error ? e.message : "退出未确认，请重试。",
                  ),
                );
              }}
            >
              退出登录
            </button>
          )}
        </main>
        <footer>
          <span>栖岸 房产管理</span>
          <span>房源与协作管理</span>
          <button onClick={() => navigate("privacy")}>
            隐私说明 <ArrowUpRight size={13} />
          </button>
        </footer>
      </div>
    </div>
  );
}
