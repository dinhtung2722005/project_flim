import { useState } from "react";
import { Link } from "react-router-dom";
import { Flag, RefreshCw, ShieldCheck } from "lucide-react";
import { dateLabel, query, statusLabel } from "../../lib/api";
import { useAuth, usePages } from "../../lib/state";
import { Empty, ErrorBox, PageHeading, Spinner } from "../../components/ui";
import { ResourceMore } from "./resource-ui";

const categories: Record<string, string> = {
  PLAYBACK: "Không phát được",
  SUBTITLE: "Phụ đề",
  METADATA: "Thông tin phim",
  OTHER: "Khác",
};
const states = {
  OPEN: "Mới tiếp nhận",
  IN_REVIEW: "Đang xem xét",
  RESOLVED: "Đã giải quyết",
  DISMISSED: "Đã đóng",
};
export function AdminReports() {
  const auth = useAuth(),
    [status, setStatus] = useState("");
  const data = usePages("/admin/reports?" + query({ status, limit: 20 }));
  return (
    <>
      <PageHeading
        eyebrow="PHẢN HỒI TỪ NGƯỜI XEM"
        title="Báo lỗi nội dung"
        text="Theo dõi phản hồi về phát video, phụ đề và thông tin phim."
        action={
          <button
            className="button secondary"
            disabled={data.loading}
            onClick={data.reload}
          >
            <RefreshCw size={17} />
            Làm mới
          </button>
        }
      />
      <div className="admin-toolbar report-toolbar">
        <label className="report-filter">
          Trạng thái
          <select
            aria-label="Trạng thái báo lỗi"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(states).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">Đã tải {data.rows.length} phản hồi</span>
      </div>
      <ErrorBox error={data.error} onRetry={data.reload} />
      <div className="report-list">
        {data.rows.map((row) => (
          <article className="panel report-card" key={row.id}>
            <div className="report-card-heading">
              <span className="report-icon">
                <Flag size={19} />
              </span>
              <div>
                <h2>{categories[row.category] || row.category}</h2>
                <small className="muted">{dateLabel(row.createdAt)}</small>
              </div>
              <span
                className={"badge " + (row.status === "RESOLVED" ? "good" : "")}
              >
                {states[row.status as keyof typeof states] ||
                  statusLabel[row.status] ||
                  row.status}
              </span>
            </div>
            {row.message !== undefined ? (
              <p className="report-message">{row.message}</p>
            ) : (
              <p className="report-redacted">
                <ShieldCheck size={16} />
                Nội dung chi tiết được ẩn theo quyền tài khoản.
              </p>
            )}
            <div className="report-references">
              <span>
                Mã phim <code>{row.titleId}</code>
              </span>
              {row.episodeId && (
                <span>
                  Mã tập <code>{row.episodeId}</code>
                </span>
              )}
            </div>
            {row.resolutionNote && (
              <p className="report-resolution">
                <strong>Ghi chú:</strong> {row.resolutionNote}
              </p>
            )}
            {auth.can("catalog.read_drafts") && (
              <Link
                className="button secondary small"
                to={"/admin/titles/" + row.titleId}
              >
                Mở phim để kiểm tra
              </Link>
            )}
          </article>
        ))}
      </div>
      {data.loading && <Spinner />}
      {!data.loading && !data.error && !data.rows.length && (
        <Empty
          title="Không có báo lỗi"
          text={
            status
              ? "Chưa có phản hồi thuộc trạng thái đang chọn."
              : "Phản hồi của người xem sẽ xuất hiện tại đây."
          }
        />
      )}
      {data.cursor && (
        <ResourceMore
          loading={data.loading}
          more={data.more}
          count={data.rows.length}
        />
      )}
    </>
  );
}
