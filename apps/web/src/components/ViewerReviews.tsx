import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, ApiError, type Row } from "../lib/api";
import { useAuth } from "../lib/state";
import { ErrorBox, Spinner, asError } from "./ui";
import "../viewer-reviews.css";

export function ViewerReviews({ titleId }: { titleId: string }) {
  const { user, loading } = useAuth();
  return (
    <ViewerReviewsContent
      key={titleId + ":" + (user?.id ?? "guest")}
      titleId={titleId}
      user={user}
      authLoading={loading}
    />
  );
}
function ViewerReviewsContent({
  titleId,
  user,
  authLoading,
}: {
  titleId: string;
  user: Row | null;
  authLoading: boolean;
}) {
  const location = useLocation(),
    path = "/me/title-reviews/" + titleId;
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(0),
    [cursors, setCursors] = useState<string[]>([]);
  const [own, setOwn] = useState<Row | null>(null),
    [etag, setEtag] = useState(""),
    [ownLoading, setOwnLoading] = useState(!!user),
    [ownError, setOwnError] = useState<Error | null>(null),
    [rating, setRating] = useState(0),
    [content, setContent] = useState(""),
    [spoilers, setSpoilers] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  async function readOwn(controller: AbortController) {
    setOwnLoading(true);
    setOwnError(null);
    setNotice("");
    try {
      const r = await api(path, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const row = r.data.review;
      setOwn(row);
      setEtag(r.etag);
      setRating(row?.rating ?? 0);
      setContent(row?.content ?? "");
      setSpoilers(row?.containsSpoilers ?? false);
    } catch (e) {
      if (!controller.signal.aborted) setOwnError(asError(e));
    } finally {
      if (!controller.signal.aborted) setOwnLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (user) void readOwn(controller);
    return () => {
      controller.abort();
      lifetime.current = null;
    };
  }, [titleId, user?.id]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const cursor = page ? cursors[page - 1] : null;
    api(
      "/titles/" +
        titleId +
        "/viewer-reviews?limit=5" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      { auth: false, signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(asError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [titleId, page, revision]);
  function refresh() {
    setPage(0);
    setCursors([]);
    setRevision((v) => v + 1);
  }
  async function mutate(remove = false) {
    const controller = lifetime.current;
    if (!controller || busy || !etag) return;
    setBusy(true);
    setOwnError(null);
    setNotice("");
    try {
      const r = await api(path, {
        method: remove ? "DELETE" : "PUT",
        headers: { "If-Match": etag },
        ...(!remove
          ? { body: { rating, content, containsSpoilers: spoilers } }
          : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setEtag(r.etag);
      if (remove) {
        setOwn(null);
        setContent("");
        setRating(0);
        setSpoilers(false);
        setNotice("Đã xóa đánh giá của bạn.");
      } else {
        setOwn(r.data.review);
        setContent(r.data.review.content);
        setNotice("Đã lưu đánh giá của bạn.");
      }
      refresh();
    } catch (e) {
      if (!controller.signal.aborted) setOwnError(asError(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void mutate();
  }
  const conflict =
    ownError instanceof ApiError &&
    ownError.code === "RESOURCE_VERSION_MISMATCH";
  return (
    <section
      id="viewer-reviews"
      className="content-section viewer-reviews"
      aria-label="Đánh giá người xem pj-Flim"
    >
      <div className="section-heading">
        <div>
          <h2>Đánh giá của người xem</h2>
          <p className="muted">
            Cộng đồng pj-Flim · Mỗi tài khoản một đánh giá cho mỗi phim.
          </p>
        </div>
        {data && (
          <div className="viewer-score" aria-label="Điểm trung bình cộng đồng">
            <strong>
              {data.summary.average == null
                ? "—"
                : data.summary.average.toLocaleString("vi-VN", {
                    maximumFractionDigits: 1,
                  })}
              <small>/10</small>
            </strong>
            <span>{data.summary.count} đánh giá</span>
          </div>
        )}
      </div>
      {authLoading ? (
        <Spinner label="Đang kiểm tra tài khoản…" />
      ) : !user ? (
        <p className="panel">
          <Link
            to={
              "/login?next=" +
              encodeURIComponent(location.pathname + "#viewer-reviews")
            }
          >
            Đăng nhập
          </Link>{" "}
          để chấm điểm và viết nhận xét.
        </p>
      ) : (
        <form
          className="panel viewer-review-form"
          onSubmit={submit}
          aria-label="Đánh giá của bạn"
        >
          <h3>
            {own ? "Chỉnh sửa đánh giá của bạn" : "Bạn thấy phim này thế nào?"}
          </h3>
          {ownLoading && <Spinner label="Đang đọc đánh giá của bạn…" />}
            {own?.moderationStatus==="HIDDEN"&&<p className="review-moderation-notice" role="status">Đánh giá của bạn đang được ẩn. Lý do: {own.moderationReason}. Bạn vẫn có thể chỉnh sửa hoặc xóa; việc chỉnh sửa không tự khôi phục hiển thị.</p>}
          <ErrorBox error={ownError} />
          {conflict && (
            <p role="status">
              Đánh giá đã thay đổi ở phiên khác. Bản nháp của bạn vẫn được giữ.
            </p>
          )}
          {ownError && !busy && (
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                const c = lifetime.current;
                if (c) void readOwn(c);
              }}
            >
              Tải lại đánh giá (thay bản nháp)
            </button>
          )}
          <fieldset disabled={busy || ownLoading || !etag}>
            <div>
              <label htmlFor="viewer-review-score">Điểm của bạn</label>
              <select
                id="viewer-review-score"
                required
                value={rating || ""}
                onChange={(e) => setRating(Number(e.target.value))}
              >
                <option value="" disabled>
                  Chọn điểm
                </option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}/10
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="viewer-review-content">
                Nhận xét của bạn (không bắt buộc)
              </label>
              <textarea
                id="viewer-review-content"
                rows={4}
                maxLength={2000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Chia sẻ cảm nhận về phim…"
              />
            </div>
            <small className="muted">{content.length}/2000 ký tự</small>
            <label className="viewer-spoiler">
              <input
                type="checkbox"
                checked={spoilers}
                onChange={(e) => setSpoilers(e.target.checked)}
              />{" "}
              Nhận xét có tiết lộ nội dung phim
            </label>
            <div className="button-row">
              <button type="submit" className="button small">
                {busy ? "Đang lưu…" : own ? "Lưu đánh giá" : "Gửi đánh giá"}
              </button>
              {own && (
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => void mutate(true)}
                >
                  Xóa đánh giá của tôi
                </button>
              )}
            </div>
          </fieldset>
          {notice && <p role="status">{notice}</p>}
        </form>
      )}
      {loading && <Spinner label="Đang tải đánh giá…" />}
      <ErrorBox error={error} onRetry={refresh} />
      {!loading && data?.data.length === 0 && (
        <p className="muted">
          Chưa có đánh giá nào. Hãy là người đầu tiên chia sẻ cảm nhận.
        </p>
      )}
      {!error &&
        data?.data.map((r: Row) => (
          <article className="panel viewer-review-card" key={r.id}>
            <div className="viewer-review-heading">
              <h3>{r.author || "Người xem"}</h3>
              <strong>{r.rating}/10</strong>
            </div>
            <small className="muted">
              {new Date(r.updatedAt).toLocaleDateString("vi-VN")}
            </small>
            {r.content &&
              (r.containsSpoilers ? (
                <details>
                  <summary>Đọc nhận xét có tiết lộ nội dung</summary>
                  <p className="viewer-review-content">{r.content}</p>
                </details>
              ) : (
                <p className="viewer-review-content">{r.content}</p>
              ))}
          </article>
        ))}
      <div className="button-row">
        {page > 0 && (
          <button
            type="button"
            className="button ghost small"
            disabled={loading}
            onClick={() => setPage((p) => p - 1)}
          >
            Đánh giá trước
          </button>
        )}
        {data?.page.nextCursor && (
          <button
            type="button"
            className="button secondary small"
            disabled={loading}
            onClick={() => {
              setCursors((old) => [
                ...old.slice(0, page),
                data.page.nextCursor,
              ]);
              setPage((p) => p + 1);
            }}
          >
            Đánh giá tiếp
          </button>
        )}
      </div>
    </section>
  );
}
