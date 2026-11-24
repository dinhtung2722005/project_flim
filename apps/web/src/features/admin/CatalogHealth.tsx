import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { CatalogIssue } from "../../../../../packages/contracts/src/admin";
import { usePages } from "../../lib/state";
import { query } from "../../lib/api";
import { countLabel } from "../../lib/counts";
import { PageHeading, ErrorBox, Spinner, Empty } from "../../components/ui";
const labels: Record<CatalogIssue, string> = {
  NO_POSTER: "Thiếu ảnh bìa",
  NO_SYNOPSIS: "Thiếu tóm tắt",
  NO_GENRES: "Chưa gắn thể loại",
  NO_YEAR: "Thiếu năm phát hành",
  NO_LANGUAGE: "Thiếu ngôn ngữ",
  NO_CREDITS: "Thiếu diễn viên/đạo diễn",
  NO_PLAYABLE_EPISODE: "Chưa có tập phát được",
  PUBLISHED_WITHOUT_PLAYABLE: "Đã xuất bản nhưng không phát được",
};
export function AdminCatalogHealth() {
  const [term, setTerm] = useState(""),
    [search, setSearch] = useState(""),
    [issue, setIssue] = useState("");
  const data = usePages(
    "/admin/catalog-health?" + query({ q: search, issue, limit: 20 }),
  );

  return (
    <>
      <PageHeading
        eyebrow="KIỂM TRA KHO PHIM"
        title="Chất lượng nội dung"
        text="Phát hiện thông tin còn thiếu và phim chưa có video sẵn sàng. Trang này chỉ kiểm tra, không tự xuất bản hoặc sửa phim."
      />
      <div className="admin-toolbar">
        <form
          className="toolbar-search"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSearch(term);
          }}
        >
          <input
            aria-label="Tìm phim cần kiểm tra"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Tên phim…"
          />
          <button className="button small">Tìm</button>
        </form>
        <label>
          Vấn đề{" "}
          <select
            aria-label="Vấn đề nội dung"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
          >
            <option value="">Tất cả</option>
            {Object.entries(labels).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary small"
          disabled={data.loading}
          onClick={data.reload}
        >
          Kiểm tra lại
        </button>
      </div>
      {data.summary && (
        <div className="stat-grid">
          {[
            ["titles", "Phim trong bộ lọc"],
            ["needsAttention", "Phim cần bổ sung"],
            ["withoutPlayableVideo", "Chưa có video phát được"],
          ].map(([key, label]) => (
            <article className="stat-card" key={key}>
              <p>{label}</p>
              <strong>{countLabel(data.summary?.[key])}</strong>
            </article>
          ))}
        </div>
      )}
      <p className="muted">
        Các cảnh báo thông tin giúp hoàn thiện trang phim. Điều kiện video vẫn
        được kiểm tra lại khi bạn xuất bản.
      </p>
      <ErrorBox error={data.error} onRetry={data.reload} />
      <section className="panel table-panel">
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Kết quả kiểm tra kho phim"
        >
          <table>
            <thead>
              <tr>
                <th>Phim</th>
                <th>Video</th>
                <th>Cần bổ sung</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.localizedTitle}</strong>
                    <br />
                    <small className="muted">{row.publicationStatus}</small>
                  </td>
                  <td>{row.videoReady ? "Sẵn sàng" : "Chưa sẵn sàng"}</td>
                  <td>
                    <div className="health-issues">
                      {row.issues.length ? (
                        row.issues.map((code: CatalogIssue) => (
                          <span
                            className={
                              "badge " +
                              (code === "PUBLISHED_WITHOUT_PLAYABLE"
                                ? "health-blocking"
                                : "")
                            }
                            key={code}
                          >
                            {labels[code]}
                          </span>
                        ))
                      ) : (
                        <span className="badge good">Đầy đủ</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <Link
                      className="button secondary small"
                      to={"/admin/titles/" + row.id}
                    >
                      Mở phim
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.loading && <Spinner />}
        {!data.loading && !data.error && !data.rows.length && (
          <Empty
            title="Không có phim phù hợp"
            text="Thử bộ lọc khác hoặc thêm nội dung vào kho phim."
          />
        )}
      </section>
      {data.cursor && (
        <button
          className="button secondary"
          disabled={data.loading}
          onClick={() => void data.more()}
        >
          Xem thêm phim
        </button>
      )}
    </>
  );
}
