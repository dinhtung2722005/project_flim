import { useEffect, useState, type FormEvent } from "react";
import { Globe, Mail, RefreshCw, Save } from "lucide-react";
import { api, ApiError, dateLabel, type Row } from "../../lib/api";
import { useNotice } from "../../lib/state";
import {
  ErrorBox,
  Field,
  PageHeading,
  Spinner,
  asError,
} from "../../components/ui";
import { useAdminAction } from "./actions";

export function AdminSettings() {
  const [record, setRecord] = useState<Row | null>(null),
    [etag, setEtag] = useState("");
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    supportEmail: "",
  });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const notify = useNotice(),
    run = useAdminAction();
  function apply(row: Row, tag: string) {
    setRecord(row);
    setEtag(tag);
    setDraft({
      name: row.value?.name || "",
      description: row.value?.description || "",
      supportEmail: row.value?.supportEmail || "",
    });
  }
  useEffect(() => {
    const controller = new AbortController();
    api("/admin/settings/site", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) apply(result.data, result.etag);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(asError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const result = await api("/admin/settings/site");
      apply(result.data, result.etag);
    } catch (e) {
      setError(asError(e));
    } finally {
      setLoading(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !etag) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        ...(draft.supportEmail.trim()
          ? { supportEmail: draft.supportEmail.trim() }
          : {}),
      };
      const result = await run(() =>
        api("/admin/settings/site", {
          method: "PUT",
          headers: { "If-Match": etag },
          body,
        }),
      );
      apply(result.data, result.etag);
      notify("Đã lưu cấu hình website.");
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  const saved = record?.value || {};
  const dirty =
    draft.name !== (saved.name || "") ||
    draft.description !== (saved.description || "") ||
    draft.supportEmail !== (saved.supportEmail || "");
  const conflict =
    error instanceof ApiError && error.code === "RESOURCE_VERSION_MISMATCH";
  return (
    <>
      <PageHeading
        eyebrow="THIẾT LẬP CHUNG"
        title="Cấu hình website"
        text="Quản lý thông tin giới thiệu và địa chỉ hỗ trợ của website."
      />
      <ErrorBox
        error={error}
        onRetry={!record ? () => void reload() : undefined}
      />
      {loading ? (
        <Spinner />
      ) : (
        record && (
          <div className="settings-layout">
            <section className="panel settings-form">
              <h2>Thông tin website</h2>
              <p className="muted">
                Chỉ người được cấp quyền cấu hình mới có thể lưu thay đổi.
              </p>
              <form onSubmit={(e) => void save(e)}>
                <fieldset disabled={busy} className="resource-fields">
                  <Field label="Tên website *">
                    <input
                      required
                      maxLength={100}
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Mô tả">
                    <textarea
                      rows={5}
                      maxLength={500}
                      value={draft.description}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Email hỗ trợ">
                    <input
                      type="email"
                      maxLength={254}
                      placeholder="hotro@example.com"
                      value={draft.supportEmail}
                      onChange={(e) =>
                        setDraft({ ...draft, supportEmail: e.target.value })
                      }
                    />
                  </Field>
                </fieldset>
                {conflict && (
                  <p className="muted">
                    Cấu hình đã được người khác thay đổi. Hãy tải bản mới trước
                    khi lưu.
                  </p>
                )}
                <div className="settings-save">
                  <span role="status" className="muted">
                    {dirty
                      ? "Có thay đổi chưa lưu"
                      : "Đã đồng bộ với cấu hình đã lưu"}
                  </span>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void reload()}
                    >
                      <RefreshCw size={16} />
                      {conflict ? "Tải bản mới" : "Bỏ thay đổi"}
                    </button>
                    <button
                      className="button"
                      disabled={busy || !dirty || conflict}
                    >
                      <Save size={17} />
                      {busy ? "Đang lưu…" : "Lưu cấu hình"}
                    </button>
                  </div>
                </div>
              </form>
            </section>
            <aside className="panel settings-preview">
              <span className="settings-mark">
                <Globe size={26} />
              </span>
              <p className="eyebrow">BẢN NHÁP THÔNG TIN</p>
              <h2>{draft.name || "Tên website"}</h2>
              <p>{draft.description || "Mô tả website sẽ hiển thị ở đây."}</p>
              {draft.supportEmail && (
                <p className="settings-email">
                  <Mail size={16} />
                  {draft.supportEmail}
                </p>
              )}
              <hr />
              <small className="muted">
                Lưu gần nhất: {dateLabel(record.updatedAt)}
              </small>
            </aside>
          </div>
        )
      )}
    </>
  );
}
