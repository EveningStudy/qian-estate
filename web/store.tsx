import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClient, ApiError } from "./api";
import { production } from "./config";
import { collections } from "./types";
import { previewData } from "./data";
import type { Payload, Role, Snapshot } from "./types";

const emptyData = (): Snapshot =>
  ({
    ...Object.fromEntries(collections.map((c) => [c, []])),
    user: null,
    demo: false,
    realLocksEnabled: false,
  }) as Snapshot;
interface Store {
  pair: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  data: Snapshot;
  role: Role;
  loading: boolean;
  offline: boolean;
  error: string;
  busy: number;
  connect: (role?: Role) => void;
  refresh: () => Promise<void>;
  request: <T>(
    path: string,
    method?: string,
    body?: Payload,
    key?: string,
  ) => Promise<T>;
  upload: (file: File) => Promise<{ url: string }>;
}
const Context = createContext<Store | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>(production ? "admin" : "owner");
  const [data, setData] = useState<Snapshot>(() =>
    production ? emptyData() : previewData("owner"),
  );
  const [loading, setLoading] = useState(!production);
  const [offline, setOffline] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(0);
  const client = useRef(new ApiClient());
  const generation = useRef(0);
  const connect = useCallback(async (next: Role = "owner") => {
    if (production) {
      setLoading(true);
      try {
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "读取失败，请重试。");
      } finally {
        setLoading(false);
      }
      return;
    }
    const run = ++generation.current;
    const api = new ApiClient();
    setRole(next);
    setLoading(true);
    setError("");
    setOffline(true);
    setData(previewData(next));
    try {
      await api.login(next);
      const snapshot = await api.bootstrap();
      if (run !== generation.current) return;
      client.current = api;
      setData(snapshot);
      setOffline(false);
    } catch (e) {
      if (run !== generation.current) return;
      const unavailable = e instanceof ApiError && e.unavailable;
      setData(
        unavailable
          ? previewData(next)
          : { ...previewData(next), properties: [], faqs: [] },
      );
      setError(e instanceof Error ? e.message : "连接失败");
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!production) void connect("owner");
    return () => {
      generation.current++;
    };
  }, [connect]);
  const refresh = async () => {
    const run = generation.current;
    const snapshot = await client.current.bootstrap().catch((e) => {
      if (production && e instanceof ApiError && e.status === 401) {
        client.current.clear();
        setData(emptyData());
        setOffline(true);
      }
      throw e;
    });
    if (run === generation.current) {
      setData(snapshot);
      setOffline(false);
      setError("");
    }
  };
  const request = async <T,>(
    path: string,
    method = "GET",
    body?: Payload,
    key?: string,
  ): Promise<T> => {
    if (offline || loading)
      throw new ApiError(
        "后端未连接：未提交任何数据。请先点击「重新连接」，再重试此操作。",
      );
    setBusy((n) => n + 1);
    try {
      const result = await client.current.request<T>(path, method, body, key);
      if (method !== "GET" && path !== "/valuation") {
        try {
          await refresh();
        } catch {
          setError(
            "操作已获服务器确认，但列表刷新失败。请重新连接查看最新状态，不要重复提交。",
          );
        }
      }
      return result;
    } catch (e) {
      if (production && e instanceof ApiError && e.status === 401) {
        client.current.clear();
        setData(emptyData());
        setOffline(true);
      }
      throw e;
    } finally {
      setBusy((n) => n - 1);
    }
  };
  const upload = async (file: File) => {
    if (offline || loading)
      throw new ApiError("后端未连接：图片未上传。请先重新连接后重试。");
    setBusy((n) => n + 1);
    try {
      return await client.current.upload(file);
    } finally {
      setBusy((n) => n - 1);
    }
  };
  const pair = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      await client.current.pair(code);
      setRole("admin");
      await refresh();
    } catch (e) {
      client.current.clear();
      setData(emptyData());
      setOffline(true);
      throw e;
    } finally {
      setLoading(false);
    }
  };
  const logout = async () => {
    await client.current.request("/auth/logout", "POST", {});
    client.current.clear();
    setData(emptyData());
    setOffline(true);
  };
  return (
    <Context.Provider
      value={{
        data,
        role,
        loading,
        offline,
        error,
        busy,
        connect,
        pair,
        logout,
        refresh,
        request,
        upload,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStore() {
  const value = useContext(Context);
  if (!value) throw new Error("需要应用状态提供器");
  return value;
}
