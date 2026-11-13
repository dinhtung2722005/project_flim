import { useState } from "react";
import { Pencil, Plus, Search, UsersRound } from "lucide-react";
import { useAuth, usePages } from "../../lib/state";
import {
  Empty,
  ErrorBox,
  Field,
  PageHeading,
  Spinner,
} from "../../components/ui";
import {
  AssetPreview,
  ResourceDialog,
  ResourceMore,
  useResourceEditor,
} from "./resource-ui";

export function AdminPeople() {
  const auth = useAuth(),
    data = usePages("/admin/people?limit=20");
  const edit = useResourceEditor("/admin/people", data.reload);
  const [term, setTerm] = useState("");
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase("vi")
      .replaceAll("đ", "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const rows = data.rows.filter((row) =>
    normalize(row.name).includes(normalize(term)),
  );
  const draft = edit.draft;
  return (
    <>
      <PageHeading
        eyebrow="NHÂN VẬT & ĐOÀN PHIM"
        title="Diễn viên & đạo diễn"
        text="Lưu hồ sơ, tiểu sử và ảnh đại diện của những người làm nên bộ phim."
        action={
          auth.can("catalog.write") && (
            <button
              className="button"
              disabled={edit.busy}
              onClick={() => void edit.open()}
            >
              <Plus size={18} />
              Thêm nhân vật
            </button>
          )
        }
      />
      <div className="admin-toolbar">
        <div className="toolbar-search">
          <Search size={18} />
          <input
            aria-label="Tìm nhân vật đã tải"
            placeholder="Tìm tên trong danh sách đã tải…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <span className="muted resource-count">
          {rows.length} / {data.rows.length} hồ sơ đã tải
        </span>
      </div>
      <ErrorBox error={data.error} onRetry={data.reload} />
      <div className="people-grid">
        {rows.map((row) => (
          <article className="panel person-card" key={row.id}>
            <div className="person-card-top">
              <AssetPreview assetRef={row.photoAssetRef} label={row.name} />
              <div>
                <h2>{row.name}</h2>
                <span className="muted">Hồ sơ nhân vật</span>
              </div>
            </div>
            <p className="person-biography">
              {row.biography || "Chưa có tiểu sử."}
            </p>
            {auth.can("catalog.write") && (
              <button
                className="button secondary small"
                disabled={edit.busy}
                onClick={() => void edit.open(row)}
              >
                <Pencil size={15} />
                Chỉnh sửa<span className="sr-only"> {row.name}</span>
              </button>
            )}
          </article>
        ))}
      </div>
      {data.loading && <Spinner />}
      {!data.loading && !data.error && !rows.length && (
        <Empty
          title={term ? "Không tìm thấy nhân vật" : "Chưa có hồ sơ nhân vật"}
          text={
            term
              ? "Thử tên khác hoặc tải thêm hồ sơ bên dưới."
              : "Thêm diễn viên hoặc đạo diễn để chuẩn bị thông tin cho kho phim."
          }
          action={<UsersRound size={28} />}
        />
      )}
      {data.cursor && (
        <ResourceMore
          loading={data.loading}
          more={data.more}
          count={data.rows.length}
        />
      )}
      {draft && (
        <ResourceDialog
          title={draft.id ? "Sửa hồ sơ nhân vật" : "Thêm nhân vật"}
          busy={edit.busy}
          error={edit.error}
          conflict={edit.conflict}
          onClose={edit.close}
          onReload={() => void edit.open(draft)}
          onSave={() =>
            void edit.save({
              name: String(draft.name || "").trim(),
              biography: draft.biography || "",
              photoAssetRef: String(draft.photoAssetRef || "").trim(),
            })
          }
        >
          <Field label="Tên nhân vật *">
            <input
              autoFocus
              required
              maxLength={200}
              value={draft.name || ""}
              onChange={(e) =>
                edit.setDraft({ ...draft, name: e.target.value })
              }
            />
          </Field>
          <Field label="Tiểu sử">
            <textarea
              rows={5}
              maxLength={20000}
              value={draft.biography || ""}
              onChange={(e) =>
                edit.setDraft({ ...draft, biography: e.target.value })
              }
            />
          </Field>
          <Field
            label="Mã ảnh Cloudinary"
            hint="Dùng mã ảnh đã có, ví dụ people/ten-nhan-vat."
          >
            <input
              maxLength={500}
              pattern="[A-Za-z0-9_./-]+"
              placeholder="people/ten-nhan-vat"
              value={draft.photoAssetRef || ""}
              onChange={(e) =>
                edit.setDraft({ ...draft, photoAssetRef: e.target.value })
              }
            />
          </Field>
          <AssetPreview
            assetRef={draft.photoAssetRef}
            label={draft.name || "Ảnh đại diện"}
          />
        </ResourceDialog>
      )}
    </>
  );
}
