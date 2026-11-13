import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { api, ApiError, type Row } from "../../lib/api";
import { ErrorBox, Field, asError } from "../../components/ui";
type Pending = {
  challenge: Row;
  action: () => Promise<any>;
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
};
const Context = createContext(<T,>(action: () => Promise<T>): Promise<T> =>
  action(),
);
export const useAdminAction = () => useContext(Context);
export function AdminActions({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);
  async function run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "AUTH_STEP_UP_REQUIRED")
        throw e;
      const challenge = (
        await api("/auth/step-up-challenges", { method: "POST" })
      ).data;
      return new Promise((resolve, reject) => {
        setCode("");
        setError(null);
        setPending({ challenge, action, resolve, reject });
      });
    }
  }
  function cancel() {
    pending?.reject(new Error("Đã hủy thao tác xác minh."));
    setPending(null);
  }
  async function verify() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        "/auth/step-up-challenges/" +
          pending.challenge.challengeId +
          "/verifications",
        {
          method: "POST",
          auth: false,
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: { challengeToken: pending.challenge.challengeToken, code },
        },
      );
      const value = await pending.action();
      pending.resolve(value);
      setPending(null);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider value={run}>
      {children}
      <dialog
        ref={dialog}
        className="modal"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) cancel();
        }}
      >
        <h2>Xác minh thao tác</h2>
        <p className="muted">Nhập mã bảo mật mới để tiếp tục.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <ErrorBox error={error} />
          <Field label="Mã xác minh hoặc mã khôi phục">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={32}
            />
          </Field>
          <div className="button-row">
            <button className="button" disabled={busy}>
              Xác minh
            </button>
            <button
              type="button"
              className="button ghost"
              disabled={busy}
              onClick={cancel}
            >
              Hủy
            </button>
          </div>
        </form>
      </dialog>
    </Context.Provider>
  );
}
