import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, setSession, type Row } from "../lib/api";
import { useAuth, useData } from "../lib/state";
import { Field, ErrorBox, asError, Spinner } from "../components/ui";

export function EmailActionPage({
  kind,
}: {
  kind: "forgot" | "reset" | "verify";
}) {
  const location = useLocation();
  const [token, setToken] = useState(
    () =>
      new URLSearchParams(location.hash.slice(1)).get("token") ||
      new URLSearchParams(location.search).get("token") ||
      "",
  );
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(""),
    [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (location.hash || new URLSearchParams(location.search).has("token"))
      window.history.replaceState(window.history.state, "", location.pathname);
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (kind === "reset" && password !== confirm)
        throw new Error("Hai mật khẩu chưa khớp.");
      await api(
        kind === "forgot"
          ? "/auth/password-reset-requests"
          : kind === "verify"
            ? "/auth/email-verifications"
            : "/auth/password-resets",
        {
          method: "POST",
          auth: false,
          body:
            kind === "forgot"
              ? { email }
              : kind === "verify"
                ? { token }
                : { token, password },
        },
      );
      setDone(
        kind === "forgot"
          ? "Nếu tài khoản đủ điều kiện, email hướng dẫn đã được gửi."
          : kind === "verify"
            ? "Email đã được xác minh."
            : "Mật khẩu đã được đổi. Hãy đăng nhập lại.",
      );
      setToken("");
      setPassword("");
      setConfirm("");
      if (kind === "reset") setSession(null);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/email-verification-requests", {
        method: "POST",
        auth: false,
        body: { email },
      });
      setDone("Nếu tài khoản đủ điều kiện, email xác minh đã được gửi.");
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  const title =
    kind === "forgot"
      ? "Quên mật khẩu"
      : kind === "reset"
        ? "Đặt mật khẩu mới"
        : "Xác minh email";
  return (
    <div className="container narrow">
      <section className="panel content-section">
        <h1>{title}</h1>
        <ErrorBox error={error} />
        {done ? (
          <div role="status">
            <p>{done}</p>
            <Link className="button" to="/login">
              Đến đăng nhập
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={submit}>
              {kind === "forgot" ? (
                <Field label="Email">
                  <input
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
              ) : (
                <Field
                  label="Mã xác minh"
                  hint="Mã dùng một lần trong email; liên kết email sẽ điền sẵn."
                >
                  <input
                    required
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    pattern="[A-Za-z0-9_-]{64}"
                    maxLength={64}
                  />
                </Field>
              )}
              {kind === "reset" && (
                <>
                  <Field label="Mật khẩu mới" hint="Từ 12 đến 128 ký tự.">
                    <input
                      required
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                  <Field label="Nhập lại mật khẩu mới">
                    <input
                      required
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </Field>
                </>
              )}
              <button className="button" disabled={busy}>
                {busy
                  ? "Đang xử lý…"
                  : kind === "forgot"
                    ? "Gửi hướng dẫn"
                    : kind === "verify"
                      ? "Xác minh email"
                      : "Đổi mật khẩu"}
              </button>
            </form>
            {kind === "verify" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void resend();
                }}
              >
                <h2>Gửi lại email</h2>
                <Field label="Email nhận mã">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <button className="button secondary" disabled={busy}>
                  Gửi lại mã xác minh
                </button>
              </form>
            )}
          </>
        )}
        <p>
          <Link to="/login">Quay lại đăng nhập</Link>
        </p>
      </section>
    </div>
  );
}

export function AccountPage() {
  const auth = useAuth(),
    user = useData<Row>(auth.user ? "/users/" + auth.user.id : null),
    mfa = useData<Row>("/me/mfa");
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [enrollment, setEnrollment] = useState<Row | null>(null),
    [codes, setCodes] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [message, setMessage] = useState("");
  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setEnrollment(
        (
          await api("/me/mfa/enrollments", {
            method: "POST",
            body: { password },
          })
        ).data,
      );
      setPassword("");
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<Row>(
        "/me/mfa/enrollments/" + enrollment!.id + "/verifications",
        { method: "POST", body: { code } },
      );
      setCodes(r.data.recoveryCodes);
      setCode("");
      setEnrollment(null);
      mfa.reload();
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/email-verification-requests", {
        method: "POST",
        auth: false,
        body: { email: auth.user!.emailNormalized },
      });
      setMessage("Nếu tài khoản đủ điều kiện, email xác minh đã được gửi.");
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container narrow">
      <h1>Tài khoản và bảo mật</h1>
      <section className="panel content-section">
        <h2>Email</h2>
        <p>{auth.user?.emailNormalized}</p>
        {user.loading ? (
          <Spinner />
        ) : (
          <p>
            {user.data?.emailVerifiedAt
              ? "Email đã xác minh"
              : "Email chưa xác minh"}
          </p>
        )}
        {!user.data?.emailVerifiedAt && (
          <>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void verify()}
            >
              Gửi email xác minh
            </button>
            <p>
              <Link to="/verify-email">Nhập mã xác minh</Link>
            </p>
          </>
        )}
        {message && <p role="status">{message}</p>}
        <p>
          <Link to="/forgot-password">Đổi mật khẩu qua email</Link>
        </p>
      </section>
      <section className="panel content-section">
        <h2>Xác thực hai bước</h2>
{mfa.data?.requiredForLogin===false&&<p className="muted">Môi trường kiểm thử hiện chưa yêu cầu mã hai bước khi đăng nhập. Khóa đã thiết lập sẽ được dùng khi chính sách MFA được bật.</p>}
        <ErrorBox error={error || mfa.error} />
        {mfa.loading ? (
          <Spinner />
        ) : codes.length ? (
          <>
            <p>
              Lưu các mã khôi phục dưới đây ở nơi riêng tư. Mỗi mã chỉ dùng một
              lần và chỉ hiển thị trong lần này.
            </p>
            <div className="recovery-codes">
              {codes.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <button className="button" onClick={() => setCodes([])}>
              Tôi đã lưu mã khôi phục
            </button>
          </>
        ) : mfa.data?.enabled ? (
          <p role="status">Xác thực hai bước đã được bật.</p>
        ) : enrollment ? (
          <form onSubmit={confirm}>
            <p>Nhập khóa này vào ứng dụng xác thực bằng chế độ TOTP:</p>
            <code className="enrollment-secret">{enrollment.secret}</code>
            <p>
              Khóa hết hạn sau 10 phút. Không chia sẻ khóa hoặc mã xác thực.
            </p>
            <Field label="Mã từ ứng dụng xác thực">
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <button className="button" disabled={busy}>
              Xác nhận bật MFA
            </button>
          </form>
        ) : (
          <form onSubmit={start}>
            <p>Bảo vệ tài khoản bằng mã dùng một lần từ ứng dụng xác thực.</p>
            <Field label="Mật khẩu hiện tại">
              <input
                required
                type="password"
                maxLength={1024}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <button className="button" disabled={busy || !!mfa.error}>
              Thiết lập MFA
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
