import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Pencil, Plus, Search } from "lucide-react";
import { dateLabel, query, type Row } from "../../lib/api";
import { useAuth, useData, usePages } from "../../lib/state";
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

function localTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function TitlePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId(),
    [term, setTerm] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);
  const titles = usePages("/admin/titles?" + query({ q: search, limit: 20 }));
  const selected = useData(value ? "/admin/titles/" + value : null);
  const rows = [...titles.rows];
  if (value && !rows.some((row) => row.id === value))
    rows.unshift(
      selected.data || { id: value, localizedTitle: "Phim đang chọn" },
    );
  return (
    <div className="field title-picker">
      <label htmlFor={id}>Phim liên kết *</label>
      <div className="toolbar-search">
        <Search size={16} />
        <input
          aria-label="Tìm phim cho banner"
          placeholder="Nhập tên để tìm phim…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        />
      </div>
      <select
        id={id}
        value={value}
        required
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Chọn phim</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.localizedTitle}
            {row.releaseYear ? " (" + row.releaseYear + ")" : ""}
          </option>
        ))}
      </select>
      <ErrorBox error={titles.error} onRetry={titles.reload} />
      {titles.loading && <small role="status">Đang tìm phim…</small>}
      {!titles.loading && !titles.rows.length && (
        <small>Không tìm thấy phim. Thử tên khác.</small>
      )}
      {titles.cursor && (
        <button
          type="button"
          className="button ghost small"
          onClick={() => void titles.more()}
          disabled={titles.loading}
        >
          Tải thêm phim
        </button>
      )}
    </div>
  );
}
function BannerCard({
  row,
  busy,
  canEdit,
  onEdit,
}: {
  row: Row;
  busy: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const title = useData("/admin/titles/" + row.titleId);
  const now = Date.now();
  const state = !row.enabled
    ? "Đang tắt"
    : row.endsAt && Date.parse(row.endsAt) <= now
      ? "Đã hết lịch"
      : row.startsAt && Date.parse(row.startsAt) > now
        ? "Đã lên lịch"
        : "Đang bật";
  return (
    <article className="panel banner-card">
      <div className="banner-art">
        <AssetPreview
          assetRef={row.imageAssetRef}
          label={row.headline || "Banner"}
          wide
        />
        <span className={"badge " + (row.enabled ? "good" : "")}>{state}</span>
      </div>
      <div className="banner-card-content">
        <p className="eyebrow">THỨ TỰ {row.sortOrder}</p>
        <h2>{row.headline || "Banner chưa có tiêu đề"}</h2>
        <Link className="text-link" to={"/admin/titles/" + row.titleId}>
          {title.data?.localizedTitle || "Mở phim liên kết"}
        </Link>
        <p className="banner-schedule">
          <CalendarDays size={16} />
          <span>
            {row.startsAt ? dateLabel(row.startsAt) : "Không giới hạn bắt đầu"}
            <br />
            {row.endsAt
              ? "Đến " + dateLabel(row.endsAt)
              : "Không giới hạn kết thúc"}
          </span>
        </p>
        {canEdit && (
          <button
            className="button secondary small"
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil size={15} />
            Chỉnh sửa banner
          </button>
        )}
      </div>
    </article>
  );
}
export function AdminBanners() {
  const auth = useAuth(),
    data = usePages("/admin/banners?limit=20");
  const edit = useResourceEditor("/admin/banners", data.reload),
    draft = edit.draft;
  async function save() {
    if (!draft) return;
    if (
      draft.startsAt &&
      draft.endsAt &&
      Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)
    ) {
      edit.setError(
        new Error("Thời gian kết thúc phải sau thời gian bắt đầu."),
      );
      return;
    }
    await edit.save({
      titleId: draft.titleId,
      imageAssetRef: String(draft.imageAssetRef || "").trim(),
      headline: String(draft.headline || "").trim(),
      sortOrder: Number(draft.sortOrder || 0),
      enabled: !!draft.enabled,
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
    });
  }
  return (
    <>
      <PageHeading
        eyebrow="TRƯNG BÀY NỘI DUNG"
        title="Banner trang chủ"
        text="Quản lý ảnh giới thiệu, phim liên kết và lịch hiển thị."
        action={
          auth.can("catalog.write") && (
            <button
              className="button"
              disabled={edit.busy}
              onClick={() => void edit.open()}
            >
              <Plus size={18} />
              Thêm banner
            </button>
          )
        }
      />
      <div className="resource-summary">
        <span>{data.rows.length} banner đã tải</span>
        <span>Bật banner và xuất bản phim là hai thao tác riêng.</span>
      </div>
      <ErrorBox error={data.error} onRetry={data.reload} />
      <div className="banner-grid">
        {[...data.rows]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((row) => (
            <BannerCard
              key={row.id}
              row={row}
              busy={edit.busy}
              canEdit={auth.can("catalog.write")}
              onEdit={() => void edit.open(row)}
            />
          ))}
      </div>
      {data.loading && <Spinner />}
      {!data.loading && !data.error && !data.rows.length && (
        <Empty
          title="Chưa có banner"
          text="Chọn một bộ phim và ảnh giới thiệu để tạo banner đầu tiên."
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
          title={draft.id ? "Sửa banner" : "Thêm banner"}
          busy={edit.busy}
          error={edit.error}
          conflict={edit.conflict}
          onClose={edit.close}
          onReload={() => void edit.open(draft)}
          onSave={() => void save()}
        >
          <TitlePicker
            value={draft.titleId || ""}
            onChange={(titleId) => edit.setDraft({ ...draft, titleId })}
          />
          <Field label="Tiêu đề banner">
            <input
              autoFocus
              maxLength={300}
              value={draft.headline || ""}
              onChange={(e) =>
                edit.setDraft({ ...draft, headline: e.target.value })
              }
            />
          </Field>
          <Field
            label="Mã ảnh Cloudinary *"
            hint="Dùng mã ảnh đã có trong Cloudinary, ví dụ banners/phim-moi."
          >
            <input
              required
              maxLength={500}
              pattern="[A-Za-z0-9_./-]+"
              placeholder="banners/phim-moi"
              value={draft.imageAssetRef || ""}
              onChange={(e) =>
                edit.setDraft({ ...draft, imageAssetRef: e.target.value })
              }
            />
          </Field>
          <AssetPreview
            assetRef={draft.imageAssetRef}
            label={draft.headline || "Banner"}
            wide
          />
          <div className="form-grid">
            <Field label="Thứ tự hiển thị" hint="Số nhỏ được ưu tiên trước.">
              <input
                type="number"
                min={0}
                max={100000}
                step={1}
                value={draft.sortOrder ?? 0}
                onChange={(e) =>
                  edit.setDraft({ ...draft, sortOrder: e.target.value })
                }
              />
            </Field>
            <div className="field banner-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={!!draft.enabled}
                  onChange={(e) =>
                    edit.setDraft({ ...draft, enabled: e.target.checked })
                  }
                />
                Bật banner
              </label>
            </div>
            <Field label="Bắt đầu" hint="Theo múi giờ trên thiết bị của bạn.">
              <input
                type="datetime-local"
                value={localTime(draft.startsAt)}
                onChange={(e) =>
                  edit.setDraft({ ...draft, startsAt: e.target.value })
                }
              />
            </Field>
            <Field
              label="Kết thúc"
              hint="Để trống nếu không đặt ngày kết thúc."
            >
              <input
                type="datetime-local"
                value={localTime(draft.endsAt)}
                onChange={(e) =>
                  edit.setDraft({ ...draft, endsAt: e.target.value })
                }
              />
            </Field>
          </div>
        </ResourceDialog>
      )}
    </>
  );
}
