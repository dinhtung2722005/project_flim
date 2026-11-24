import { useEffect, useState } from "react";
import { api, type Row } from "../lib/api";
import { useAuth, useData } from "../lib/state";
import { ErrorBox, Spinner, asError } from "./ui";
const labels: Record<string, string> = {
  DISABLED: "Nguồn review đang tắt.",
  NOT_CONFIGURED: "Chưa cấu hình nguồn review.",
  UNMAPPED: "Chưa liên kết phim với nguồn review.",
  NOT_FETCHED: "Chưa tải bài review.",
  STALE: "Review đã hết hạn cập nhật.",
  READY: "",
};
function safeReviewLink(value: unknown) {
  return typeof value === "string" &&
    /^https:\/\/www\.themoviedb\.org\/(?:review\/[a-f0-9]{24}|(?:movie|tv)\/[1-9][0-9]*)$/.test(
      value,
    )
    ? value
    : undefined;
}
export function Reviews({
  titleId,
  admin = false,
  revision = 0,
}: {
  titleId: string;
  admin?: boolean;
  revision?: number;
}) {
  const [page, setPage] = useState(0),
    [cursors, setCursors] = useState<string[]>([]);
  useEffect(() => {
    setPage(0);
    setCursors([]);
  }, [titleId, revision]);
  const data = useData<Row>(
    (admin ? "/admin" : "") +
      "/titles/" +
      titleId +
      "/reviews?limit=5" +
      (page && cursors[page - 1]
        ? "&cursor=" + encodeURIComponent(cursors[page - 1])
        : ""),
  );
  return (
    <section
      id="reviews"
      className="content-section review-section"
      aria-label="Review từ TMDB"
    >
      <h2>Review từ khán giả TMDB</h2>
      <p className="muted">
        Nguồn:{" "}
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          TMDB
        </a>
        . Điểm riêng của từng tác giả, thang 10; bài viết có thể tiết lộ nội
        dung phim.
      </p>
      {data.loading ? (
        <Spinner />
      ) : (
        <>
          <ErrorBox error={data.error} onRetry={data.reload} />
          {data.data && (
            <>
              <p role="status">
                {admin
                  ? labels[data.data.meta?.status] || ""
                  : data.data.meta?.status !== "READY"
                    ? "Chưa có review mới để hiển thị."
                    : ""}
              </p>
              {data.data.meta?.status === "READY" &&
                !data.data.data?.length && (
                  <p>Chưa có bài review cho phim này trên nguồn đã chọn.</p>
                )}
              {data.data.data?.map((review: Row) => (
                <article className="panel review-card" key={review.id}>
                  <h3>
                    {review.author}
                    {review.rating !== null && (
                      <span> · {review.rating}/10</span>
                    )}
                  </h3>
                  <p className="muted">
                    {review.language === "en-US" ? "Tiếng Anh" : "Tiếng Việt"}
                    {review.sourceUpdatedAt
                      ? " · " +
                        new Date(review.sourceUpdatedAt).toLocaleDateString(
                          "vi-VN",
                        )
                      : ""}
                  </p>
                  <details>
                    <summary>Đọc bài review</summary>
                    <p className="review-content">{review.content}</p>
                  </details>
                  {safeReviewLink(review.sourceUrl) && (
                    <a
                      className="text-link"
                      href={review.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở bài gốc trên TMDB ↗
                    </a>
                  )}
                </article>
              ))}
              <div className="button-row">
                {page > 0 && (
                  <button
                    className="button secondary small"
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Trang trước
                  </button>
                )}
                {data.data.page?.nextCursor && (
                  <button
                    className="button secondary small"
                    onClick={() => {
                      setCursors((c) => [
                        ...c.slice(0, page),
                        data.data!.page.nextCursor,
                      ]);
                      setPage((p) => p + 1);
                    }}
                  >
                    Trang sau
                  </button>
                )}
              </div>
              {data.data.meta?.refreshedAt && (
                <p className="muted">
                  Cập nhật:{" "}
                  {new Date(data.data.meta.refreshedAt).toLocaleString("vi-VN")}
                </p>
              )}
            </>
          )}
        </>
      )}
      <a
        className="review-credit"
        href="https://www.themoviedb.org"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg"
          alt="TMDB"
          width="90"
          height="65"
          loading="lazy"
        />
      </a>
      <small className="muted">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </small>
    </section>
  );
}
export function AdminReviews({ titleId }: { titleId: string }) {
  const auth = useAuth(),
    [source, setSource] = useState<Row | null>(null),
    [etag, setEtag] = useState(""),
    [externalId, setExternalId] = useState(""),
    [candidates, setCandidates] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const path = "/admin/titles/" + titleId;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    api(path + "/review-source", { signal: controller.signal })
      .then((r) => {
        if (active) {
          setSource(r.data);
          setEtag(r.etag);
          setExternalId(r.data.externalId ? String(r.data.externalId) : "");
        }
      })
      .catch((e) => {
        if (active) setError(asError(e));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path]);
  async function readSource() {
    const r = await api(path + "/review-source");
    setSource(r.data);
    setEtag(r.etag);
    setExternalId(r.data.externalId ? String(r.data.externalId) : "");
  }
  async function reloadSource() {
    setError(null);
    try {
      await readSource();
    } catch (e) {
      setError(asError(e));
    }
  }
  async function action(kind: "search" | "map" | "sync" | "remove") {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      if (kind === "search") {
        const r = await api(path + "/review-candidates");
        setCandidates(r.data.data);
        if (!r.data.data.length)
          setNotice("Không tìm được phim phù hợp trên TMDB.");
      }
      if (kind === "map") {
        const id = Number(externalId);
        if (!Number.isInteger(id) || id < 1 || id > 2147483647)
          throw Error("Nhập TMDB ID hợp lệ.");
        await api(path + "/review-source", {
          method: "PUT",
          headers: { "If-Match": etag },
          body: { externalId: id },
        });
        await readSource();
        setRevision((v) => v + 1);
        setCandidates([]);
        setNotice(
          "Đã kiểm tra tên, năm và loại phim. Bấm Tải review để lấy bài viết.",
        );
      }
      if (kind === "sync") {
        const r = await api(path + "/review-sync", {
          method: "POST",
          body: {},
        });
        await readSource();
        setRevision((v) => v + 1);
        setNotice("Đã cập nhật " + r.data.sync.count + " bài review.");
      }
      if (kind === "remove") {
        await api(path + "/review-source", {
          method: "DELETE",
          headers: { "If-Match": etag },
        });
        await readSource();
        setRevision((v) => v + 1);
        setNotice("Đã xóa liên kết và các bài review đã lưu.");
      }
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel content-section" aria-label="Quản lý review">
      <h2>Review từ TMDB</h2>
      <ErrorBox error={error} onRetry={() => void reloadSource()} />
      {!source && !error && <Spinner />}
      {source && (
        <>
          <p>{labels[source.status] || "Nguồn review đã sẵn sàng."}</p>
          {source.lastError && (
            <p role="status">
              Lần cập nhật trước chưa thành công. Thử lại sau hoặc kiểm tra cấu
              hình nguồn.
            </p>
          )}
          {auth.can("catalog.write") && (
            <fieldset disabled={busy}>
              <div className="button-row">
                <button
                  className="button secondary small"
                  disabled={!source.configured || !source.enabled}
                  onClick={() => void action("search")}
                >
                  Tìm phim trên TMDB
                </button>
                <button
                  className="button ghost small"
                  onClick={() => void reloadSource()}
                >
                  Đọc lại liên kết
                </button>
              </div>
              {candidates.length > 0 && (
                <ul>
                  {candidates.map((c) => (
                    <li key={c.externalId}>
                      <button
                        className="text-link"
                        onClick={() => setExternalId(String(c.externalId))}
                      >
                        {c.name} ({c.releaseDate?.slice(0, 4) || "Chưa rõ năm"})
                        · ID {c.externalId}
                      </button>{" "}
                      ·{" "}
                      <a
                        href={safeReviewLink(c.sourceUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Đối chiếu nguồn ↗
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <label>
                TMDB ID
                <input
                  aria-label="TMDB ID"
                  type="number"
                  min={1}
                  max={2147483647}
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
              </label>
              <p className="muted">
                Chọn đúng phim, năm và loại. Đổi liên kết sẽ xóa review cũ. Phim
                thiếu năm hoặc tên không khớp sẽ bị từ chối.
              </p>
              <div className="button-row">
                <button
                  className="button secondary small"
                  disabled={
                    !source.configured || !source.enabled || !externalId
                  }
                  onClick={() => void action("map")}
                >
                  Kiểm tra và lưu liên kết
                </button>
                <button
                  className="button small"
                  disabled={
                    !source.configured || !source.enabled || !source.externalId
                  }
                  onClick={() => void action("sync")}
                >
                  Tải review
                </button>
                {source.externalId && (
                  <button
                    className="button ghost small"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Xóa liên kết và toàn bộ review đã lưu của phim này?",
                        )
                      )
                        void action("remove");
                    }}
                  >
                    Xóa liên kết
                  </button>
                )}
              </div>
            </fieldset>
          )}
          <p role="status">{busy ? "Đang xử lý…" : notice}</p>
          <Reviews key={revision} titleId={titleId} admin revision={revision} />
        </>
      )}
    </section>
  );
}
