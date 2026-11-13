import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Row } from "../lib/api";
import { useAuth } from "../lib/state";
import {
  Empty,
  ErrorBox,
  MovieCard,
  PageHeading,
  Spinner,
} from "../components/ui";
type Feed = {
  data: Row[];
  page: { hasMore: boolean; nextCursor: string | null };
  meta: { personalized: boolean; enabled: boolean };
};
export function ForYou() {
  const { user } = useAuth();
  // Remount every private state/request when the account changes.
  return <PersonalFeed key={user?.id} />;
}
function PersonalFeed() {
  const [pref, setPref] = useState<Row | null>(null),
    [tag, setTag] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null),
    [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(true),
    [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const lifetime = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void load(controller.signal);
    const cancel = () => {
      generation.current++;
      controller.abort();
      setFeed(null);
      setPref(null);
      setUndo(null);
    };
    window.addEventListener("pj-flim:logout", cancel);
    return () => {
      controller.abort();
      generation.current++;
      window.removeEventListener("pj-flim:logout", cancel);
    };
  }, []);
  async function load(signal = lifetime.current?.signal) {
    const run = ++generation.current;
    setBusy(true);
    setError(null);
    setFeed(null);
    try {
      const p = await api<Row>("/me/recommendation-preferences", { signal });
      if (signal?.aborted || run !== generation.current) return;
      setPref(p.data);
      setTag(p.etag);
      const r = await api<Feed>("/me/recommendations?limit=12&surface=home", {
        signal,
      });
      if (!signal?.aborted && run === generation.current) setFeed(r.data);
    } catch (e) {
      if (!signal?.aborted && run === generation.current) setError(e as Error);
    } finally {
      if (!signal?.aborted && run === generation.current) setBusy(false);
    }
  }
  async function save(enabled: boolean, hideCompleted: boolean) {
    const signal = lifetime.current?.signal;
    setSaving(true);
    setError(null);
    generation.current++;
    setFeed(null);
    try {
      const p = await api<Row>("/me/recommendation-preferences", {
        method: "PATCH",
        headers: { "If-Match": tag },
        body: { enabled, hideCompleted },
        signal,
      });
      if (signal?.aborted) return;
      setPref(p.data);
      setTag(p.etag);
      setUndo(null);
      await load(signal);
    } catch (e) {
      if (!signal?.aborted) setError(e as Error);
    } finally {
      if (!signal?.aborted) setSaving(false);
    }
  }
  async function more() {
    if (!feed?.page.nextCursor) return;
    const run = generation.current,
      signal = lifetime.current?.signal;
    setBusy(true);
    setError(null);
    try {
      const r = await api<Feed>(
        "/me/recommendations?limit=12&surface=home&cursor=" +
          encodeURIComponent(feed.page.nextCursor),
        { signal },
      );
      if (!signal?.aborted && run === generation.current)
        setFeed((old) =>
          old
            ? {
                ...r.data,
                data: [
                  ...old.data,
                  ...r.data.data.filter(
                    (n) => !old.data.some((o) => o.id === n.id),
                  ),
                ],
              }
            : r.data,
        );
    } catch (e) {
      if (!signal?.aborted && run === generation.current) setError(e as Error);
    } finally {
      if (!signal?.aborted && run === generation.current) setBusy(false);
    }
  }
  async function dismiss(movie: Row, remove = false) {
    const signal = lifetime.current?.signal;
    setSaving(true);
    setError(null);
    try {
      await api("/me/recommendation-feedback/" + movie.id, {
        method: remove ? "DELETE" : "PUT",
        body: remove ? undefined : { kind: "NOT_INTERESTED" },
        signal,
      });
      if (signal?.aborted) return;
      if (remove) {
        setUndo(null);
        await load(signal);
      } else {
        setUndo({ id: movie.id, name: movie.localizedTitle });
        setFeed((old) =>
          old
            ? { ...old, data: old.data.filter((m) => m.id !== movie.id) }
            : old,
        );
      }
    } catch (e) {
      if (!signal?.aborted) setError(e as Error);
    } finally {
      if (!signal?.aborted) setSaving(false);
    }
  }
  return (
    <div className="catalog-page for-you-page">
      <PageHeading
        eyebrow="KHÁM PHÁ THEO SỞ THÍCH"
        title="Dành cho bạn"
        text="Tìm phim gần với gu của bạn và khám phá thêm điều mới."
      />
      <section className="recommendation-settings" aria-label="Tùy chọn gợi ý">
        <div>
          <h2>Cá nhân hóa gợi ý</h2>
          <p>
            Chỉ khi bạn bật, chúng tôi dùng phim đã lưu và thời lượng xem hợp lệ
            trong tài khoản này. Tắt sẽ xóa phản hồi gợi ý và danh sách gợi ý đã
            tạo; thư viện và lịch sử xem vẫn được giữ.
          </p>
        </div>
        <div className="recommendation-controls">
          <label>
            <input
              type="checkbox"
              checked={!!pref?.enabled}
              disabled={!pref || busy || saving}
              onChange={(e) =>
                void save(e.target.checked, !!pref?.hideCompleted)
              }
            />{" "}
            Bật cá nhân hóa
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!pref?.hideCompleted}
              disabled={!pref?.enabled || busy || saving}
              onChange={(e) => void save(true, e.target.checked)}
            />{" "}
            Ẩn phim đã xem hết các tập hiện có
          </label>
          <button
            className="button ghost small"
            disabled={busy || saving}
            onClick={() => void load()}
          >
            Làm mới gợi ý
          </button>
        </div>
      </section>
      {saving && <p role="status">Đang lưu thay đổi…</p>}
      <ErrorBox error={error} onRetry={() => void load()} />
      {undo && (
        <div className="recommendation-undo" role="status">
          Đã ẩn “{undo.name}”.{" "}
          <button
            className="button ghost small"
            disabled={busy || saving}
            onClick={() => void dismiss({ id: undo.id }, true)}
          >
            Hoàn tác
          </button>
        </div>
      )}
      {feed && (
        <p className="muted" role="status">
          {feed.meta.personalized
            ? "Gợi ý theo nội dung phim bạn lưu hoặc đã xem."
            : "Khám phá phim mới xuất bản. Bật cá nhân hóa và lưu hoặc xem phim để có gợi ý phù hợp hơn."}
        </p>
      )}
      {feed && feed.data.length > 0 && (
        <div className="movie-grid recommendation-grid">
          {feed.data.map((movie) => (
            <article className="recommendation-card" key={movie.id}>
              <MovieCard movie={movie} />
              <p className="recommendation-reason">
                {movie.recommendation.text}
              </p>
              {pref?.enabled && (
                <button
                  className="button ghost small"
                  disabled={busy || saving}
                  aria-label={"Không quan tâm: " + movie.localizedTitle}
                  onClick={() => void dismiss(movie)}
                >
                  Không quan tâm
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {busy && <Spinner label="Đang tìm phim cho bạn…" />}
      {!busy && feed && !feed.data.length && (
        <Empty
          title="Chưa có phim phù hợp"
          text="Hãy khám phá kho phim hoặc làm mới sau khi cập nhật thư viện."
          action={
            <Link className="button" to="/">
              Khám phá phim
            </Link>
          }
        />
      )}
      {feed?.page.hasMore && (
        <div className="load-more">
          <button
            className="button secondary"
            disabled={busy || saving}
            onClick={() => void more()}
          >
            Xem thêm gợi ý
          </button>
        </div>
      )}
    </div>
  );
}
