import { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  CheckCircle2,
  RefreshCw,
  Square,
  FileVideo,
  ShieldCheck,
} from "lucide-react";
import { uploadVideoDirect } from "../../../../../packages/media/src/browser-upload";
import { api, type Row } from "../../lib/api";
import { useAuth, useNotice } from "../../lib/state";
import { Badge, ErrorBox, asError } from "../../components/ui";
import {
  ENCODING_PRESETS,
  DEFAULT_ENCODING_PRESET,
  type EncodingPresetId,
} from "../../../../../packages/contracts/src/encoding";

type RecordIds = {
  intentId: string;
  assetId: string;
  verifyKey: string;
  operationId?: string;
};
export function UploadPanel({
  episode,
  onUpdated,
}: {
  episode: Row;
  onUpdated: () => void;
}) {
  const auth = useAuth(),
    notice = useNotice(),
    key = "pj-flim.upload:" + auth.user?.id + ":" + episode.id;
  const [record, setRecord] = useState<RecordIds | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  });
  const [file, setFile] = useState<File | null>(null),
    [encodingPreset, setEncodingPreset] = useState<EncodingPresetId>(
      DEFAULT_ENCODING_PRESET,
    ),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [phase, setPhase] = useState(""),
    [asset, setAsset] = useState<Row | null>(null),
    [operation, setOperation] = useState<Row | null>(null),
    [error, setError] = useState<Error | null>(null),
    [pollVersion, setPollVersion] = useState(0);
  const abort = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  function save(value: RecordIds) {
    setRecord(value);
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }
  useEffect(() => {
    const id = record?.assetId || episode.activeAssetId;
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const result = (
          await api("/admin/media-assets/" + id, { signal: controller.signal })
        ).data;
        if (controller.signal.aborted) return;
        setAsset(result);
        if (record?.operationId) {
          try {
            const op = await api("/admin/operations/" + record.operationId, {
              signal: controller.signal,
            });
            if (!controller.signal.aborted) setOperation(op.data);
          } catch {}
        }
        if (!["READY", "FAILED"].includes(result.processingStatus))
          timer = setTimeout(() => void poll(), 3000);
      } catch (e) {
        if (!controller.signal.aborted) setError(asError(e));
      }
    }
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [
    record?.assetId,
    record?.operationId,
    episode.activeAssetId,
    pollVersion,
  ]);
  async function verify(value: RecordIds, signal?: AbortSignal) {
    setPhase("Đang xác minh video…");
    const result = (
      await api("/admin/upload-intents/" + value.intentId + "/verifications", {
        method: "POST",
        headers: { "Idempotency-Key": value.verifyKey },
        body: { episodeId: episode.id },
        signal,
      })
    ).data;
    if (!alive.current) return;
    save({ ...value, operationId: result.operationId });
    setPhase("Video đang được xử lý và sao lưu");
    setPollVersion((v) => v + 1);
    notice("Đã nhận video. Hệ thống đang chuẩn bị các mức chất lượng.");
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    setPhase("Đang tạo lượt tải…");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const format = file.name.split(".").pop()?.toLowerCase();
      if (!["mp4", "mov", "mkv", "webm", "m4v", "avi"].includes(format || ""))
        throw new Error(
          "Vui lòng chọn file video MP4, MOV, MKV, WEBM, M4V hoặc AVI.",
        );
      const intent = (
        await api("/admin/episodes/" + episode.id + "/upload-intents", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: {
            expectedBytes: file.size,
            sourceFormat: format,
            encodingPreset,
          },
          signal: controller.signal,
        })
      ).data;
      const value = {
        intentId: intent.id,
        assetId: intent.assetId,
        verifyKey: crypto.randomUUID(),
      };
      if (!alive.current) return;
      save(value);
      setPhase("Đang tải video…");
      await uploadVideoDirect(file, intent.upload, {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (alive.current) setProgress(Math.round((done / total) * 100));
        },
      });
      await verify(value, controller.signal);
    } catch (e) {
      if (alive.current) {
        setError(
          controller.signal.aborted
            ? new Error(
                "Đã dừng tải. Bạn có thể kiểm tra video nếu lượt tải đã hoàn tất.",
              )
            : asError(e),
        );
        setPhase("");
      }
    } finally {
      if (alive.current) setBusy(false);
      abort.current = null;
    }
  }
  async function verifyAgain() {
    if (!record) return;
    setBusy(true);
    setError(null);
    try {
      await verify(record);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function activate() {
    if (!record?.assetId) return;
    setBusy(true);
    setError(null);
    try {
      const latest = await api("/admin/episodes/" + episode.id);
      await api("/admin/episodes/" + episode.id, {
        method: "PATCH",
        headers: { "If-Match": latest.etag },
        body: { activeAssetId: record.assetId },
      });
      notice("Đã chọn video cho tập phim.");
      onUpdated();
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      const next = (
        await api("/admin/media-assets/" + asset.id + "/processing-attempts", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: { reason: "Thử lại xử lý video từ trang quản trị" },
        })
      ).data;
      if (record) save({ ...record, operationId: next.operationId });
      setAsset({ ...asset, processingStatus: "PROCESSING" });
      setPollVersion((v) => v + 1);
      notice("Đã yêu cầu xử lý lại video.");
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="upload-panel">
      <div className="section-heading">
        <h3>
          <FileVideo size={18} />
          Video tập phim
        </h3>
        {asset && <Badge value={asset.processingStatus} />}
      </div>
      <ErrorBox error={error} />
      {auth.can("media.upload") && (
        <>
          <label>
            Chất lượng và dung lượng video
            <select
              aria-label="Chất lượng và dung lượng video"
              value={encodingPreset}
              disabled={busy}
              onChange={(e) =>
                setEncodingPreset(e.target.value as EncodingPresetId)
              }
            >
              {ENCODING_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            {ENCODING_PRESETS.find((p) => p.id === encodingPreset)?.description}{" "}
            Các mức thực tế phụ thuộc video gốc.
          </p>
          <label className="upload-drop">
            <UploadCloud size={28} />
            <strong>{file ? file.name : "Chọn video để tải lên"}</strong>
            <span>
              {file
                ? (file.size / 1024 / 1024).toFixed(1) + " MB"
                : "MP4, MOV, MKV, WEBM, M4V, AVI"}
            </span>
            <input
              aria-label="Chọn video"
              type="file"
              accept=".mp4,.mov,.mkv,.webm,.m4v,.avi"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <div className="button-row">
            <button
              className="button small"
              disabled={!file || busy}
              onClick={() => void upload()}
            >
              <UploadCloud size={16} />
              {busy ? "Đang thực hiện…" : "Tải video"}
            </button>
            {busy && (
              <button
                className="button ghost small"
                onClick={() => abort.current?.abort()}
                disabled={!abort.current}
              >
                <Square size={14} />
                Dừng tải
              </button>
            )}
            {record && !busy && (
              <button
                className="button ghost small"
                onClick={() => void verifyAgain()}
              >
                <RefreshCw size={14} />
                Kiểm tra video đã tải
              </button>
            )}
          </div>
        </>
      )}
      {busy && (
        <div className="upload-progress">
          <progress max={100} value={progress} />
          <p>
            {phase} {progress > 0 && progress + "%"}
          </p>
        </div>
      )}
      {asset && (
        <div className="processing-status">
          <div>
            <CheckCircle2 size={16} />
            <span>
              Video:{" "}
              <strong>
                {asset.processingStatus === "READY"
                  ? "Sẵn sàng"
                  : asset.processingStatus === "FAILED"
                    ? "Cần kiểm tra"
                    : "Đang xử lý"}
              </strong>
            </span>
          </div>
          <div>
            <ShieldCheck size={16} />
            <span>
              Sao lưu:{" "}
              <strong>
                {asset.backupStatus === "VERIFIED"
                  ? "Đã xác minh"
                  : asset.backupStatus === "FAILED"
                    ? "Thất bại"
                    : "Đang chuẩn bị"}
              </strong>
            </span>
          </div>
          {asset.encoding && (
            <p className="muted">
              Cấu hình:{" "}
              {ENCODING_PRESETS.find((p) => p.id === asset.encoding.presetId)
                ?.name ?? asset.encoding.presetId}{" "}
              · H.264 / AAC
            </p>
          )}
          {Array.isArray(asset.renditions) && asset.renditions.length > 0 && (
            <div>
              <strong>Các mức đã xác minh</strong>
              <ul>
                {asset.renditions.map((r: Row) => (
                  <li key={r.width + "x" + r.height}>
                    {r.width} × {r.height} ·{" "}
                    {(Number(r.bandwidth) / 1000000).toFixed(2)} Mbps
                  </li>
                ))}
              </ul>
            </div>
          )}
          {operation?.status === "RUNNING" && (
            <progress
              aria-label="Tiến trình xử lý"
              max={100}
              value={Number(operation.progress) || 0}
            />
          )}{" "}
          {asset.processingStatus === "READY" &&
            asset.backupStatus === "VERIFIED" &&
            (episode.activeAssetId === asset.id ? (
              <p className="success-text">
                Video này đang được sử dụng cho tập phim.
              </p>
            ) : auth.can("catalog.publish") && record ? (
              <button
                className="button small"
                disabled={busy}
                onClick={() => void activate()}
              >
                <CheckCircle2 size={16} />
                Sử dụng video này
              </button>
            ) : (
              <p className="muted">
                Video đã sẵn sàng. Người có quyền xuất bản có thể chọn video cho
                tập.
              </p>
            ))}
          {asset.processingStatus === "FAILED" && auth.can("media.retry") && (
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => void retry()}
            >
              <RefreshCw size={15} />
              Xử lý lại
            </button>
          )}
        </div>
      )}
    </div>
  );
}
