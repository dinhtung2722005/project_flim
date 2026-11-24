import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../../lib/state";
import { api, type Row } from "../../lib/api";
import { countLabel, countValue } from "../../lib/counts";
import { ErrorBox, Spinner, asError } from "../../components/ui";
export function ViewMetrics() {
  const [days, setDays] = useState(7),
    report = useData("/admin/metrics/views?days=" + days),
    data = report.data;
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState<Error | null>(null);
  const exportRequest = useRef<AbortController | null>(null);
  useEffect(() => () => exportRequest.current?.abort(), []);
  async function download() {
    const controller = new AbortController();
    exportRequest.current = controller;
    setExporting(true);
    setExportError(null);
    try {
      const r = await api<Blob>("/admin/metrics/views/export?days=" + days, {
        responseType: "blob",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(r.data),
        link = document.createElement("a");
      link.href = url;
      link.download = "pj-flim-views-" + days + "-days.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!controller.signal.aborted) setExportError(asError(e));
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  const max =
    data?.daily.reduce(
      (value: bigint, row: Row) =>
        countValue(row.views) > value ? countValue(row.views) : value,
      1n,
    ) ?? 1n;
  return (
    <section
      className="panel view-metrics"
      aria-labelledby="view-metrics-heading"
    >
      <div className="section-heading">
        <h2 id="view-metrics-heading">Thống kê lượt xem</h2>
        <div className="view-metrics-controls">
          <label>
            Khoảng thời gian{" "}
            <select
              disabled={exporting}
              aria-label="Khoảng thời gian thống kê"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[7, 30, 90].map((n) => (
                <option key={n} value={n}>
                  {n} ngày
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary small"
            disabled={exporting || report.loading}
            onClick={() => void download()}
          >
            {exporting ? "Đang xuất…" : "Xuất CSV"}
          </button>
          <button className="button secondary small" onClick={report.reload}>
            Làm mới
          </button>
        </div>
      </div>
      <ErrorBox error={exportError} />
      <ErrorBox error={report.error} onRetry={report.reload} />
      {report.loading && <Spinner />}
      {data && (
        <>
          <p>
            <strong>{countLabel(data.total.views)}</strong> lượt xem hợp lệ ·{" "}
            <strong>{countLabel(data.total.playbackStarts)}</strong> phiên đã
            phát
          </p>
          <p className="muted">
            Xem đủ 120 giây hoặc 50% video ngắn. Mỗi định danh/phim/ngày UTC tối
            đa một lượt. Số liệu bắt đầu{" "}
            {data.measurementStartedAt
              ? new Date(data.measurementStartedAt).toLocaleString("vi-VN")
              : "khi bật thống kê"}
            .
          </p>
          <p className="muted" role="status">
            {data.workerInitialized
              ? "Đã khởi tạo xử lý nền"
              : "Chờ khởi tạo worker"}{" "}
            · {countLabel(data.processing.pendingBatches)} lô đang chờ · Lần xử
            lý gần nhất:{" "}
            {data.processing.lastProcessedAt
              ? new Date(data.processing.lastProcessedAt).toLocaleString(
                  "vi-VN",
                )
              : "Chưa có"}
          </p>
          <div
            className="view-chart"
            role="img"
            aria-label={
              "Lượt xem hợp lệ mỗi ngày UTC trong " +
              days +
              " ngày. Số liệu chi tiết ở bảng bên dưới."
            }
          >
            {data.daily.map((row: Row) => (
              <div
                key={row.day}
                title={row.day + ": " + countLabel(row.views) + " lượt"}
              >
                <span
                  style={{
                    height:
                      String(Number((countValue(row.views) * 100n) / max)) +
                      "%",
                  }}
                />
              </div>
            ))}
          </div>
          <details>
            <summary>Xem số liệu theo ngày UTC</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Ngày UTC</th>
                    <th>Lượt xem hợp lệ</th>
                    <th>Phiên đã phát</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((r: Row) => (
                    <tr key={r.day}>
                      <td>{r.day}</td>
                      <td>{countLabel(r.views)}</td>
                      <td>{countLabel(r.playbackStarts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <h3>Phim công khai được xem nhiều</h3>
          {!data.top.length ? (
            <p className="muted">Chưa có lượt xem trong khoảng đã chọn.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Phim</th>
                    <th>Lượt xem hợp lệ</th>
                    <th>Phiên đã phát</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((r: Row) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={"/titles/" + r.id}>{r.name}</Link>
                      </td>
                      <td>{countLabel(r.views)}</td>
                      <td>{countLabel(r.playbackStarts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
