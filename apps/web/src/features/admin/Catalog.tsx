import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  Search,
  ArrowLeft,
  Film,
  Save,
  Globe,
  EyeOff,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import {
  api,
  poster,
  query,
  slugify,
  dateLabel,
  type Row,
  type Page,
} from "../../lib/api";
import { useAuth, useData, usePages, useNotice } from "../../lib/state";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  PageHeading,
  Spinner,
  asError,
} from "../../components/ui";
import { UploadPanel } from "./UploadPanel";
export function AdminCatalog() {
  const auth = useAuth(),
    [term, setTerm] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("");
  const data = usePages(
    "/admin/titles?" + query({ q: search, status, limit: 20 }),
  );
  return (
    <>
      <PageHeading
        eyebrow="NỘI DUNG"
        title="Phim & tập phim"
        text="Quản lý thông tin, video và trạng thái xuất bản của từng bộ phim."
        action={
          auth.can("catalog.write") && (
            <Link className="button" to="/admin/titles/new">
              <Plus size={17} />
              Thêm phim
            </Link>
          )
        }
      />
      <div className="admin-toolbar">
        <form
          className="toolbar-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(term);
          }}
        >
          <Search size={18} />
          <input
            aria-label="Tìm phim quản trị"
            placeholder="Tìm tên phim…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <button className="button small">Tìm</button>
        </form>
        <select
          aria-label="Trạng thái phim"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="DRAFT">Bản nháp</option>
          <option value="PUBLISHED">Đã xuất bản</option>
          <option value="UNPUBLISHED">Đã ẩn</option>
          <option value="ARCHIVED">Lưu trữ</option>
        </select>
      </div>
      <ErrorBox error={data.error} onRetry={data.reload} />
      <section className="panel table-panel">
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Bảng dữ liệu, có thể cuộn ngang"
        >
          <table>
            <thead>
              <tr>
                <th>Phim</th>
                <th>Loại</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link
                      className="table-movie"
                      to={"/admin/titles/" + row.id}
                    >
                      <span className="mini-poster">
                        {poster(row.posterAssetRef, 100) ? (
                          <img src={poster(row.posterAssetRef, 100)} alt="" />
                        ) : (
                          <Film size={21} />
                        )}
                      </span>
                      <span>
                        <strong>{row.localizedTitle}</strong>
                        <small>
                          {row.releaseYear || "Chưa có năm phát hành"}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>{row.kind === "MOVIE" ? "Phim lẻ" : "Phim bộ"}</td>
                  <td>
                    <Badge value={row.publicationStatus} />
                  </td>
                  <td>{dateLabel(row.createdAt)}</td>
                  <td>
                    <Link
                      className="button ghost small"
                      to={"/admin/titles/" + row.id}
                    >
                      Quản lý <ChevronRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.loading && <Spinner />}
        {!data.loading && !data.rows.length && !data.error && (
          <Empty
            title={
              search || status
                ? "Không có phim phù hợp"
                : "Tạo bộ phim đầu tiên"
            }
            text={
              search || status
                ? "Thử tên phim hoặc trạng thái khác."
                : "Thêm thông tin phim để bắt đầu xây dựng kho nội dung."
            }
            action={
              auth.can("catalog.write") && (
                <Link className="button secondary" to="/admin/titles/new">
                  <Plus size={16} />
                  Thêm phim
                </Link>
              )
            }
          />
        )}
      </section>
      {data.cursor && (
        <div className="load-more">
          <button
            className="button secondary"
            disabled={data.loading}
            onClick={() => void data.more()}
          >
            Xem thêm
          </button>
        </div>
      )}
    </>
  );
}
const defaults = {
  kind: "MOVIE",
  localizedTitle: "",
  slug: "",
  originalTitle: "",
  synopsis: "",
  releaseYear: "",
  ageRating: "",
  posterAssetRef: "",
  backdropAssetRef: "",
  genreIds: [] as string[],
};
export function TitleEditor() {
  const { id } = useParams(),
    nav = useNavigate(),
    auth = useAuth(),
    notice = useNotice();
  const [form, setForm] = useState({ ...defaults }),
    [loaded, setLoaded] = useState<Row | null>(null),
    [etag, setEtag] = useState(""),
    [loading, setLoading] = useState(!!id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [slugTouched, setSlugTouched] = useState(false),
    [revision, setRevision] = useState(0);
  const genres = useData<Page>("/admin/genres?limit=100");
  useEffect(() => {
    if (!id) {
      setForm({ ...defaults });
      setLoaded(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api("/admin/titles/" + id, { signal: controller.signal })
      .then((r) => {
        setLoaded(r.data);
        setEtag(r.etag);
        setForm({
          ...defaults,
          ...Object.fromEntries(
            Object.keys(defaults)
              .filter(
                (key) => r.data[key] !== null && r.data[key] !== undefined,
              )
              .map((key) => [key, r.data[key]]),
          ),
          releaseYear: r.data.releaseYear?.toString() || "",
          genreIds: r.data.genres?.map((g: Row) => g.id) || [],
        });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(asError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision]);
  function field(key: string, value: unknown) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "localizedTitle" && !id && !slugTouched)
      setForm((current) => ({ ...current, slug: slugify(String(value)) }));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        releaseYear: form.releaseYear ? Number(form.releaseYear) : undefined,
      };
      const result = await api(id ? "/admin/titles/" + id : "/admin/titles", {
        method: id ? "PATCH" : "POST",
        headers: id ? { "If-Match": etag } : {},
        body,
      });
      notice(
        id
          ? "Đã lưu thông tin phim."
          : "Đã tạo phim. Tiếp theo, thêm video cho tập.",
      );
      if (!id) nav("/admin/titles/" + result.data.id, { replace: true });
      else {
        setLoaded(result.data);
        setEtag(result.etag);
      }
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!id || !loaded) return;
    const status =
      loaded.publicationStatus === "PUBLISHED" ? "UNPUBLISHED" : "PUBLISHED";
    if (
      !window.confirm(
        status === "PUBLISHED"
          ? "Xuất bản phim để người xem có thể tìm thấy? Video và tập phim cần sẵn sàng."
          : "Ẩn bộ phim khỏi kho phim công khai?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const current = await api("/admin/titles/" + id + "/publication");
      await api("/admin/titles/" + id + "/publication", {
        method: "PUT",
        headers: { "If-Match": current.etag },
        body: {
          status,
          reason:
            status === "PUBLISHED"
              ? "Xuất bản từ trang quản trị"
              : "Ẩn phim từ trang quản trị",
        },
      });
      setRevision((v) => v + 1);
      notice(
        status === "PUBLISHED" ? "Đã xuất bản bộ phim." : "Đã ẩn bộ phim.",
      );
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Spinner />;
  return (
    <>
      <Link className="back-link" to="/admin/titles">
        <ArrowLeft size={16} />
        Danh sách phim
      </Link>
      <PageHeading
        eyebrow={id ? "QUẢN LÝ NỘI DUNG" : "TẠO NỘI DUNG"}
        title={id ? loaded?.localizedTitle || "Chi tiết phim" : "Thêm phim mới"}
        text={
          id
            ? "Cập nhật thông tin, quản lý tập và chuẩn bị video."
            : "Điền thông tin cơ bản. Bạn có thể bổ sung video sau."
        }
        action={
          loaded && (
            <div className="button-row">
              <Badge value={loaded.publicationStatus} />
              {auth.can("catalog.publish") && (
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => void publish()}
                >
                  {loaded.publicationStatus === "PUBLISHED" ? (
                    <EyeOff size={15} />
                  ) : (
                    <Globe size={15} />
                  )}{" "}
                  {loaded.publicationStatus === "PUBLISHED"
                    ? "Ẩn phim"
                    : "Xuất bản phim"}
                </button>
              )}
            </div>
          )
        }
      />
      <ErrorBox
        error={error}
        onRetry={id ? () => setRevision((v) => v + 1) : undefined}
      />
      <nav className="editor-sections" aria-label="Các mục quản lý phim">
        <a href="#film-information">Thông tin phim</a>
        {id && <a href="#film-episodes">Tập phim & video</a>}
      </nav>
      <form
        id="film-information"
        className="panel title-form"
        onSubmit={(e) => void save(e)}
      >
        <div className="section-heading">
          <h2>Thông tin bộ phim</h2>
          {id && loaded?.publicationStatus === "PUBLISHED" && (
            <Link to={"/titles/" + id} className="text-link">
              Mở trang phim <ChevronRight size={14} />
            </Link>
          )}
        </div>
        <fieldset disabled={busy || !auth.can("catalog.write")}>
          <div className="form-grid">
            <Field label="Tên phim *">
              <input
                name="localizedTitle"
                value={form.localizedTitle}
                onChange={(e) => field("localizedTitle", e.target.value)}
                required
                maxLength={300}
              />
            </Field>
            <Field label="Tên gốc">
              <input
                value={form.originalTitle}
                onChange={(e) => field("originalTitle", e.target.value)}
                maxLength={300}
              />
            </Field>
            <Field
              label="Đường dẫn *"
              hint="Chữ thường không dấu, ví dụ: chuyen-dem-mua."
            >
              <input
                name="slug"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  field("slug", e.target.value);
                }}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                required
                maxLength={200}
              />
            </Field>
            <Field label="Loại phim">
              <select
                value={form.kind}
                disabled={!!id}
                onChange={(e) => field("kind", e.target.value)}
              >
                <option value="MOVIE">Phim lẻ</option>
                <option value="SERIES">Phim bộ</option>
              </select>
            </Field>
            <Field label="Năm phát hành">
              <input
                type="number"
                value={form.releaseYear}
                onChange={(e) => field("releaseYear", e.target.value)}
                min={1888}
                max={2200}
              />
            </Field>
            <Field label="Phân loại độ tuổi">
              <input
                value={form.ageRating}
                onChange={(e) => field("ageRating", e.target.value)}
                placeholder="Ví dụ: T13, T16, T18"
                maxLength={20}
              />
            </Field>
          </div>
          <Field label="Giới thiệu">
            <textarea
              value={form.synopsis}
              onChange={(e) => field("synopsis", e.target.value)}
              rows={4}
              maxLength={20000}
              placeholder="Một vài dòng giúp người xem hiểu câu chuyện…"
            />
          </Field>
          <Field label="Thể loại" group>
            <span className="check-list">
              {genres.data?.data.map((g) => (
                <label key={g.id}>
                  <input
                    type="checkbox"
                    checked={form.genreIds.includes(g.id)}
                    onChange={(e) =>
                      field(
                        "genreIds",
                        e.target.checked
                          ? [...form.genreIds, g.id]
                          : form.genreIds.filter((value) => value !== g.id),
                      )
                    }
                  />
                  {g.name}
                </label>
              ))}
              {genres.data?.data.length === 0 && (
                <span className="muted">
                  Chưa có thể loại. Thêm tại mục Thể loại.
                </span>
              )}
            </span>
          </Field>
          <div className="form-grid">
            <Field
              label="Ảnh poster"
              hint="Mã ảnh đã có trong kho Cloudinary, không nhập URL."
            >
              <input
                value={form.posterAssetRef}
                onChange={(e) => field("posterAssetRef", e.target.value)}
                maxLength={500}
              />
            </Field>
            <Field label="Ảnh nền" hint="Có thể bổ sung sau.">
              <input
                value={form.backdropAssetRef}
                onChange={(e) => field("backdropAssetRef", e.target.value)}
                maxLength={500}
              />
            </Field>
          </div>
          {auth.can("catalog.write") && (
            <button className="button" disabled={busy}>
              <Save size={16} />
              {busy ? "Đang lưu…" : id ? "Lưu thay đổi" : "Tạo phim"}
            </button>
          )}
        </fieldset>
      </form>
      {id && loaded && <TitleEpisodes key={id} title={loaded} />}
    </>
  );
}
function TitleEpisodes({ title }: { title: Row }) {
  const auth = useAuth(),
    notice = useNotice(),
    seasons = usePages("/admin/titles/" + title.id + "/seasons?limit=100");
  const [season, setSeason] = useState(""),
    [selected, setSelected] = useState(""),
    [creating, setCreating] = useState<"season" | "episode" | null>(null),
    [name, setName] = useState(""),
    [number, setNumber] = useState(1),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false);
  const episodes = usePages(
    season ? "/admin/seasons/" + season + "/episodes?limit=100" : null,
  );
  useEffect(() => {
    setSeason((current) =>
      seasons.rows.some((s) => s.id === current)
        ? current
        : seasons.rows[0]?.id || "",
    );
  }, [seasons.rows]);
  useEffect(() => {
    setSelected("");
    setCreating(null);
  }, [season]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (creating === "season") {
        const result = await api("/admin/titles/" + title.id + "/seasons", {
          method: "POST",
          body: { number, name: name || undefined },
        });
        seasons.reload();
        setSeason(result.data.id);
      } else {
        const result = await api("/admin/seasons/" + season + "/episodes", {
          method: "POST",
          body: { number, name },
        });
        episodes.reload();
        setSelected(result.data.id);
      }
      setCreating(null);
      setName("");
      notice("Đã thêm " + (creating === "season" ? "mùa phim." : "tập phim."));
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="film-episodes" className="panel episodes-admin">
      <div className="section-heading">
        <div>
          <h2>Tập phim & video</h2>
          <p className="muted">
            Chọn tập, tải video và xuất bản khi đã sẵn sàng.
          </p>
        </div>
        {auth.can("catalog.write") && title.kind === "SERIES" && (
          <button
            className="button secondary small"
            onClick={() => {
              setSelected("");
              setCreating("season");
              setNumber((seasons.rows.length || 0) + 1);
              setName("");
            }}
          >
            <Plus size={15} />
            Thêm mùa
          </button>
        )}
      </div>
      <ErrorBox
        error={seasons.error || episodes.error || error}
        onRetry={() => {
          seasons.reload();
          episodes.reload();
        }}
      />
      {(seasons.rows.length || 0) > 0 && (
        <div className="episode-toolbar">
          <select
            aria-label="Mùa phim quản trị"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            {seasons.rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number === 0 ? "Phim đầy đủ" : s.name || "Mùa " + s.number}
              </option>
            ))}
          </select>
          {auth.can("catalog.write") && title.kind === "SERIES" && (
            <button
              className="button secondary small"
              onClick={() => {
                setSelected("");
                setCreating("episode");
                setNumber((episodes.rows.length || 0) + 1);
                setName("");
              }}
            >
              <Plus size={15} />
              Thêm tập
            </button>
          )}
        </div>
      )}
      {creating && (
        <form
          className="inline-form inset-panel"
          onSubmit={(e) => void create(e)}
        >
          <Field label={creating === "season" ? "Số mùa" : "Số tập"}>
            <input
              type="number"
              min={1}
              value={number}
              onChange={(e) => setNumber(Number(e.target.value))}
              required
            />
          </Field>
          <Field label={creating === "season" ? "Tên mùa" : "Tên tập"}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required={creating === "episode"}
            />
          </Field>
          <div className="button-row">
            <button className="button small" disabled={busy}>
              Thêm
            </button>
            <button
              className="button ghost small"
              type="button"
              onClick={() => setCreating(null)}
            >
              Hủy
            </button>
          </div>
        </form>
      )}
      {episodes.loading || seasons.loading ? (
        <Spinner />
      ) : (
        <div className="admin-episode-grid">
          {episodes.rows.map((e) => (
            <button
              key={e.id}
              className={"admin-episode " + (selected === e.id ? "active" : "")}
              onClick={() => setSelected(e.id)}
            >
              <span className="episode-number">{e.number}</span>
              <span>
                <strong>{e.name}</strong>
                <Badge value={e.publicationStatus} />
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      )}
      {!seasons.loading && !seasons.rows.length && !seasons.error && (
        <Empty
          title="Chưa có mùa phim"
          text="Thêm mùa đầu tiên, sau đó thêm các tập phim."
        />
      )}
      {(episodes.cursor || seasons.cursor) && (
        <div className="button-row">
          {episodes.cursor && (
            <button
              className="button secondary small"
              disabled={episodes.loading}
              onClick={() => void episodes.more()}
            >
              Thêm tập đã có
            </button>
          )}
          {seasons.cursor && (
            <button
              className="button secondary small"
              disabled={seasons.loading}
              onClick={() => void seasons.more()}
            >
              Thêm mùa đã có
            </button>
          )}
        </div>
      )}
      {selected && (
        <EpisodeEditor
          key={selected}
          id={selected}
          onChanged={episodes.reload}
        />
      )}
    </section>
  );
}
function EpisodeEditor({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const auth = useAuth(),
    notice = useNotice(),
    [episode, setEpisode] = useState<Row | null>(null),
    [name, setName] = useState(""),
    [synopsis, setSynopsis] = useState(""),
    [etag, setEtag] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api("/admin/episodes/" + id, { signal: controller.signal })
      .then((r) => {
        setEpisode(r.data);
        setName(r.data.name);
        setSynopsis(r.data.synopsis || "");
        setEtag(r.etag);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(asError(e));
      });
    return () => controller.abort();
  }, [id, revision]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api("/admin/episodes/" + id, {
        method: "PATCH",
        headers: { "If-Match": etag },
        body: { name, synopsis },
      });
      setEpisode(result.data);
      setEtag(result.etag);
      onChanged();
      notice("Đã lưu tập phim.");
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!episode) return;
    const status =
      episode.publicationStatus === "PUBLISHED" ? "UNPUBLISHED" : "PUBLISHED";
    setBusy(true);
    setError(null);
    try {
      const current = await api("/admin/episodes/" + id + "/publication");
      await api("/admin/episodes/" + id + "/publication", {
        method: "PUT",
        headers: { "If-Match": current.etag },
        body: {
          status,
          reason: "Cập nhật trạng thái tập phim từ trang quản trị",
        },
      });
      setRevision((v) => v + 1);
      onChanged();
      notice(
        status === "PUBLISHED" ? "Đã xuất bản tập phim." : "Đã ẩn tập phim.",
      );
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="episode-editor">
      <ErrorBox error={error} onRetry={() => setRevision((v) => v + 1)} />
      {!episode ? (
        <Spinner />
      ) : (
        <>
          <div className="section-heading">
            <h3>
              Tập {episode.number}: {episode.name}
            </h3>
            <Badge value={episode.publicationStatus} />
          </div>
          <form onSubmit={(e) => void save(e)}>
            <fieldset disabled={busy || !auth.can("catalog.write")}>
              <div className="form-grid">
                <Field label="Tên tập">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={300}
                  />
                </Field>
                <Field label="Mô tả tập">
                  <input
                    value={synopsis}
                    onChange={(e) => setSynopsis(e.target.value)}
                    maxLength={20000}
                  />
                </Field>
              </div>
              {auth.can("catalog.write") && (
                <button className="button secondary small" disabled={busy}>
                  <Save size={14} />
                  Lưu thông tin tập
                </button>
              )}
            </fieldset>
          </form>
          <UploadPanel
            episode={episode}
            onUpdated={() => {
              setRevision((v) => v + 1);
              onChanged();
            }}
          />
          {auth.can("catalog.publish") && (
            <div className="publish-episode">
              <p className="muted">
                Tập cần có video đã chọn, xử lý và sao lưu hoàn tất trước khi
                xuất bản.
              </p>
              <button
                className="button small"
                disabled={busy}
                onClick={() => void publish()}
              >
                {episode.publicationStatus === "PUBLISHED" ? (
                  <EyeOff size={15} />
                ) : (
                  <Globe size={15} />
                )}{" "}
                {episode.publicationStatus === "PUBLISHED"
                  ? "Ẩn tập phim"
                  : "Xuất bản tập phim"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
