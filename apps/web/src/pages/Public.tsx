import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  Play,
  Bookmark,
  Check,
  ArrowLeft,
  Clapperboard,
  ShieldCheck,
  MonitorPlay,
  Clock3,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  api,
  query,
  poster,
  type Row,
  type Page,
  type Result,
} from "../lib/api";
import { useAuth, useData, usePages, useNotice } from "../lib/state";
import { LiveSearch } from "../components/LiveSearch";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  Grid,
  PageHeading,
  SectionHeading,
  Spinner,
  asError,
} from "../components/ui";
export function Catalog() {
  const [params, setParams] = useSearchParams(),
    [term, setTerm] = useState(params.get("q") || "");
  const searchInput = useRef<HTMLInputElement>(null),
    location = useLocation();
  useEffect(() => {
    if (location.hash === "#tim-phim") searchInput.current?.focus();
  }, [location.hash, location.key]);
  const path =
    "/titles?" +
    query({
      q: params.get("q"),
      kind: params.get("kind"),
      genre: params.get("genre"),
      sort: params.get("sort") || "newest",
      limit: 24,
    });
  const films = usePages(path),
    genres = useData<Page>("/genres?limit=50");
  const featured = films.rows[0],
    backdrop = poster(featured?.backdropAssetRef, 1600);
  const filtered = !!(
    params.get("q") ||
    params.get("kind") ||
    params.get("genre")
  );
  useEffect(() => setTerm(params.get("q") || ""), [params.get("q")]);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }
  return (
    <>
      <section
        className={"hero catalog-hero " + (filtered ? "compact" : "")}
        style={
          backdrop
            ? {
                backgroundImage:
                  "linear-gradient(90deg,rgba(8,15,18,.98),rgba(8,15,18,.65)),url(" +
                  backdrop +
                  ")",
              }
            : undefined
        }
      >
        <div className="hero-content">
          <p className="eyebrow">
            <span className="live-dot" />
            BỘ PHIM TIẾP THEO CỦA BẠN
          </p>
          <h1>
            {featured && !filtered ? (
              <>
                {featured.localizedTitle}
                <span className="accent">.</span>
              </>
            ) : (
              <>
                Tối nay,
                <br />
                mình xem <span className="accent">gì?</span>
              </>
            )}
          </h1>
          <p className="hero-copy">
            {featured && !filtered
              ? featured.synopsis ||
                "Một câu chuyện mới đang chờ bạn. Chọn tập phim và bắt đầu thưởng thức."
              : "Tìm một câu chuyện bạn thích, lưu lại những bộ phim hay và tiếp tục xem bất cứ khi nào."}
          </p>
          {featured && !filtered && (
            <Link className="button" to={"/titles/" + featured.id}>
              <Play size={18} fill="currentColor" />
              Khám phá bộ phim
              <ArrowRight size={17} />
            </Link>
          )}
          <div className="hero-notes">
            <span>
              <MonitorPlay size={15} />
              Xem theo cách của bạn
            </span>
            <span>
              <Bookmark size={15} />
              Lưu phim yêu thích
            </span>
          </div>
        </div>
        {featured && !filtered && (
          <Link
            className="featured-preview"
            to={"/titles/" + featured.id}
            aria-label={"Xem chi tiết " + featured.localizedTitle}
          >
            <div className="featured-cover">
              {poster(featured.posterAssetRef, 500) ? (
                <img src={poster(featured.posterAssetRef, 500)} alt="" />
              ) : (
                <>
                  <Clapperboard size={46} />
                  <span>{featured.localizedTitle}</span>
                </>
              )}
              <span className="featured-play">
                <Play size={25} fill="currentColor" />
              </span>
            </div>
            <div className="featured-caption">
              <span>MỚI TRONG KHO</span>
              <strong>{featured.localizedTitle}</strong>
              <small>
                {featured.kind === "SERIES" ? "Phim bộ" : "Phim lẻ"}
                {featured.releaseYear ? " · " + featured.releaseYear : ""}
              </small>
            </div>
          </Link>
        )}
      </section>
      <section className="content-section catalog-content">
        <LiveSearch
          value={term}
          onChange={setTerm}
          onSearch={(value) => filter("q", value)}
          inputRef={searchInput}
          kind={params.get("kind") || ""}
          genre={params.get("genre") || ""}
          sort={params.get("sort") || "newest"}
        />
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">CHỌN PHIM, BẤM XEM</p>
            <h2>
              {params.get("q")
                ? "Kết quả cho “" + params.get("q") + "”"
                : "Khám phá kho phim"}
            </h2>
          </div>
          <select
            aria-label="Sắp xếp phim"
            value={params.get("sort") || "newest"}
            onChange={(e) => filter("sort", e.target.value)}
          >
            <option value="newest">Mới cập nhật</option>
            <option value="oldest">Cũ hơn trước</option>
          </select>
        </div>
        <div className="filter-bar">
          <div className="pills" aria-label="Loại phim">
            {[
              ["", "Tất cả"],
              ["MOVIE", "Phim lẻ"],
              ["SERIES", "Phim bộ"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={(params.get("kind") || "") === value ? "active" : ""}
                aria-pressed={(params.get("kind") || "") === value}
                onClick={() => filter("kind", value)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label="Thể loại"
            value={params.get("genre") || ""}
            onChange={(e) => filter("genre", e.target.value)}
          >
            <option value="">Tất cả thể loại</option>
            {genres.data?.data.map((g) => (
              <option key={g.id} value={g.slug}>
                {g.name}
              </option>
            ))}
          </select>
          {filtered && (
            <button className="text-link" onClick={() => setParams({})}>
              Xóa bộ lọc
            </button>
          )}
        </div>
        {!films.loading && !films.error && (
          <p className="catalog-result-count" role="status">
            {films.rows.length
              ? "Đang hiển thị " + films.rows.length + " phim"
              : "Chưa có phim phù hợp"}
            {params.get("q") ? " cho “" + params.get("q") + "”" : ""}
          </p>
        )}
        <ErrorBox error={films.error} onRetry={films.reload} />
        {films.rows.length > 0 ? (
          <Grid movies={films.rows} />
        ) : films.loading ? (
          <div className="skeleton-grid" aria-label="Đang tải phim">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="skeleton" key={i} />
            ))}
          </div>
        ) : (
          !films.error && (
            <Empty
              title={
                filtered
                  ? "Chưa tìm thấy phim phù hợp"
                  : "Những câu chuyện hay đang được chuẩn bị"
              }
              text={
                filtered
                  ? "Thử tên phim khác hoặc bỏ bớt bộ lọc để khám phá thêm."
                  : "Kho phim sẽ xuất hiện ở đây khi nội dung sẵn sàng. Bạn có thể quay lại sau."
              }
              action={
                filtered ? (
                  <button
                    className="button secondary"
                    onClick={() => setParams({})}
                  >
                    Xem tất cả phim
                  </button>
                ) : (
                  <Link className="button secondary" to="/help">
                    Tìm hiểu cách sử dụng <ArrowRight size={16} />
                  </Link>
                )
              }
            />
          )
        )}{" "}
        {films.cursor && (
          <div className="load-more">
            <button
              className="button secondary"
              disabled={films.loading}
              onClick={() => void films.more()}
            >
              {films.loading ? "Đang tải…" : "Xem thêm phim"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
export function TitleDetail() {
  const { id } = useParams(),
    auth = useAuth(),
    notify = useNotice(),
    nav = useNavigate();
  const title = useData("/titles/" + id),
    seasons = usePages("/titles/" + id + "/seasons?limit=100");
  const [season, setSeason] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const episodes = usePages(
    season ? "/seasons/" + season + "/episodes?limit=100" : null,
  );
  const related = useData<Page>(
    id ? "/titles/" + id + "/recommendations?limit=6" : null,
  );
  useEffect(() => {
    setSeason((current) =>
      seasons.rows.some((s) => s.id === current)
        ? current
        : seasons.rows[0]?.id || "",
    );
  }, [seasons.rows]);
  useEffect(() => {
    setSaved(false);
    if (!auth.user) return;
    const controller = new AbortController();
    async function find() {
      let cursor: string | null = null;
      do {
        const r: Result<Page> = await api<Page>(
          "/me/watchlist?limit=100" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (r.data.data.some((row) => (row.titleId || row.id) === id)) {
          setSaved(true);
          return;
        }
        cursor = r.data.page.nextCursor;
      } while (cursor && !controller.signal.aborted);
    }
    void find().catch(() => {});
    return () => controller.abort();
  }, [id, auth.user?.id]);
  async function save() {
    if (!auth.user) {
      nav("/login?next=" + encodeURIComponent("/titles/" + id));
      return;
    }
    setSaving(true);
    try {
      await api("/me/watchlist/" + id, { method: saved ? "DELETE" : "PUT" });
      setSaved(!saved);
      notify(
        saved ? "Đã bỏ khỏi danh sách." : "Đã thêm vào danh sách yêu thích.",
      );
    } catch (e) {
      notify(asError(e).message, "error");
    } finally {
      setSaving(false);
    }
  }
  if (title.loading) return <Spinner />;
  if (title.error)
    return (
      <div className="container">
        <ErrorBox error={title.error} onRetry={title.reload} />
        <Link to="/" className="text-link">
          <ArrowLeft size={16} />
          Về kho phim
        </Link>
      </div>
    );
  if (!title.data) return null;
  const movie = title.data,
    image = poster(movie.posterAssetRef, 700);
  return (
    <div className="container">
      <Link className="back-link" to="/">
        <ArrowLeft size={16} />
        Khám phá phim
      </Link>
      <section className="detail-hero">
        <div className="detail-poster">
          {image ? (
            <img src={image} alt={"Poster " + movie.localizedTitle} />
          ) : (
            <div className="detail-fallback">
              <Clapperboard size={60} />
              <strong>{movie.localizedTitle}</strong>
            </div>
          )}
        </div>
        <div className="detail-info">
          <p className="eyebrow">
            {movie.kind === "SERIES"
              ? "MỘT CÂU CHUYỆN, NHIỀU TẬP"
              : "DÀNH THỜI GIAN CHO ĐIỆN ẢNH"}
          </p>
          <h1>{movie.localizedTitle}</h1>
          {movie.originalTitle && (
            <p className="original-title">{movie.originalTitle}</p>
          )}
          <div className="meta-row">
            <Badge value={movie.kind} />
            {movie.releaseYear && <span>{movie.releaseYear}</span>}
            {movie.ageRating && <span>{movie.ageRating}</span>}
            {movie.originalLanguage && (
              <span>{movie.originalLanguage.toUpperCase()}</span>
            )}
          </div>
          <div className="genre-list">
            {movie.genres?.map((g: Row) => (
              <Link key={g.id} to={"/?genre=" + g.slug}>
                {g.name}
              </Link>
            ))}
          </div>
          <p className="synopsis">
            {movie.synopsis || "Nội dung giới thiệu đang được cập nhật."}
          </p>
          <div className="button-row">
            {episodes.rows[0] ? (
              <Link className="button" to={"/watch/" + episodes.rows[0].id}>
                <Play size={17} fill="currentColor" />
                Xem ngay
              </Link>
            ) : (
              <button className="button" disabled>
                Chưa có tập khả dụng
              </button>
            )}
            <button
              className="button secondary"
              disabled={saving || auth.loading}
              onClick={() => void save()}
            >
              {saved ? <Check size={18} /> : <Bookmark size={18} />}{" "}
              {saved ? "Đã lưu" : "Lưu yêu thích"}
            </button>
          </div>
          {movie.credits?.length > 0 && (
            <div className="cast">
              <span className="muted">Có sự góp mặt của</span>
              <p>{movie.credits.map((p: Row) => p.name).join(", ")}</p>
            </div>
          )}
        </div>
      </section>
      <section className="panel episodes-panel">
        <div className="section-heading">
          <h2>Danh sách tập</h2>
          {(seasons.rows.length || 0) > 1 && (
            <select
              aria-label="Chọn mùa phim"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
            >
              {seasons.rows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number === 0 ? "Phim đầy đủ" : s.name || "Mùa " + s.number}
                </option>
              ))}
            </select>
          )}
        </div>
        <ErrorBox
          error={seasons.error || episodes.error}
          onRetry={() => {
            seasons.reload();
            episodes.reload();
          }}
        />
        {seasons.loading || episodes.loading ? (
          <Spinner />
        ) : episodes.rows.length ? (
          <div className="episode-grid">
            {episodes.rows.map((e) => (
              <Link to={"/watch/" + e.id} className="episode-item" key={e.id}>
                <span className="episode-number">{e.number}</span>
                <div>
                  <strong>{e.name}</strong>
                  <small>
                    {e.durationSeconds
                      ? Math.ceil(Number(e.durationSeconds) / 60) + " phút"
                      : "Xem phim"}
                  </small>
                </div>
                <Play size={17} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">Chưa có tập phim để xem.</p>
        )}
        {(episodes.cursor || seasons.cursor) && (
          <div className="button-row">
            {episodes.cursor && (
              <button
                className="button secondary small"
                disabled={episodes.loading}
                onClick={() => void episodes.more()}
              >
                Thêm tập phim
              </button>
            )}
            {seasons.cursor && (
              <button
                className="button secondary small"
                disabled={seasons.loading}
                onClick={() => void seasons.more()}
              >
                Thêm mùa phim
              </button>
            )}
          </div>
        )}
      </section>
      {!!related.data?.data.length && (
        <section className="content-section">
          <SectionHeading title="Có thể bạn cũng thích" />
          <Grid movies={related.data.data} />
        </section>
      )}
    </div>
  );
}
export function Library() {
  const [tab, setTab] = useState("watchlist"),
    { user } = useAuth();
  const data = usePages(user ? "/me/" + tab + "?limit=24" : null);
  return (
    <div className="container">
      <PageHeading
        eyebrow="KHÔNG GIAN RIÊNG CỦA BẠN"
        title="Thư viện của tôi"
        text="Những câu chuyện bạn muốn lưu lại và những thước phim đang xem dở."
      />
      <div className="tabs">
        {[
          ["watchlist", "Yêu thích"],
          ["continue-watching", "Xem tiếp"],
          ["history", "Lịch sử"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox error={data.error} onRetry={data.reload} />
      {data.loading && !data.rows.length ? (
        <Spinner />
      ) : data.rows.length ? (
        tab === "watchlist" ? (
          <Grid movies={data.rows} />
        ) : (
          <div className="list-panel">
            {data.rows.map((row) => (
              <Link
                className="history-item"
                key={row.episodeId || row.id}
                to={
                  row.resumeEligible === false
                    ? "/titles/" + row.titleId
                    : "/watch/" + (row.episodeId || row.id)
                }
              >
                <span className="history-play">
                  <Play size={20} />
                </span>
                <div>
                  <h3>{row.localizedTitle || row.name}</h3>
                  <p>
                    {row.name} · Đã xem{" "}
                    {Math.floor(Number(row.positionSeconds) / 60)} phút
                  </p>
                </div>
                <span className="text-link">
                  {row.resumeEligible === false ? "Xem bản mới" : "Tiếp tục"}
                  <ArrowRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        )
      ) : (
        !data.error && (
          <Empty
            title={
              tab === "watchlist"
                ? "Chưa có phim yêu thích"
                : "Chưa có lịch sử xem"
            }
            text="Chọn một bộ phim để bắt đầu. Những bộ phim của bạn sẽ được lưu tại đây."
            action={
              <Link to="/" className="button secondary">
                Khám phá phim <ArrowRight size={17} />
              </Link>
            }
          />
        )
      )}{" "}
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
    </div>
  );
}
export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth(),
    nav = useNavigate(),
    [params] = useSearchParams();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [visible, setVisible] = useState(false),
    [pending, setPending] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const next = params.get("next") || "/";
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
      ? next
      : "/";
  useEffect(() => {
    if (auth.user) nav(safeNext, { replace: true });
  }, [auth.user, safeNext, nav]);
  useEffect(() => {
    setPending(null);
    setError(null);
    setPassword("");
  }, [register]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let result: Row;
      if (pending) {
        result = (
          await api(
            "/auth/mfa-challenges/" + pending.challengeId + "/verifications",
            {
              method: "POST",
              auth: false,
              headers: { "Idempotency-Key": crypto.randomUUID() },
              body: { challengeToken: pending.challengeToken, code },
            },
          )
        ).data;
      } else {
        if (register)
          await api("/users", {
            method: "POST",
            auth: false,
            body: { email, password, displayName: name },
          });
        result = (
          await api("/auth/sessions", {
            method: "POST",
            auth: false,
            body: { email, password },
          })
        ).data;
        if (result.state === "PENDING_MFA") {
          setPending(result);
          setPassword("");
          return;
        }
      }
      await auth.accept(result);
      setPassword("");
      nav(safeNext, { replace: true });
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-story">
        <p className="eyebrow">PJ-FLIM / DÀNH CHO BẠN</p>
        <h1>
          Mỗi bộ phim,
          <br />
          một cảm xúc <span className="accent">mới.</span>
        </h1>
        <p>Đăng nhập để lưu phim yêu thích và tiếp tục câu chuyện của bạn.</p>
        <div className="auth-benefits">
          <span>
            <Bookmark />
            Lưu những bộ phim muốn xem
          </span>
          <span>
            <Clock3 />
            Xem tiếp từ nơi bạn dừng lại
          </span>
          <span>
            <ShieldCheck />
            Một tài khoản cho không gian riêng
          </span>
        </div>
        <div className="auth-art" aria-hidden="true">
          <Play size={74} fill="currentColor" />
        </div>
      </section>
      <section className="auth-card">
        <Link className="back-link" to="/">
          <ArrowLeft size={16} />
          Về trang chủ
        </Link>
        <h2>
          {pending
            ? "Xác minh tài khoản"
            : register
              ? "Tạo tài khoản"
              : "Chào mừng trở lại"}
        </h2>
        <p className="muted">
          {pending
            ? "Nhập mã từ ứng dụng xác thực hoặc mã khôi phục."
            : register
              ? "Chỉ một vài thông tin để bắt đầu."
              : "Đăng nhập và trở lại với bộ phim của bạn."}
        </p>
        <form onSubmit={(e) => void submit(e)}>
          <ErrorBox error={error} />
          {pending ? (
            <Field label="Mã xác minh">
              <input
                autoFocus
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                required
                maxLength={32}
              />
            </Field>
          ) : (
            <>
              {register && (
                <Field label="Tên hiển thị">
                  <input
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    minLength={1}
                    maxLength={100}
                    required
                  />
                </Field>
              )}
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                  maxLength={254}
                />
              </Field>
              <Field
                label="Mật khẩu"
                hint={register ? "Từ 12 đến 128 ký tự." : undefined}
              >
                <span className="password-field">
                  <input
                    name="password"
                    type={visible ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                    minLength={register ? 12 : 1}
                    maxLength={register ? 128 : 1024}
                    required
                  />
                  <button
                    type="button"
                    aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </Field>
            </>
          )}
          <button className="button full" disabled={busy || auth.loading}>
            {busy
              ? "Đang xử lý…"
              : pending
                ? "Xác minh"
                : register
                  ? "Tạo tài khoản"
                  : "Đăng nhập"}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-switch">
          {register ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
          <Link
            to={
              (register ? "/login" : "/register") +
              "?next=" +
              encodeURIComponent(safeNext)
            }
          >
            {register ? "Đăng nhập" : "Đăng ký miễn phí"}
          </Link>
        </p>
      </section>
    </div>
  );
}
export function Help() {
  return (
    <div className="container narrow">
      <PageHeading
        eyebrow="BẮT ĐẦU THẬT ĐƠN GIẢN"
        title="Bạn muốn xem phim?"
        text="Một vài bước để tìm bộ phim phù hợp và tận hưởng."
      />
      <div className="help-grid">
        {[
          [
            "01",
            "Chọn câu chuyện của bạn",
            "Tìm theo tên, loại phim hoặc thể loại trên trang khám phá.",
          ],
          [
            "02",
            "Bấm xem và thưởng thức",
            "Mở chi tiết phim, chọn tập. Bạn có thể tua, đổi tốc độ và xem toàn màn hình.",
          ],
          [
            "03",
            "Lưu lại để xem sau",
            "Đăng nhập để lưu phim yêu thích và đồng bộ tiến trình xem.",
          ],
        ].map(([n, title, text]) => (
          <article className="panel" key={n}>
            <span className="eyebrow">{n}</span>
            <h2>{title}</h2>
            <p className="muted">{text}</p>
          </article>
        ))}
      </div>
      <Link className="button" to="/">
        Khám phá ngay <ArrowRight size={17} />
      </Link>
    </div>
  );
}
