import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Image, RefreshCw, Save, X } from "lucide-react";
import { api, ApiError, poster, type Row } from "../../lib/api";
import { useNotice } from "../../lib/state";
import { ErrorBox, asError } from "../../components/ui";
import { useAdminAction } from "./actions";

export function useResourceEditor(resource: string, onSaved: () => void) {
  const [draft, setDraft] = useState<Row | null>(null);
  const [etag, setEtag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const notify = useNotice(),
    run = useAdminAction();
  async function open(row?: Row) {
    setBusy(true);
    try {
      const result = row?.id ? await api(resource + "/" + row.id) : null;
      setEtag(result?.etag ?? "");
      setError(null);
      setDraft(result?.data ?? {});
    } catch (e) {
      notify(asError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function save(body: Row) {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.id && !etag)
        throw new Error("Hãy tải lại dữ liệu trước khi lưu.");
      await run(() =>
        api(resource + (draft.id ? "/" + draft.id : ""), {
          method: draft.id ? "PATCH" : "POST",
          headers: draft.id ? { "If-Match": etag } : undefined,
          body,
        }),
      );
      setDraft(null);
      notify(draft.id ? "Đã lưu thay đổi." : "Đã tạo mới.");
      onSaved();
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return {
    draft,
    setDraft,
    busy,
    error,
    setError,
    open,
    save,
    close: () => {
      if (!busy) setDraft(null);
    },
    conflict:
      error instanceof ApiError && error.code === "RESOURCE_VERSION_MISMATCH",
  };
}
export function ResourceDialog({
  title,
  busy,
  error,
  conflict,
  onClose,
  onReload,
  onSave,
  children,
}: {
  title: string;
  busy: boolean;
  error: Error | null;
  conflict?: boolean;
  onClose: () => void;
  onReload: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      className="modal resource-dialog"
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="resource-dialog-heading">
        <div>
          <p className="eyebrow">QUẢN LÝ NỘI DUNG</p>
          <h2 id={id}>{title}</h2>
        </div>
        <button
          type="button"
          className="button ghost icon-button"
          aria-label="Đóng biểu mẫu"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <ErrorBox error={error} />
        {conflict && (
          <button
            type="button"
            className="button secondary small"
            disabled={busy}
            onClick={onReload}
          >
            <RefreshCw size={16} />
            Tải bản mới và bỏ bản đang sửa
          </button>
        )}
        <fieldset disabled={busy} className="resource-fields">
          {children}
        </fieldset>
        <div className="resource-dialog-footer">
          <span className="muted">Các trường có * là bắt buộc.</span>
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              Hủy
            </button>
            <button className="button" disabled={busy}>
              <Save size={17} />
              {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
export function AssetPreview({
  assetRef,
  label,
  wide = false,
}: {
  assetRef?: string;
  label: string;
  wide?: boolean;
}) {
  const url = poster(assetRef, wide ? 720 : 160),
    [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <div className={"resource-preview" + (wide ? " wide" : "")}>
      {url && !failed ? (
        <img
          src={url}
          alt={label}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <Image size={wide ? 32 : 22} />
          <span>{wide ? "Xem trước ảnh" : label.slice(0, 1) || "P"}</span>
        </>
      )}
    </div>
  );
}
export function ResourceMore({
  loading,
  more,
  count,
}: {
  loading: boolean;
  more: () => Promise<void>;
  count: number;
}) {
  return (
    <div className="load-more">
      <button
        className="button secondary"
        disabled={loading}
        onClick={() => void more()}
      >
        {loading ? "Đang tải…" : "Tải thêm"}
      </button>
      <small className="muted">Đã tải {count} mục</small>
    </div>
  );
}
