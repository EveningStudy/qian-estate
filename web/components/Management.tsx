import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Empty, MutationButton, RemoteForm, Section, Status } from "./UI";

export function useRemote<T>(path: string) {
  const { request, offline, data } = useStore();
  const [value, setValue] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setValue(undefined);
    void request<T>(path)
      .then((v) => {
        if (live) setValue(v);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "读取失败");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, offline, version, data]);
  return { value, error, loading, reload: () => setVersion((n) => n + 1) };
}
export function ReadState({
  state,
}: {
  state: { error: string; loading: boolean; reload: () => void };
}) {
  return state.loading ? (
    <p role="status">正在读取…</p>
  ) : state.error ? (
    <div role="alert" className="error">
      {state.error}
      <button className="button secondary" onClick={state.reload}>
        重试读取
      </button>
    </div>
  ) : null;
}
interface Check {
  verified: boolean;
  authorizationConfirmed: boolean;
  code: string;
  agencyRegistration: string;
  note: string;
  checkedAt: string;
}
export function PropertyCheck({ id }: { id: string }) {
  const state = useRemote<Check | null>(`/property-checks/${id}`);
  const check = state.value;
  return (
    <div className="property-check">
      <h3>发布前人工核验</h3>
      <p className="fine-print">
        请核对产权资料、房源核验编号、机构备案和业主授权后登记。核验登记不代替住建平台核验；编辑房源后需要重新核验。
      </p>
      <ReadState state={state} />
      {!state.loading && !state.error && (
        <>
          <p>
            {check?.verified && check.authorizationConfirmed
              ? "当前记录：核验与授权已确认"
              : "当前记录：未完成核验，暂不能发布"}
          </p>
          {check && (
            <p className="fine-print">
              核验编号：{check.code} · 机构备案：{check.agencyRegistration} ·{" "}
              {check.note}
            </p>
          )}
          <RemoteForm
            path={`/property-checks/${id}`}
            method="PUT"
            fixed={{ verified: true, authorizationConfirmed: true }}
            submit="保存核验登记"
            onResult={state.reload}
            fields={[
              {
                name: "code",
                label: "房源核验编号",
                required: true,
                value: check?.code,
              },
              {
                name: "agencyRegistration",
                label: "机构备案信息",
                required: true,
                value: check?.agencyRegistration,
              },
              {
                name: "note",
                label: "核验说明",
                type: "textarea",
                wide: true,
                required: true,
                value: check?.note,
              },
            ]}
          >
            <label className="consent">
              <input type="checkbox" required />
              已核对房源真实性资料，并确认业主发布授权。
            </label>
          </RemoteForm>
          {check?.verified && check.authorizationConfirmed && (
            <MutationButton
              path={`/properties/${id}`}
              body={{ status: "published" }}
              className="button primary"
            >
              核验完成，审核发布
            </MutationButton>
          )}
        </>
      )}
    </div>
  );
}
interface Application {
  id: string;
  name: string;
  company: string;
  licenseNumber: string;
  city: string;
  phone: string;
  status: string;
  note?: string;
}
export function AgentApplications() {
  const state = useRemote<Application[]>("/agent-applications");
  return (
    <Section
      title="经纪人入驻审核"
      caption="核对申请人的机构和资质后填写处理意见。"
    >
      <ReadState state={state} />
      {state.value?.map((a) => (
        <article className="review-item" key={a.id}>
          <h3>
            {a.name} · {a.company}
          </h3>
          <p>
            {a.city} · 资质编号：{a.licenseNumber} · 联系电话：{a.phone}
          </p>
          <Status value={a.status} />
          {a.status === "pending" ? (
            <RemoteForm
              path={`/agent-applications/${a.id}`}
              method="PATCH"
              submit="提交审核结果"
              onResult={state.reload}
              fields={[
                {
                  name: "status",
                  label: "审核结论",
                  options: [
                    { value: "approved", label: "批准入驻" },
                    { value: "rejected", label: "拒绝入驻" },
                  ],
                },
                {
                  name: "note",
                  label: "审核意见",
                  required: true,
                  type: "textarea",
                  wide: true,
                },
              ]}
            />
          ) : (
            <p>{a.note}</p>
          )}
        </article>
      ))}
      {state.value?.length === 0 && <Empty>暂无入驻申请。</Empty>}
    </Section>
  );
}
export function AccountRequests() {
  const state =
    useRemote<
      {
        id: string;
        userId: string;
        type: string;
        status: string;
        createdAt: string;
      }[]
    >("/account/requests");
  return (
    <Section
      title="账号请求"
      caption="目前仅供查看。注销需另行核对未结业务及依法保留事项；本页不会删除账号。"
    >
      <ReadState state={state} />
      {state.value?.map((r) => (
        <div className="record-row" key={r.id}>
          <div>
            <strong>{r.type === "deletion" ? "注销申请" : "账号请求"}</strong>
            <p>
              用户标识：{r.userId} ·{" "}
              {new Date(r.createdAt).toLocaleString("zh-CN")}
            </p>
          </div>
          <Status value={r.status} />
        </div>
      ))}
      {state.value?.length === 0 && <Empty>暂无账号请求。</Empty>}
    </Section>
  );
}
export function AccountExport() {
  const { request } = useStore();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    setBusy(true);
    setMessage("");
    try {
      const data = await request("/account/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "个人数据导出.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage("服务器已返回当前账号数据，已发起下载。请妥善保管导出文件。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导出失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="导出个人数据">
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? "正在导出…" : "下载当前账号数据"}
      </button>
      <p role="status" className="fine-print">
        {message}
      </p>
    </Section>
  );
}
