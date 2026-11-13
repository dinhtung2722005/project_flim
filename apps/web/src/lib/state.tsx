import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { api, hasSession, setSession, type Row, type Page } from "./api";
import { settlePlaybackCleanup } from "./playback-cleanup";
type Auth = {
  user: Row | null;
  loading: boolean;
  accept: (credentials: Row) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
};
const AuthContext = createContext<Auth>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Row | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    if (hasSession())
      api("/me")
        .then((r) => {
          if (active) setUser(r.data);
        })
        .catch(() => setSession(null))
        .finally(() => {
          if (active) setLoading(false);
        });
    else setLoading(false);
    const clear = () => setUser(null);
    window.addEventListener("pj-flim:signout", clear);
    return () => {
      active = false;
      window.removeEventListener("pj-flim:signout", clear);
    };
  }, []);
  async function accept(credentials: Row) {
    setSession(credentials as any);
    try {
      const r = await api("/me");
      setUser(r.data);
    } catch (e) {
      setSession(null);
      throw e;
    }
  }
  async function logout() {
    // Stop the visible player first; retain authentication until pending progress,
    // telemetry and DELETE playback-session finish, including after navigation.
    window.dispatchEvent(new Event("pj-flim:logout"));
    try {
      await settlePlaybackCleanup();
      await api("/auth/sessions/current", { method: "DELETE" });
    } finally {
      setSession(null);
      setUser(null);
    }
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accept,
        logout,
        can: (p) => !!user?.permissions?.includes(p),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
const NoticeContext = createContext<
  (text: string, kind?: "success" | "error") => void
>(() => {});
export const useNotice = () => useContext(NoticeContext);
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ text: string; kind: string } | null>(
    null,
  );
  const notify = useCallback(
    (text: string, kind = "success") => setNotice({ text, kind }),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <NoticeContext.Provider value={notify}>
      {children}
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={"toast " + notice.kind}
        >
          {notice.text}
          <button aria-label="Đóng thông báo" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </NoticeContext.Provider>
  );
}
export function useData<T = Row>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(!!path),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    api<T>(path, { signal: controller.signal })
      .then((r) => setData(r.data))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading, reload: () => setRevision((v) => v + 1) };
}
export function usePages(path: string | null) {
  const [rows, setRows] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [revision, setRevision] = useState(0);
  const active = useRef<AbortController | null>(null),
    flight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    flight.current = false;
    setRows([]);
    setCursor(null);
    setError(null);
    setLoading(!!path);
    if (path)
      api<Page>(path, { signal: controller.signal })
        .then((r) => {
          if (!controller.signal.aborted) {
            setRows(r.data.data);
            setCursor(r.data.page.nextCursor);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => controller.abort();
  }, [path, revision]);
  async function more() {
    const controller = active.current;
    if (
      !path ||
      !cursor ||
      loading ||
      flight.current ||
      !controller ||
      controller.signal.aborted
    )
      return;
    flight.current = true;
    setLoading(true);
    setError(null);
    try {
      const r = await api<Page>(
        path +
          (path.includes("?") ? "&" : "?") +
          "cursor=" +
          encodeURIComponent(cursor),
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setRows((old) => [
          ...old,
          ...r.data.data.filter(
            (item) => !old.some((row) => row.id === item.id),
          ),
        ]);
        setCursor(r.data.page.nextCursor);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e as Error);
    } finally {
      if (!controller.signal.aborted) {
        flight.current = false;
        setLoading(false);
      }
    }
  }
  return {
    rows,
    cursor,
    loading,
    error,
    more,
    reload: () => setRevision((v) => v + 1),
  };
}
