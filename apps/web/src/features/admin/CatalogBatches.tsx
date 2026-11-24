import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, dateLabel, query, type Row } from "../../lib/api";
import { useAuth, useData, usePages } from "../../lib/state";
import {
  ErrorBox,
  Empty,
  Field,
  PageHeading,
  Spinner,
  asError,
} from "../../components/ui";
const actions: Record<string, string> = {
  PUBLISH: "Xuất bản phim",
  UNPUBLISH: "Ẩn phim",
  ADD_GENRES: "Gắn thêm thể loại",
  REPLACE_GENRES: "Thay toàn bộ thể loại",
};
const stateLabels: Record<string, string> = {
  READY: "Sẵn sàng",
  BLOCKED: "Không đủ điều kiện",
  UNCHANGED: "Không cần đổi",
  APPLIED: "Đã áp dụng",
  FAILED: "Chưa áp dụng",
};
const issueLabels: Record<string, string> = {
  RESOURCE_NOT_FOUND: "Phim hoặc thể loại không còn tồn tại",
  RESOURCE_VERSION_MISMATCH: "Phim đã thay đổi, cần xem trước lại",
  CATALOG_NO_PLAYABLE_EPISODE: "Chưa có tập đã xuất bản phát được",
  CATALOG_INVALID_PUBLICATION_TRANSITION:
    "Phim đã lưu trữ, không thể đổi xuất bản",
  MEDIA_NOT_READY: "Video chưa sẵn sàng",
  MEDIA_BACKUP_NOT_VERIFIED: "Backup video chưa được xác minh",
  VALIDATION_FAILED: "Dữ liệu không hợp lệ hoặc quá30 thể loại",
};
function errorValue(e: unknown) {
  return e instanceof ApiError && e.code === "RESOURCE_CONFLICT"
    ? new Error(
        "Đợt xử lý đã hết hạn hoặc không còn thực hiện được trong phiên đăng nhập này. Hãy tạo bản xem trước mới.",
      )
    : asError(e);
}
function BatchReceipt({ job, genres }: { job: Row; genres: Row[] }) {
  const genreNames = (ids: string[] = []) =>
    ids.map((id) => genres.find((g) => g.id === id)?.name ?? id).join(", ") ||
    "Chưa gắn thể loại";
  return (
    <div className="batch-receipt">
      <h3>
        {actions[job.action]} · {job.items.length} phim
      </h3>
      <p className="muted">Lý do: {job.reason}</p>
      <p role="status">
        {job.counts.ready} sẵn sàng · {job.counts.applied} đã áp dụng ·{" "}
        {job.counts.blocked} không đủ điều kiện · {job.counts.failed} chưa áp
        dụng · {job.counts.unchanged} không cần đổi
      </p>
      {!job.sameSession && job.state !== "COMPLETED" && (
        <p className="batch-warning">
          Đăng nhập đã thay đổi. Hãy tạo bản xem trước mới để thực hiện.
        </p>
      )}
      {job.expired && (
        <p className="batch-warning">
          Đợt này đã hết hạn. Tạo bản xem trước mới để tiếp tục.
        </p>
      )}
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Kết quả từng phim"
      >
        <table>
          <thead>
            <tr>
              <th>Phim</th>
              <th>Thay đổi</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {job.items.map((item: Row) => (
              <tr key={item.titleId}>
                <td>{item.title ?? "Phim không còn tồn tại"}</td>
                <td>
                  {item.targetStatus ? (
                    <>
                      {item.beforeStatus} → {item.targetStatus}
                    </>
                  ) : (
                    <>
                      {genreNames(item.beforeGenreIds)} →{" "}
                      {genreNames(item.targetGenreIds)}
                    </>
                  )}
                </td>
                <td>
                  <strong>{stateLabels[item.state] || item.state}</strong>
                  {item.code && (
                    <p>
                      {issueLabels[item.code] ??
                        "Chưa áp dụng. Hãy mở phim để kiểm tra."}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Tạo lúc {dateLabel(job.createdAt)} ·{" "}
        {job.state === "COMPLETED"
          ? "Đã xử lý xong"
          : "Hết hạn " + dateLabel(job.expiresAt)}
      </p>
      <Link className="text-link" to={"/admin/catalog-batches?batch=" + job.id}>
        Xem trong lịch sử xử lý
      </Link>
    </div>
  );
}
export function CatalogBatchTools({
  titles,
  onApplied,
}: {
  titles: Row[];
  onApplied: () => void;
}) {
  const auth = useAuth(),
    [action, setAction] = useState(
      auth.can("catalog.write") ? "ADD_GENRES" : "UNPUBLISH",
    ),
    [genreIds, setGenreIds] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [job, setJob] = useState<Row | null>(null),
    [tag, setTag] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const genres = usePages("/admin/genres?limit=100"),
    requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  function clear() {
    setJob(null);
    setTag("");
    setError(null);
  }
  async function preview(e: FormEvent) {
    e.preventDefault();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const r = await api("/admin/catalog-batches/previews", {
        method: "POST",
        body: {
          action,
          titleIds: titles.map((t) => t.id),
          reason,
          ...(["ADD_GENRES", "REPLACE_GENRES"].includes(action)
            ? { genreIds }
            : {}),
        },
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setJob(r.data);
        setTag(r.etag);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorValue(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function read() {
    if (!job) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const r = await api("/admin/catalog-batches/" + job.id, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setJob(r.data);
        setTag(r.etag);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorValue(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function execute() {
    if (!job) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const r = await api("/admin/catalog-batches/" + job.id + "/execution", {
        method: "POST",
        body: { confirm: true },
        headers: { "If-Match": tag },
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setJob(r.data);
        setTag(r.etag);
        onApplied();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorValue(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="panel catalog-batch-tools"
      aria-label="Xử lý phim hàng loạt"
    >
      <h2>Đã chọn {titles.length}/20 phim</h2>
      <form onSubmit={preview}>
        <fieldset disabled={busy}>
          <Field label="Thao tác hàng loạt">
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                clear();
              }}
            >
              {Object.entries(actions)
                .filter(([key]) =>
                  key === "PUBLISH" || key === "UNPUBLISH"
                    ? auth.can("catalog.publish")
                    : auth.can("catalog.write"),
                )
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>
          {["ADD_GENRES", "REPLACE_GENRES"].includes(action) && (
            <fieldset>
              <legend>Thể loại áp dụng</legend>
              <ErrorBox error={genres.error} onRetry={genres.reload} />
              {genres.loading && <Spinner />}
              <div className="batch-genre-options">
                {genres.rows.map((g) => (
                  <label key={g.id}>
                    <input
                      type="checkbox"
                      checked={genreIds.includes(g.id)}
                      disabled={
                        !genreIds.includes(g.id) && genreIds.length >= 30
                      }
                      onChange={(e) => {
                        setGenreIds((ids) =>
                          e.target.checked
                            ? [...ids, g.id]
                            : ids.filter((id) => id !== g.id),
                        );
                        clear();
                      }}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
              {genres.cursor && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => void genres.more()}
                >
                  Thêm thể loại
                </button>
              )}
              {action === "REPLACE_GENRES" && (
                <p className="batch-warning">
                  Thể loại hiện tại của các phim sẽ được thay bằng danh sách bạn
                  chọn.
                </p>
              )}
            </fieldset>
          )}
          <Field label="Lý do thay đổi hàng loạt">
            <textarea
              minLength={3}
              maxLength={500}
              required
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                clear();
              }}
            />
          </Field>
          <button
            className="button secondary"
            disabled={
              ["ADD_GENRES", "REPLACE_GENRES"].includes(action) &&
              !genreIds.length
            }
          >
            Xem trước thay đổi
          </button>
        </fieldset>
      </form>
      <ErrorBox error={error} />
      {busy && <Spinner />}
      {job && (
        <>
          <BatchReceipt job={job} genres={genres.rows} />
          <div className="button-row">
            {job.state !== "COMPLETED" &&
              !job.expired &&
              job.sameSession &&
              job.counts.ready > 0 && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void execute()}
                >
                  {job.state === "RUNNING"
                    ? "Tiếp tục đợt xử lý"
                    : "Xác nhận thực hiện"}
                </button>
              )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void read()}
            >
              Đọc kết quả hiện tại
            </button>
          </div>
          <p className="muted">
            Đợt đã xác nhận được lưu trong lịch sử. Mỗi phim được kiểm tra lại
            trước khi thay đổi.
          </p>
        </>
      )}
    </section>
  );
}
export function AdminCatalogBatches() {
  const auth = useAuth(),
    [state, setState] = useState(""),
    [selected, setSelected] = useState(
      () => new URLSearchParams(location.search).get("batch") ?? "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const history = usePages(
      "/admin/catalog-batches?" + query({ state, limit: 20 }),
    ),
    detail = useData(selected ? "/admin/catalog-batches/" + selected : null),
    genres = usePages("/admin/genres?limit=100"),
    [updated, setUpdated] = useState<Row | null>(null);
  useEffect(() => {
    setUpdated(null);
    setError(null);
  }, [selected]);
  const job = updated ?? detail.data,
    canRun =
      job &&
      (job.action === "PUBLISH" || job.action === "UNPUBLISH"
        ? auth.can("catalog.publish")
        : auth.can("catalog.write"));
  async function resume() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      setUpdated(
        (
          await api("/admin/catalog-batches/" + job.id + "/execution", {
            method: "POST",
            headers: {
              "If-Match": '"catalog-batch:' + job.id + ":" + job.version + '"',
            },
            body: { confirm: true },
          })
        ).data,
      );
      history.reload();
    } catch (e) {
      setError(errorValue(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="NHẬT KÝ CÔNG VIỆC"
        title="Lịch sử xử lý hàng loạt"
        text="Xem các đợt do bạn tạo, kết quả từng phim và tiếp tục đợt bị gián đoạn trong cùng phiên đăng nhập."
      />
      <Link className="button secondary" to="/admin/titles">
        Chọn phim để xử lý
      </Link>
      <div className="admin-toolbar">
        <label>
          Trạng thái đợt{" "}
          <select
            aria-label="Trạng thái đợt xử lý"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">Tất cả</option>
            <option value="PREVIEW">Chờ xác nhận</option>
            <option value="RUNNING">Đang xử lý</option>
            <option value="COMPLETED">Đã xử lý</option>
          </select>
        </label>
        <button className="button secondary small" onClick={history.reload}>
          Làm mới lịch sử
        </button>
      </div>
      <ErrorBox error={history.error} onRetry={history.reload} />
      {history.loading && <Spinner />}
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Thao tác</th>
              <th>Tạo lúc</th>
              <th>Kết quả</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {history.rows.map((r) => (
              <tr key={r.id}>
                <td>{actions[r.action]}</td>
                <td>{dateLabel(r.createdAt)}</td>
                <td>
                  {r.expired
                    ? "Đã hết hạn"
                    : r.state === "PREVIEW"
                      ? "Chờ xác nhận"
                      : r.state === "RUNNING"
                        ? "Đang xử lý"
                        : "Đã xử lý"}{" "}
                  · {r.counts.applied} đã áp dụng ·{" "}
                  {r.counts.failed + r.counts.blocked} chưa áp dụng
                </td>
                <td>
                  <button
                    className="button small secondary"
                    onClick={() => setSelected(r.id)}
                  >
                    Chi tiết đợt
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.cursor && (
        <button
          className="button secondary"
          disabled={history.loading}
          onClick={() => void history.more()}
        >
          Xem thêm đợt
        </button>
      )}
      {!history.loading && !history.rows.length && !history.error && (
        <Empty
          title="Chưa có đợt xử lý"
          text="Chọn phim tại kho nội dung để bắt đầu."
        />
      )}
      <ErrorBox error={detail.error} onRetry={detail.reload} />
      <ErrorBox error={error} />
      {detail.loading && <Spinner />}
      {job && (
        <section className="panel catalog-batch-tools">
          <BatchReceipt job={job} genres={genres.rows} />
          {job.state === "RUNNING" &&
            !job.expired &&
            job.sameSession &&
            canRun && (
              <button
                className="button"
                disabled={busy}
                onClick={() => void resume()}
              >
                Tiếp tục đợt xử lý
              </button>
            )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setUpdated(null);
              detail.reload();
            }}
          >
            Đọc lại kết quả
          </button>
        </section>
      )}
    </>
  );
}
