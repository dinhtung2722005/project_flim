import type { Row } from "../lib/api";

function external(value: unknown) {
  if (typeof value !== "string") return null;
  return /^https:\/\/www\.imdb\.com\/title\/tt\d{7,10}\/$/.test(value) ||
    /^https:\/\/www\.themoviedb\.org\/(?:review\/[a-f0-9]{24}|(?:movie|tv)\/[1-9]\d*)$/.test(
      value,
    )
    ? value
    : null;
}
const states: Record<string, string> = {
  READY: "Đã có dữ liệu",
  NOT_CONFIGURED: "Chưa cấu hình nguồn",
  UNAVAILABLE: "Nguồn tạm không khả dụng",
  NOT_FOUND: "Chưa tìm thấy điểm",
  DISABLED: "Nguồn đang tắt",
  UNMAPPED: "Chưa liên kết phim với TMDB",
  NOT_FETCHED: "Chưa đồng bộ review",
  STALE: "Dữ liệu đã hết hạn",
};
function SourceLink({
  url,
  children,
}: {
  url: unknown;
  children: React.ReactNode;
}) {
  const href = external(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  ) : (
    <span>{children}</span>
  );
}
function time(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return "Chưa có";
  return new Date(value).toLocaleString("vi-VN");
}
export function AssistantFeedback({ items }: { items: Row[] }) {
  return (
    <div className="assistant-feedback-list">
      {items.map((f) => (
        <section
          className="assistant-feedback panel"
          key={f.titleId}
          aria-label={"Điểm và review: " + f.titleName}
        >
          <h3>{f.titleName} · Điểm và review</h3>
          <dl className="assistant-scores">
            <div>
              <dt>
                <SourceLink url={f.ratings.imdb.url}>
                  IMDb · Khán giả
                </SourceLink>
              </dt>
              <dd>
                {f.ratings.imdb.score == null
                  ? "Chưa có điểm"
                  : f.ratings.imdb.score + "/10"}
              </dd>
            </div>
            <div>
              <dt>Metacritic · Giới phê bình</dt>
              <dd>
                {f.ratings.metacritic.score == null
                  ? "Chưa có điểm"
                  : f.ratings.metacritic.score + "/100"}
              </dd>
            </div>
          </dl>
          <p className="muted">
            Nguồn điểm: OMDb · {states[f.ratings.status] ?? "Chưa có dữ liệu"} ·
            Cập nhật: {time(f.ratings.fetchedAt)}
          </p>
          <h4>
            <SourceLink url={f.reviews.sourceUrl}>
              Review người dùng TMDB
            </SourceLink>
          </h4>
          <p className="muted">
            {states[f.reviews.status] ?? "Chưa có dữ liệu"} · Cập nhật:{" "}
            {time(f.reviews.refreshedAt)}
          </p>
          {f.reviews.items.length === 0 && (
            <p>Chưa có review khả dụng cho phim này.</p>
          )}
          {f.reviews.textHidden && f.reviews.items.length > 0 && (
            <p>
              Nội dung review đang ẩn. Bỏ chọn “Tránh tiết lộ nội dung phim” rồi
              hỏi lại để đọc đoạn trích.
            </p>
          )}
          {f.reviews.items.map((r: Row) => (
            <article className="assistant-review" key={r.id}>
              <strong>
                <SourceLink url={r.sourceUrl}>{r.author}</SourceLink>
              </strong>
              <span>
                {" "}
                · {r.rating == null ? "Không chấm điểm" : r.rating + "/10"}
              </span>
              {typeof r.excerpt === "string" && (
                <blockquote>
                  {r.excerpt}
                  {r.truncated ? "…" : ""}
                </blockquote>
              )}
            </article>
          ))}
          {f.reviews.hasMore && (
            <p>Hiển thị tối đa 3 review. Mở trang chi tiết phim để xem thêm.</p>
          )}
          <small className="muted">
            {f.reviews.attribution} Đây là ý kiến người dùng TMDB, không phải
            bài review IMDb/Metacritic. Nội dung không được AI tóm tắt.
          </small>
        </section>
      ))}
    </div>
  );
}
