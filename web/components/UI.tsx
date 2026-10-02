import { useRef, useState, type ReactNode, type FormEvent } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  Building2,
} from "lucide-react";
import { assetUrl } from "../config";
import { useStore } from "../store";
import { statusLabels } from "../data";
import type { Payload } from "../types";

export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <i />
      {statusLabels[value] || value}
    </span>
  );
}
export function Empty({
  children = "暂无记录。提交后会在这里显示。",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Building2 size={26} />
      <p>{children}</p>
    </div>
  );
}
export function Section({
  title,
  caption,
  action,
  children,
  className = "",
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section ${className}`}>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {caption && <p>{caption}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function PropertyImage({
  src = "/assets/interior-1.png",
  alt,
  className = "",
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // 兼容旧版种子文件名；当前独立素材使用 PNG 格式。
  const path = src.replace(/(\/assets\/interior-\d+)\.jpe?g$/i, "$1.png");
  return (
    <div className={`property-image ${className}`}>
      {failed ? (
        <div className="image-placeholder">
          <Building2 size={32} strokeWidth={1} />
          <span>房源图片待补充</span>
        </div>
      ) : (
        <img
          src={assetUrl(path)}
          alt={alt}
          onError={() => setFailed(true)}
          loading="lazy"
        />
      )}
    </div>
  );
}
export interface Field {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  value?: string | number;
  options?: { value: string; label: string }[];
  wide?: boolean;
  min?: number | string;
  max?: number;
}
export function RemoteForm({
  fields,
  path,
  method = "POST",
  submit,
  fixed = {},
  onResult,
  success = "服务器已确认提交。",
  children,
}: {
  fields: Field[];
  path: string;
  method?: string;
  submit: string;
  fixed?: Payload;
  onResult?: (value: unknown) => void;
  success?: string;
  children?: ReactNode;
}) {
  const { request } = useStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const attempt = useRef({ fingerprint: "", key: "" });
  const locked = useRef(false);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    const form = new FormData(event.currentTarget);
    const payload: Payload = { ...fixed };
    for (const field of fields) {
      const value = String(form.get(field.name) || "").trim();
      if (value || (method === "PUT" && path === "/profile"))
        payload[field.name] =
          field.type === "number"
            ? Number(value)
            : field.type === "datetime-local"
              ? new Date(value).toISOString()
              : value;
    }
    const fingerprint = JSON.stringify([path, method, payload]);
    if (attempt.current.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    setPending(true);
    setError("");
    setDone(false);
    try {
      const result = await request(path, method, payload, attempt.current.key);
      setDone(true);
      onResult?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败，请重试。");
    } finally {
      setPending(false);
      locked.current = false;
    }
  }
  return (
    <form
      onSubmit={send}
      onChange={() => setDone(false)}
      className="remote-form"
    >
      <div className="field-grid">
        {fields.map((field) => (
          <label className={field.wide ? "wide" : ""} key={field.name}>
            {field.label}
            {field.required && <span className="required"> *</span>}
            {field.options ? (
              <select
                name={field.name}
                required={field.required}
                defaultValue={field.value}
              >
                {field.options.map((o) => (
                  <option value={o.value} key={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                name={field.name}
                defaultValue={field.value}
                placeholder={field.placeholder}
                required={field.required}
                maxLength={5000}
                rows={3}
              />
            ) : (
              <input
                name={field.name}
                type={field.type || "text"}
                defaultValue={field.value}
                placeholder={field.placeholder}
                required={field.required}
                min={field.type === "number" ? (field.min ?? 0.01) : field.min}
                max={
                  field.type === "number" ? (field.max ?? 1000000) : undefined
                }
                step={field.type === "number" ? "any" : undefined}
                maxLength={200}
              />
            )}
          </label>
        ))}
      </div>
      {children}
      <button className="button primary" disabled={pending || done}>
        {pending ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <ArrowUpRight size={16} />
        )}
        {pending
          ? "正在提交…"
          : done
            ? "已提交"
            : error
              ? `重试 · ${submit}`
              : submit}
      </button>
      {error && (
        <p role="alert" className="form-feedback error">
          <AlertCircle size={16} />
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="form-feedback success">
          <CheckCircle2 size={16} />
          {success}
        </p>
      )}
    </form>
  );
}
export function MutationButton({
  path,
  body = {},
  method = "PATCH",
  children,
  className = "button secondary",
  onResult,
}: {
  path: string;
  body?: Payload;
  method?: string;
  children: ReactNode;
  className?: string;
  onResult?: (value: unknown) => void;
}) {
  const { request } = useStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const key = useRef("");
  const lock = useRef(false);
  const run = async () => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    key.current ||= crypto.randomUUID();
    try {
      const result = await request(path, method, body, key.current);
      key.current = "";
      onResult?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <div className="mutation">
      <button
        type="button"
        className={className}
        onClick={() => void run()}
        disabled={pending}
      >
        {pending ? <LoaderCircle className="spin" size={15} /> : null}
        {error ? "重试 · " : ""}
        {children}
      </button>
      {error && (
        <small role="alert" className="error">
          {error}
        </small>
      )}
    </div>
  );
}
