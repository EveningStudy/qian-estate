import { useRef, useState, type FormEvent } from "react";
import { useStore } from "../store";
export default function PairLogin() {
  const { pair, loading } = useStore();
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    const form = e.currentTarget;
    const code = String(new FormData(form).get("code") || "");
    setError("");
    try {
      await pair(code);
      location.hash = "admin";
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败，请重新获取配对码。");
      form.reset();
    } finally {
      lock.current = false;
    }
  }
  return (
    <main className="pair-login">
      <h1>栖岸管理后台</h1>
      <p>
        请在已获管理员权限的微信小程序中生成配对码，然后在此输入。配对码为 8
        位数字，60 秒内有效，仅可使用一次。
      </p>
      <form onSubmit={submit}>
        <label>
          管理员配对码
          <input
            name="code"
            aria-label="管理员配对码"
            required
            pattern="[0-9]{8}"
            inputMode="numeric"
            minLength={8}
            maxLength={8}
            autoComplete="off"
            type="password"
          />
        </label>
        <button className="button primary" disabled={loading}>
          {loading ? "正在配对…" : "配对登录"}
        </button>
        {error && (
          <p role="alert" className="error">
            {error} 如果提交结果未确认，请在小程序生成新码后再试。
          </p>
        )}
      </form>
      <p className="fine-print">
        正式环境不提供演示登录。会话仅保存在当前页面内存，刷新或关闭页面后需重新配对。业主发布房源须使用微信小程序完成内容安全检查。
      </p>
    </main>
  );
}
