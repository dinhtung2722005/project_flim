import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Send,
  Square,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { api, type Row } from "../lib/api";
import { useAuth } from "../lib/state";
import { ErrorBox, Spinner } from "../components/ui";
import "../assistant.css";
import { AssistantFeedback } from "../components/AssistantFeedback";
type Turn = { key: string; question: string; run?: Row; error?: Error };
const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const runErrors: Record<string, string> = {
  AGENT_MODEL_UNAVAILABLE:
    "Trợ lý tạm thời chưa kết nối được bộ xử lý. Bạn có thể thử lại sau.",
  AGENT_WORKER_UNAVAILABLE: "Trợ lý đang gián đoạn. Hãy thử lại sau.",
  AGENT_TIMEOUT: "Lượt trả lời đã hết thời gian. Hãy thử câu hỏi ngắn hơn.",
  AGENT_CONTEXT_CHANGED: "Ngữ cảnh đã thay đổi. Hãy bắt đầu câu hỏi mới.",
  AGENT_ANSWER_INVALID:
    "Chưa xác minh được câu trả lời. Hãy thử diễn đạt rõ hơn.",
  AUTH_SESSION_REVOKED: "Phiên đăng nhập đã kết thúc.",
};
const safeLink = (value: unknown) =>
  typeof value === "string" &&
  /^\/help(?:#[a-z0-9-]{1,50})?$|^\/(?:library|for-you|login)?$|^\/titles\/[a-f0-9-]{36}$|^\/watch\/[a-f0-9-]{36}$/i.test(
    value,
  )
    ? value
    : "/help";
export function AssistantPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const candidate = params.get("titleId");
  const contextTitleId =
    candidate && /^[a-f0-9-]{36}$/i.test(candidate) ? candidate : undefined;
  const [capabilities, setCapabilities] = useState<Row | null>(null),
    [turns, setTurns] = useState<Turn[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [avoidSpoilers, setAvoidSpoilers] = useState(true),
    [error, setError] = useState<Error | null>(null);
  const input = useRef<HTMLTextAreaElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    transcript = useRef<HTMLDivElement>(null);
  const epoch = useRef(0),
    active = useRef<{
      id?: string;
      turnKey: string;
      controller: AbortController;
      epoch: number;
    } | null>(null);
  const parent = useRef<string | undefined>(undefined),
    depth = useRef(0);
  const intent = useRef<{ body: string; key: string } | null>(null);
  const stop = useCallback(async () => {
    const current = active.current;
    active.current = null;
    epoch.current++;
    if (current?.id) current.controller.abort();
    setBusy(false);
    if (current) {
      setTurns((old) =>
        old.map((t) =>
          t.key === current.turnKey
            ? { ...t, run: { ...(t.run ?? {}), status: "CANCELLED" } }
            : t,
        ),
      );
    }
    if (current?.id) {
      try {
        await api("/assistant/runs/" + current.id, { method: "DELETE" });
      } catch {}
    }
  }, []);
  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    setCapabilities(null);
    setTurns([]);
    setError(null);
    setBusy(false);
    parent.current = undefined;
    depth.current = 0;
    intent.current = null;
    api("/assistant/capabilities", { signal: controller.signal })
      .then((r) => {
        if (epoch.current === generation) setCapabilities(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted && epoch.current === generation)
          setError(e);
      });
    const logout = () => {
      void stop();
      setTurns([]);
      parent.current = undefined;
      depth.current = 0;
      intent.current = null;
    };
    window.addEventListener("pj-flim:logout", logout);
    window.addEventListener("pj-flim:signout", logout);
    return () => {
      controller.abort();
      const current = active.current;
      active.current = null;
      epoch.current++;
      if (current?.id) current.controller.abort();
      if (current?.id)
        void api("/assistant/runs/" + current.id, { method: "DELETE" }).catch(
          () => {},
        );
      window.removeEventListener("pj-flim:logout", logout);
      window.removeEventListener("pj-flim:signout", logout);
    };
  }, [user?.id, stop]);
  useEffect(() => {
    transcript.current?.scrollTo({
      top: transcript.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [turns, busy]);
  async function send(question = text, chosenContext = contextTitleId) {
    question = question.trim();
    if (!question || busy || !capabilities?.enabled) return;
    if (question.length > 2000) {
      setError(new Error("Câu hỏi tối đa 2.000 ký tự."));
      return;
    }
    const body = {
      message: question,
      limit: 5,
      avoidSpoilers,
      ...(chosenContext ? { contextTitleId: chosenContext } : {}),
      ...(parent.current ? { parentRunId: parent.current } : {}),
    };
    const serialized = JSON.stringify(body);
    if (!intent.current || intent.current.body !== serialized)
      intent.current = { body: serialized, key: crypto.randomUUID() };
    const idempotencyKey = intent.current.key,
      turnKey = crypto.randomUUID();
    const task = {
      controller: new AbortController(),
      turnKey,
      epoch: ++epoch.current,
      id: undefined as string | undefined,
    };
    active.current = task;
    setError(null);
    setBusy(true);
    setText("");
    setTurns((old) => [...old.slice(-9), { key: turnKey, question }]);
    const update = (run: Row) => {
      if (epoch.current !== task.epoch || task.controller.signal.aborted)
        return;
      setTurns((old) =>
        old.map((t) => (t.key === turnKey ? { ...t, run } : t)),
      );
    };
    const current = () =>
      epoch.current === task.epoch && !task.controller.signal.aborted;
    try {
      const created = await api("/assistant/runs", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body,
        signal: task.controller.signal,
      });
      task.id = created.data.id;
      if (!current()) {
        void api("/assistant/runs/" + task.id, { method: "DELETE" }).catch(
          () => {},
        );
        return;
      }
      update(created.data);
      intent.current = null;
      const start = Date.now();
      let delay = 700;
      while (current()) {
        const { data: run } = await api("/assistant/runs/" + task.id, {
          signal: task.controller.signal,
        });
        if (!current()) return;
        update(run);
        if (terminal.has(run.status)) {
          if (run.status === "SUCCEEDED") {
            depth.current++;
            parent.current = depth.current < 5 ? run.id : undefined;
            if (depth.current >= 5) depth.current = 0;
          }
          break;
        }
        if (Date.now() - start > 310000) {
          await stop();
          throw new Error(
            "Lượt trả lời đã hết thời gian. Hãy gửi lại câu hỏi.",
          );
        }
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          const timer = setTimeout(
            () => {
              task.controller.signal.removeEventListener("abort", abort);
              resolve();
            },
            delay + Math.random() * 150,
          );
          task.controller.signal.addEventListener("abort", abort, {
            once: true,
          });
        });
        delay = Math.min(2200, delay * 1.18);
      }
    } catch (e) {
      if (current()) {
        setTurns((old) =>
          old.map((t) => (t.key === turnKey ? { ...t, error: e as Error } : t)),
        );
        setError(e as Error);
      }
    } finally {
      if (epoch.current === task.epoch) {
        active.current = null;
        setBusy(false);
        input.current?.focus({ preventScroll: true });
      }
    }
  }
  const reset = async () => {
    await stop();
    setTurns([]);
    setError(null);
    parent.current = undefined;
    depth.current = 0;
    intent.current = null;
    input.current?.focus();
  };
  const examples = [
    "Có phim nào đang xem được?",
    "Đổi chất lượng video thế nào?",
    "Làm sao lưu phim yêu thích?",
  ];
  return (
    <div className="container assistant-page">
      <div className="assistant-heading">
        <div>
          <span className="eyebrow">TRỢ LÝ PJ-FLIM</span>
          <h1>Tìm phim, hỏi thật dễ.</h1>
          <p className="muted">
            Tra cứu phim, điểm IMDb/Metacritic, review và hướng dẫn sử dụng.
          </p>
        </div>
        <button className="button ghost small" onClick={() => void reset()}>
          <Plus size={17} />
          Cuộc trò chuyện mới
        </button>
      </div>
      <div className="assistant-scope">
        <ShieldCheck size={18} />
        <span>
          Trợ lý đọc thông tin phim công khai, điểm OMDb và review TMDB đã lưu.
          Nội dung hỏi được lưu tối đa 7 ngày; tránh gửi mật khẩu hay thông tin
          nhạy cảm.
        </span>
      </div>
      {!capabilities && !error && <Spinner label="Đang kết nối trợ lý…" />}
      {capabilities && !capabilities.enabled && (
        <div className="panel">
          <h2>Trợ lý chưa được bật</h2>
          <p className="muted">Bạn vẫn có thể tìm phim trong kho.</p>
          <Link className="button" to="/">
            Khám phá phim
          </Link>
        </div>
      )}
      <div
        className="assistant-transcript"
        ref={transcript}
        role="log"
        aria-label="Cuộc trò chuyện"
        aria-live="polite"
        aria-busy={busy}
      >
        {turns.length === 0 && (
          <div className="assistant-welcome">
            <span className="assistant-bot">
              <Bot size={28} />
            </span>
            <h2>Bạn muốn xem gì hôm nay?</h2>
            <p>Hỏi tên phim, tìm thể loại hoặc tìm cách sử dụng website.</p>
            <div className="assistant-examples">
              {examples.map((q) => (
                <button
                  key={q}
                  onClick={() => void send(q)}
                  disabled={busy || !capabilities?.enabled}
                >
                  {q}
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <article className="assistant-turn" key={t.key}>
            <div className="assistant-question">
              <span className="sr-only">Bạn: </span>
              {t.question}
            </div>
            <div className="assistant-answer">
              <div className="assistant-speaker">
                <Bot size={18} />
                <strong>Trợ lý pj-Flim</strong>
              </div>
              {!t.run && !t.error && (
                <span className="muted">Đang gửi câu hỏi…</span>
              )}
              {t.run && !terminal.has(t.run.status) && (
                <span className="assistant-processing" role="status">
                  {t.run.status === "QUEUED"
                    ? "Đang chờ xử lý…"
                    : "Đang tra cứu dữ liệu…"}
                </span>
              )}
              {t.error && <p className="error-text">{t.error.message}</p>}
              {t.run?.status === "CANCELLED" && (
                <p className="muted">Đã dừng lượt trả lời.</p>
              )}
              {t.run && ["FAILED", "TIMED_OUT"].includes(t.run.status) && (
                <p className="error-text">
                  {runErrors[t.run.errorCode] ??
                    "Chưa thể hoàn tất câu hỏi. Hãy thử lại."}
                </p>
              )}
              {t.run?.result && (
                <>
                  <p className="assistant-answer-text">{t.run.result.answer}</p>
                  {t.run.result.cards?.length > 0 && (
                    <div className="assistant-cards">
                      {t.run.result.cards.map((card: Row) => (
                        <div className="assistant-film" key={card.id}>
                          <h3>
                            <Link to={safeLink(card.url)}>{card.name}</Link>
                          </h3>
                          <p className="muted">
                            {card.year ?? "Chưa có năm"} ·{" "}
                            {card.kind === "SERIES" ? "Phim bộ" : "Phim lẻ"}
                          </p>
                          {card.genres?.length > 0 && (
                            <p>
                              {card.genres.map((g: Row) => g.name).join(" · ")}
                            </p>
                          )}
                          <div className="assistant-film-actions">
                            <Link
                              className="button small"
                              to={safeLink(card.url)}
                            >
                              Chi tiết <ArrowUpRight size={14} />
                            </Link>
                            <button
                              className="button ghost small"
                              disabled={busy}
                              onClick={() =>
                                void send("Phim này có những tập nào?", card.id)
                              }
                            >
                              Hỏi về phim này
                            </button>
                            <button
                              className="button ghost small"
                              disabled={busy}
                              onClick={() =>
                                void send(
                                  "Điểm IMDb, Metacritic và review phim này?",
                                  card.id,
                                )
                              }
                            >
                              Điểm và review
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {t.run.result.feedback?.length > 0 && (
                    <AssistantFeedback items={t.run.result.feedback} />
                  )}
                  {t.run.result.episodes?.length > 0 && (
                    <ul className="assistant-episodes">
                      {t.run.result.episodes.map((e: Row) => (
                        <li key={e.id}>
                          <Link to={safeLink(e.url)}>
                            Mùa {e.seasonNumber} · Tập {e.number}
                            {e.name ? " — " + e.name : ""}
                          </Link>
                          {Number.isFinite(e.durationSeconds) && (
                            <small className="muted">
                              {" "}
                              · khoảng{" "}
                              {Math.max(
                                1,
                                Math.round(e.durationSeconds / 60),
                              )}{" "}
                              phút
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.run.result.sources?.length > 0 && (
                    <details className="assistant-sources">
                      <summary>
                        Nguồn dữ liệu ({t.run.result.sources.length})
                      </summary>
                      <ul>
                        {t.run.result.sources.map((s: Row) => (
                          <li key={s.id}>
                            <Link to={safeLink(s.url)}>{s.label}</Link>
                            <small> · pj-Flim</small>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          </article>
        ))}
        <div ref={bottom} />
      </div>
      <ErrorBox error={error} />
      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="assistant-message" className="sr-only">
          Câu hỏi cho trợ lý phim
        </label>
        <textarea
          ref={input}
          id="assistant-message"
          rows={2}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            contextTitleId
              ? "Hỏi về phim đang chọn…"
              : "Nhập tên phim hoặc câu hỏi…"
          }
          disabled={busy || !capabilities?.enabled}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <label className="assistant-spoiler-toggle">
          <input
            type="checkbox"
            checked={avoidSpoilers}
            disabled={busy}
            onChange={(e) => setAvoidSpoilers(e.target.checked)}
          />
          Tránh tiết lộ nội dung phim
        </label>
        <div className="assistant-composer-bottom">
          <small className="muted">
            Enter để gửi · Shift + Enter để xuống dòng
          </small>
          {busy ? (
            <button
              type="button"
              className="button ghost"
              onClick={() => void stop()}
            >
              <Square size={15} />
              Dừng
            </button>
          ) : (
            <button
              type="submit"
              className="button"
              disabled={!text.trim() || !capabilities?.enabled}
            >
              <Send size={17} />
              Gửi
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
