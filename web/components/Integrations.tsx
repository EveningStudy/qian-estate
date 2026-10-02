import { useState, type FormEvent } from "react";
import { useStore } from "../store";
import { apiBase } from "../config";
import { ReadState, useRemote } from "./Management";
import { RemoteForm, Section } from "./UI";

interface Integration {
  name?: string;
  supported: boolean;
  configured: boolean;
  liveVerified: boolean;
  note: string;
}
const names: Record<string, string> = {
  s3: "私有对象存储",
  wechatPay: "微信支付工具",
  wechat: "微信登录与授权",
  maps: "地图服务",
  map: "地图服务",
  sms: "短信服务",
  subscribeMessage: "微信订阅消息",
  identity: "身份核验",
  propertyVerify: "房源核验",
  smartLock: "门锁设备",
  storage: "图片存储",
  objectStorage: "对象存储",
};
export default function Integrations() {
  const state = useRemote<Record<string, Integration>>("/integrations/status");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>服务商配置状态</h1>
          <p>配置由服务端管理。已配置不代表已完成真实环境联调。</p>
        </div>
      </div>
      <p className="fine-print">
        接口基地址：{apiBase || "当前站点同源代理"}。浏览器不保存服务商密钥。
      </p>
      <ReadState state={state} />
      <button
        className="button secondary"
        disabled={state.loading}
        onClick={state.reload}
      >
        刷新服务状态
      </button>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>服务</th>
              <th>实现情况</th>
              <th>配置情况</th>
              <th>实测状态</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(state.value || {})
              .filter(([, v]) => v && typeof v === "object" && "supported" in v)
              .map(([key, v]) => (
                <tr key={key}>
                  <td>
                    {names[key] ||
                      (v.name && /[\u3400-\u9fff]/.test(v.name)
                        ? v.name
                        : "其他服务")}
                  </td>
                  <td>{v.supported ? "已实现" : "未支持"}</td>
                  <td>{v.configured ? "已配置" : "未配置"}</td>
                  <td>{v.liveVerified ? "服务端报告已验证" : "尚未实测"}</td>
                  <td className="wrap-cell">{v.note}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <MapTools />
      <SmsTools />
    </>
  );
}
function MapTools() {
  const { request } = useStore();
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    const mode = String(values.get("mode"));
    const params = new URLSearchParams({
      city: String(values.get("city")),
      [mode === "search" ? "keyword" : "address"]: String(values.get("text")),
    });
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      setResult(await request(`/map/${mode}?${params}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "查询失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      title="地图查询"
      caption="由已配置的地图服务商返回结果；不自动触发查询。"
    >
      <form onSubmit={submit}>
        <div className="field-grid">
          <label>
            查询方式
            <select name="mode">
              <option value="search">搜索地址</option>
              <option value="geocode">地址坐标解析</option>
            </select>
          </label>
          <label>
            城市
            <input name="city" required maxLength={100} />
          </label>
          <label className="wide">
            关键词或完整地址
            <input name="text" required maxLength={100} />
          </label>
        </div>
        <button className="button secondary" disabled={busy}>
          {busy ? "正在查询…" : "查询地图"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error} 请调整输入或检查配置后重试。
        </p>
      )}
      {result !== undefined && (
        <div className="map-results">
          <MapResult value={result} />
        </div>
      )}
    </Section>
  );
}
function MapResult({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <>
        {value.length ? (
          value.map((v, i) => <MapResult key={i} value={v} />)
        ) : (
          <p>没有找到匹配地址。</p>
        )}
      </>
    );
  if (value && typeof value === "object") {
    const r = value as Record<string, unknown>;
    const labels: Record<string, string> = {
      title: "名称",
      name: "名称",
      address: "地址",
      city: "城市",
      district: "区域",
      lat: "纬度",
      lng: "经度",
      latitude: "纬度",
      longitude: "经度",
      location: "坐标",
      result: "查询结果",
      data: "查询结果",
      items: "地址列表",
      pois: "地址列表",
      formattedAddress: "标准地址",
      message: "说明",
    };
    return (
      <dl>
        {Object.entries(r)
          .filter(([k]) => k in labels)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{labels[k]}</dt>
              <dd>
                <MapResult value={v} />
              </dd>
            </div>
          ))}
      </dl>
    );
  }
  return <span>{String(value ?? "无数据")}</span>;
}
function SmsTools() {
  const { request } = useStore();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");
  async function send() {
    if (!consent || busy || blocked) return;
    setBusy(true);
    setBlocked(true);
    try {
      const r = await request<{ message: string }>("/sms/challenge", "POST", {
        consent: true,
      });
      setMessage(r.message);
    } catch (e) {
      setMessage(
        `${e instanceof Error ? e.message : "发送失败"} 发送结果可能未确认，请勿立即重发。`,
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setBlocked(false), 300000);
    }
  }
  return (
    <Section
      title="本人手机号短信校验"
      caption="仅向当前账号已绑定的手机号发送；请先在微信小程序绑定本人手机号。"
    >
      <label className="consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        我同意向本人已绑定手机号发送验证码。
      </label>
      <button
        className="button secondary"
        disabled={!consent || busy || blocked}
        onClick={() => void send()}
      >
        {busy ? "正在请求…" : blocked ? "五分钟内请勿重复发送" : "发送验证码"}
      </button>
      <p role="status">{message}</p>
      <RemoteForm
        path="/sms/verify"
        submit="校验验证码"
        fields={[{ name: "code", label: "六位短信验证码", required: true }]}
        success="服务器已确认验证码校验通过。"
      />
    </Section>
  );
}
