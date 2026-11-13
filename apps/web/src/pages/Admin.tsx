import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ContactRound,
  PanelsTopLeft,
  Flag,
  Settings,
  Film,
  Users,
  ShieldCheck,
  ScrollText,
  Tags,
  ArrowRight,
  Plus,
  Search,
  RefreshCw,
  LockKeyhole,
  Check,
  ChevronRight,
  ArrowUpRight,
  Menu,
  X,
} from "lucide-react";
import { api, dateLabel, query, type Row, type Page } from "../lib/api";
import { useAuth, useData, usePages, useNotice } from "../lib/state";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  PageHeading,
  Spinner,
  asError,
} from "../components/ui";
import { AdminActions, useAdminAction } from "../features/admin/actions";
export { AdminCatalog, TitleEditor } from "../features/admin/Catalog";
const menu = [
  { to: "/admin", label: "Tổng quan", icon: LayoutDashboard, permission: "" },
  {
    to: "/admin/titles",
    label: "Phim & tập phim",
    icon: Film,
    permission: "catalog.read_drafts",
  },
  {
    to: "/admin/genres",
    label: "Thể loại",
    icon: Tags,
    permission: "catalog.read_drafts",
  },
  {
    to: "/admin/people",
    label: "Diễn viên & đạo diễn",
    icon: ContactRound,
    permission: "catalog.read_drafts",
  },
  {
    to: "/admin/banners",
    label: "Banner trang chủ",
    icon: PanelsTopLeft,
    permission: "catalog.read_drafts",
  },
  {
    to: "/admin/reports",
    label: "Báo lỗi nội dung",
    icon: Flag,
    permission: "reports.read",
  },
  {
    to: "/admin/users",
    label: "Người dùng",
    icon: Users,
    permission: "users.read",
  },
  {
    to: "/admin/roles",
    label: "Vai trò & quyền",
    icon: ShieldCheck,
    permission: "rbac.read",
  },
  {
    to: "/admin/audit-logs",
    label: "Nhật ký hoạt động",
    icon: ScrollText,
    permission: "audit.read",
  },
  {
    to: "/admin/settings",
    label: "Cấu hình website",
    icon: Settings,
    permission: "settings.write",
  },
];
export function AdminLayout() {
  const auth = useAuth(),
    location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  if (!auth.user?.permissions?.length)
    return (
      <Empty
        title="Khu vực quản trị"
        text="Tài khoản của bạn chưa được cấp quyền quản trị."
        action={
          <Link to="/" className="button">
            Về trang chủ
          </Link>
        }
      />
    );
  return (
    <AdminActions>
      <div className="admin-shell">
        <aside className={"admin-sidebar" + (menuOpen ? " menu-open" : "")}>
          <div className="sidebar-heading">
            <p className="eyebrow">KHÔNG GIAN QUẢN TRỊ</p>
            <button
              className="button secondary small admin-menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="admin-navigation"
              onClick={() => setMenuOpen((value) => !value)}
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
              {menuOpen ? "Đóng" : "Danh mục"}
            </button>
          </div>
          <nav aria-label="Quản trị" id="admin-navigation">
            {menu
              .filter((item) => !item.permission || auth.can(item.permission))
              .map((item) => (
                <NavLink end={item.to === "/admin"} key={item.to} to={item.to}>
                  <item.icon size={18} />
                  {item.label}
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="secure-icon">
              <ShieldCheck size={19} />
            </span>
            <strong>{auth.user.displayName}</strong>
            <small>{auth.user.roles?.join(" · ")}</small>
            <Link to="/">
              Mở giao diện người xem <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
        <div className="admin-content">
          <Outlet />
        </div>
      </div>
    </AdminActions>
  );
}
export function AdminHome() {
  const auth = useAuth(),
    stats = useData(auth.can("metrics.read") ? "/admin/metrics/summary" : null);
  const recent = useData<Page>(
    auth.can("catalog.read_drafts") ? "/admin/titles?limit=5" : null,
  );
  return (
    <>
      <PageHeading
        eyebrow="CHÀO MỪNG TRỞ LẠI"
        title="Mọi thứ, trong tầm tay."
        text="Quản lý nội dung và theo dõi hoạt động của kho phim."
        action={
          auth.can("catalog.write") && (
            <Link className="button" to="/admin/titles/new">
              <Plus size={17} />
              Thêm phim
            </Link>
          )
        }
      />
      <ErrorBox error={stats.error} onRetry={stats.reload} />
      {stats.data && (
        <div className="stat-grid">
          {[
            ["titles", "Phim trong kho", Film],
            ["publishedTitles", "Đã xuất bản", Check],
            ["episodes", "Tập phim", LayoutDashboard],
            ["activeUsers", "Người dùng hoạt động", Users],
          ].map(([key, label, Icon]: any) => (
            <article className="stat-card" key={key}>
              <span>
                <Icon size={19} />
              </span>
              <p>{label}</p>
              <strong>
                {Number(stats.data?.[key] || 0).toLocaleString("vi-VN")}
              </strong>
            </article>
          ))}
        </div>
      )}
      <section className="admin-shortcuts" aria-label="Thao tác quản trị nhanh">
        {[
          {
            to: "/admin/titles",
            title: "Kho phim",
            text: "Thông tin, tập và video",
            icon: Film,
            permission: "catalog.read_drafts",
          },
          {
            to: "/admin/people",
            title: "Nhân vật",
            text: "Diễn viên và đạo diễn",
            icon: ContactRound,
            permission: "catalog.read_drafts",
          },
          {
            to: "/admin/banners",
            title: "Banner",
            text: "Ảnh giới thiệu và lịch hiển thị",
            icon: PanelsTopLeft,
            permission: "catalog.read_drafts",
          },
          {
            to: "/admin/reports",
            title: "Báo lỗi nội dung",
            text: stats.data
              ? stats.data.openReports + " phản hồi đang mở"
              : "Đọc phản hồi của người xem",
            icon: Flag,
            permission: "reports.read",
          },
        ]
          .filter((item) => auth.can(item.permission))
          .map((item) => (
            <Link className="admin-shortcut" to={item.to} key={item.to}>
              <span>
                <item.icon size={22} />
              </span>
              <div>
                <h2>{item.title}</h2>
                <p>{item.text}</p>
              </div>
              <ArrowUpRight size={16} />
            </Link>
          ))}
      </section>
      <section className="panel onboarding">
        <div>
          <p className="eyebrow">TỪ Ý TƯỞNG ĐẾN MÀN ẢNH</p>
          <h2>Đưa bộ phim tiếp theo lên sóng.</h2>
          <p className="muted">
            Một luồng thao tác rõ ràng để nội dung đến với người xem.
          </p>
        </div>
        <ol>
          <li>
            <span>1</span>
            <div>
              <strong>Tạo phim & tập</strong>
              <small>Thông tin, thể loại và mô tả.</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Tải video</strong>
              <small>Chờ video xử lý và sao lưu.</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Kiểm tra & xuất bản</strong>
              <small>Chọn video và mở cho người xem.</small>
            </div>
          </li>
        </ol>
      </section>
      {recent.data && (
        <section className="panel">
          <div className="section-heading">
            <h2>Phim thêm gần đây</h2>
            <Link to="/admin/titles" className="text-link">
              Tất cả phim <ArrowRight size={15} />
            </Link>
          </div>
          {recent.data.data.length ? (
            <div className="simple-list">
              {recent.data.data.map((row) => (
                <Link key={row.id} to={"/admin/titles/" + row.id}>
                  <span className="list-symbol">
                    <Film size={19} />
                  </span>
                  <div>
                    <strong>{row.localizedTitle}</strong>
                    <small>
                      {row.kind === "MOVIE" ? "Phim lẻ" : "Phim bộ"} ·{" "}
                      {row.releaseYear || "Chưa có năm"}
                    </small>
                  </div>
                  <Badge value={row.publicationStatus} />
                  <ChevronRight size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="Bắt đầu với bộ phim đầu tiên"
              text="Tạo thông tin phim, thêm video và xuất bản khi đã sẵn sàng."
            />
          )}
          <ErrorBox error={recent.error} onRetry={recent.reload} />
        </section>
      )}
    </>
  );
}
function More({ page }: { page: ReturnType<typeof usePages> }) {
  return page.cursor ? (
    <div className="load-more">
      <button
        className="button secondary small"
        disabled={page.loading}
        onClick={() => void page.more()}
      >
        Xem thêm
      </button>
    </div>
  ) : null;
}
export function AdminUsers() {
  const auth = useAuth(),
    notify = useNotice(),
    run = useAdminAction(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [roles, setRoles] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const data = usePages("/admin/users?" + query({ q: search, limit: 20 }));
  async function edit(row: Row) {
    setError(null);
    try {
      const current = await api("/admin/users/" + row.id + "/roles");
      setSelected({ ...row, etag: current.etag });
      setRoles(current.data.roles);
      setReason("");
    } catch (e) {
      notify(asError(e).message, "error");
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        api("/admin/users/" + selected.id + "/roles", {
          method: "PUT",
          headers: { "If-Match": selected.etag },
          body: { roles, reason },
        }),
      );
      notify("Đã cập nhật vai trò. Người dùng cần đăng nhập lại.");
      setSelected(null);
      data.reload();
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  async function status(row: Row) {
    const target = row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const why = window.prompt(
      target === "SUSPENDED"
        ? "Lý do tạm khóa tài khoản (ít nhất 3 ký tự):"
        : "Lý do mở lại tài khoản (ít nhất 3 ký tự):",
    );
    if (!why) return;
    if (why.trim().length < 3) {
      notify("Vui lòng nhập lý do ít nhất 3 ký tự.", "error");
      return;
    }
    setBusy(true);
    try {
      const current = await api("/admin/users/" + row.id + "/status");
      await run(() =>
        api("/admin/users/" + row.id + "/status", {
          method: "PUT",
          headers: { "If-Match": current.etag },
          body: { status: target, reason: why.trim() },
        }),
      );
      notify("Đã cập nhật trạng thái tài khoản.");
      data.reload();
    } catch (e) {
      notify(asError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="TÀI KHOẢN"
        title="Người dùng"
        text="Tìm tài khoản, cập nhật trạng thái và phân quyền phù hợp."
      />
      <form
        className="toolbar-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
        }}
      >
        <Search size={18} />
        <input
          aria-label="Tìm người dùng"
          placeholder="Tìm theo tên hoặc email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="button small">Tìm</button>
      </form>
      <ErrorBox error={data.error} onRetry={data.reload} />
      {selected && (
        <section className="panel edit-user">
          <div className="section-heading">
            <h2>Phân quyền: {selected.displayName}</h2>
            <button
              className="button ghost small"
              onClick={() => setSelected(null)}
            >
              Đóng
            </button>
          </div>
          <form onSubmit={(e) => void save(e)}>
            <ErrorBox error={error} />
            <div className="check-list">
              {["MEMBER", "EDITOR", "ADMIN", "SUPER_ADMIN", "AUDITOR"].map(
                (role) => (
                  <label key={role}>
                    <input
                      type="checkbox"
                      checked={roles.includes(role)}
                      onChange={(e) =>
                        setRoles((current) =>
                          e.target.checked
                            ? [...current, role]
                            : current.filter((r) => r !== role),
                        )
                      }
                    />
                    {role}
                  </label>
                ),
              )}
            </div>
            <Field label="Lý do thay đổi">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
                maxLength={500}
              />
            </Field>
            <button className="button small" disabled={busy || !roles.length}>
              Lưu phân quyền
            </button>
          </form>
        </section>
      )}
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
                <th>Người dùng</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.displayName}</strong>
                    <small>{row.emailNormalized}</small>
                  </td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td>{dateLabel(row.createdAt)}</td>
                  <td>
                    <div className="button-row">
                      {auth.can("rbac.assign") && (
                        <button
                          className="button ghost small"
                          disabled={busy}
                          onClick={() => void edit(row)}
                        >
                          <ShieldCheck size={14} />
                          Phân quyền
                        </button>
                      )}
                      {auth.can("users.suspend") &&
                        row.status !== "DELETED" &&
                        row.id !== auth.user?.id && (
                          <button
                            className="button ghost small"
                            disabled={busy}
                            onClick={() => void status(row)}
                          >
                            <LockKeyhole size={14} />
                            {row.status === "ACTIVE" ? "Tạm khóa" : "Mở lại"}
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.loading && <Spinner />}
        {!data.loading && !data.rows.length && (
          <Empty
            title="Không tìm thấy tài khoản"
            text="Thử tìm bằng tên hoặc email khác."
          />
        )}
      </section>
      <More page={data} />
    </>
  );
}
export function AdminRoles() {
  const data = useData<Row[]>("/admin/roles");
  return (
    <>
      <PageHeading
        eyebrow="PHÂN QUYỀN"
        title="Vai trò & quyền"
        text="Quyền quyết định thao tác có thể thực hiện. Gán vai trò tại trang Người dùng."
      />
      <ErrorBox error={data.error} onRetry={data.reload} />
      {data.loading ? (
        <Spinner />
      ) : (
        <div className="role-grid">
          {data.data?.map((role) => (
            <article className="panel role-card" key={role.id}>
              <ShieldCheck size={25} />
              <h2>{role.code}</h2>
              <p className="muted">{role.permissions.length} quyền được cấp</p>
              <ul>
                {role.permissions.length ? (
                  role.permissions.map((permission: string) => (
                    <li key={permission}>
                      <Check size={13} />
                      {permission}
                    </li>
                  ))
                ) : (
                  <li>Quản lý tài khoản và dữ liệu cá nhân.</li>
                )}
              </ul>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function AdminAudit() {
  const [q, setQ] = useState(""),
    [action, setAction] = useState(""),
    [selected, setSelected] = useState<Row | null>(null);
  const data = usePages("/admin/audit-logs?" + query({ action, limit: 20 }));
  return (
    <>
      <PageHeading
        eyebrow="THEO DÕI HOẠT ĐỘNG"
        title="Nhật ký hoạt động"
        text="Lịch sử thay đổi trong 7 ngày gần nhất. Nhật ký chỉ đọc."
      />
      <form
        className="toolbar-search"
        onSubmit={(e) => {
          e.preventDefault();
          setAction(q);
        }}
      >
        <Search size={18} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Lọc hành động"
          placeholder="Tên hành động, ví dụ catalog.title.created"
        />
        <button className="button small">Lọc</button>
      </form>
      <ErrorBox error={data.error} onRetry={data.reload} />
      {selected && (
        <section className="panel">
          <div className="section-heading">
            <h2>Chi tiết hoạt động</h2>
            <button
              className="button ghost small"
              onClick={() => setSelected(null)}
            >
              Đóng
            </button>
          </div>
          <p>
            <strong>{selected.action}</strong> ·{" "}
            {dateLabel(selected.occurredAt)}
          </p>
          {selected.reason && <p>{selected.reason}</p>}
          <pre className="safe-diff">
            {JSON.stringify(selected.safeDiff, null, 2)}
          </pre>
        </section>
      )}
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
                <th>Thời gian</th>
                <th>Hành động</th>
                <th>Vai trò</th>
                <th>Kết quả</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{dateLabel(row.occurredAt)}</td>
                  <td>
                    <strong>{row.action}</strong>
                    <small>{row.resourceType}</small>
                  </td>
                  <td>
                    {row.actorRoleCodesSnapshot?.join(", ") || "Hệ thống"}
                  </td>
                  <td>
                    <Badge value={row.outcome} />
                  </td>
                  <td>
                    <button
                      className="button ghost small"
                      onClick={() => setSelected(row)}
                    >
                      Chi tiết <ChevronRight size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.loading && <Spinner />}
        {!data.loading && !data.rows.length && (
          <Empty
            title="Chưa có hoạt động phù hợp"
            text="Thử bỏ bộ lọc để xem nhật ký gần đây."
          />
        )}
      </section>
      <More page={data} />
    </>
  );
}
export function AdminGenres() {
  const auth = useAuth(),
    notice = useNotice(),
    [name, setName] = useState(""),
    [slug, setSlug] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const data = usePages("/admin/genres?limit=50");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/genres", { method: "POST", body: { name, slug } });
      setName("");
      setSlug("");
      data.reload();
      notice("Đã thêm thể loại.");
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="SẮP XẾP KHO PHIM"
        title="Thể loại"
        text="Giúp người xem dễ dàng tìm những bộ phim phù hợp."
      />
      <ErrorBox error={data.error} onRetry={data.reload} />
      {auth.can("catalog.write") && (
        <form className="panel inline-form" onSubmit={(e) => void submit(e)}>
          <Field label="Tên thể loại">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </Field>
          <Field
            label="Đường dẫn"
            hint="Chữ thường không dấu, nối bằng dấu gạch ngang."
          >
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={100}
            />
          </Field>
          <button className="button" disabled={busy}>
            <Plus size={16} />
            Thêm thể loại
          </button>
          <ErrorBox error={error} />
        </form>
      )}
      <div className="genre-cards">
        {data.rows.map((row) => (
          <div className="panel genre-card" key={row.id}>
            <Tags size={20} />
            <strong>{row.name}</strong>
            <small>{row.slug}</small>
          </div>
        ))}
      </div>
      {data.loading && <Spinner />}
      <More page={data} />
    </>
  );
}
