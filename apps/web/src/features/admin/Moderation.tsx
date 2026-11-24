import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth, useNotice, usePages } from "../../lib/state";
import { api, ApiError, dateLabel, query, type Row } from "../../lib/api";
import {
  ErrorBox,
  PageHeading,
  Spinner,
  Empty,
  Field,
  asError,
} from "../../components/ui";
export function AdminModeration() {
  const auth = useAuth(),
    [status, setStatus] = useState(""),
    [titleId, setTitleId] = useState(""),
    [titleName, setTitleName] = useState("");
  const data = usePages(
    "/admin/viewer-reviews?" + query({ status, titleId, limit: 20 }),
  );
  return (
    <>
      <PageHeading
        eyebrow="CỘNG ĐỒNG"
        title="Kiểm duyệt đánh giá"
        text="Xem xét phản hồi, ẩn nội dung vi phạm và khôi phục khi phù hợp. Người viết có thể xem lý do trong phần đánh giá của mình."
      />
      <div className="admin-toolbar">
        <label>
          Trạng thái{" "}
          <select
            aria-label="Trạng thái kiểm duyệt"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Tất cả</option>
            <option value="VISIBLE">Đang hiển thị</option>
            <option value="HIDDEN">Đã ẩn</option>
          </select>
        </label>
        <button
          className="button secondary small"
          disabled={data.loading}
          onClick={data.reload}
        >
          Làm mới
        </button>
        {titleId && (
          <button
            className="button ghost small"
            onClick={() => {
              setTitleId("");
              setTitleName("");
            }}
          >
            Bỏ lọc: {titleName}
          </button>
        )}
      </div>
      <ErrorBox error={data.error} onRetry={data.reload} />
      <div className="moderation-list">
        {data.rows.map((row) => (
          <ModerationCard
            key={row.id + ":" + row.version + ":" + auth.user?.id}
            initial={row}
            onSaved={data.reload}
            onTitle={() => {
              setTitleId(row.titleId);
              setTitleName(row.title);
            }}
          />
        ))}
      </div>
      {data.loading && <Spinner />}
      {!data.loading && !data.error && !data.rows.length && (
        <Empty
          title="Chưa có đánh giá phù hợp"
          text="Đổi bộ lọc hoặc quay lại khi có đánh giá mới."
        />
      )}
      {data.cursor && (
        <button
          className="button secondary"
          disabled={data.loading}
          onClick={() => void data.more()}
        >
          Xem thêm đánh giá
        </button>
      )}
    </>
  );
}
function ModerationCard({
  initial,
  onSaved,
  onTitle,
}: {
  initial: Row;
  onSaved: () => void;
  onTitle: () => void;
}) {
  const [row, setRow] = useState(initial),
    [decision, setDecision] = useState(
      initial.moderationStatus === "HIDDEN" ? "VISIBLE" : "HIDDEN",
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    notice = useNotice();
  const conflict =
    error instanceof ApiError && error.code === "RESOURCE_VERSION_MISMATCH";
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/viewer-reviews/" + row.id + "/moderation", {
        method: "PATCH",
        headers: {
          "If-Match": '"review-moderation:' + row.id + ":" + row.version + '"',
        },
        body: { status: decision, reason },
      });
      notice(
        decision === "HIDDEN" ? "Đã ẩn đánh giá." : "Đã khôi phục đánh giá.",
      );
      onSaved();
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      setRow((await api("/admin/viewer-reviews/" + row.id)).data);
      setError(null);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="panel moderation-card"
      aria-label={"Đánh giá của " + row.author}
    >
      <div className="section-heading">
        <div>
          <h2>{row.title}</h2>
          <p className="muted">
            {row.author} · {row.rating}/10 · {dateLabel(row.createdAt)}
            {row.authorStatus !== "ACTIVE"
              ? " · Tài khoản không hoạt động"
              : ""}
          </p>
        </div>
        <span
          className={
            "badge " + (row.moderationStatus === "HIDDEN" ? "warn" : "good")
          }
        >
          {row.moderationStatus === "HIDDEN" ? "Đã ẩn" : "Đang hiển thị"}
        </span>
      </div>
      {row.content ? (
        row.containsSpoilers ? (
          <details>
            <summary>Đọc đánh giá có tiết lộ nội dung</summary>
            <p className="moderation-content">{row.content}</p>
          </details>
        ) : (
          <p className="moderation-content">{row.content}</p>
        )
      ) : (
        <p className="muted">Chỉ chấm điểm, không có nhận xét.</p>
      )}
      {row.moderationReason && (
        <p className="moderation-reason">
          <strong>Lý do gần nhất:</strong> {row.moderationReason}
        </p>
      )}
      <div className="button-row">
        <button className="button ghost small" onClick={onTitle}>
          Chỉ xem phim này
        </button>
        <Link className="button ghost small" to={"/titles/" + row.titleId}>
          Mở trang phim
        </Link>
      </div>
      <form onSubmit={save}>
        <ErrorBox error={error} />
        {conflict && (
          <p role="status">
            Đánh giá đã thay đổi. Bản nháp lý do được giữ lại; hãy đọc bản mới
            trước khi quyết định.
          </p>
        )}
        {conflict && (
          <button
            type="button"
            className="button secondary small"
            disabled={busy}
            onClick={() => void reload()}
          >
            Đọc bản mới, giữ lý do
          </button>
        )}
        <fieldset disabled={busy}>
          <Field label="Quyết định kiểm duyệt">
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="HIDDEN">Ẩn đánh giá</option>
              <option value="VISIBLE">Khôi phục hiển thị</option>
            </select>
          </Field>
          <Field
            label="Lý do xử lý"
            hint="Người viết sẽ thấy lý do này. Không nhập thông tin riêng tư."
          >
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              maxLength={500}
              required
              rows={2}
            />
          </Field>
          <button
            className="button small"
            disabled={conflict || decision === row.moderationStatus}
          >
            {busy ? "Đang xử lý…" : "Lưu kiểm duyệt"}
          </button>
        </fieldset>
      </form>
    </article>
  );
}
