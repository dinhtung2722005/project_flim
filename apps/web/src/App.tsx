import { useEffect, useRef, lazy, Suspense, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  Bookmark,
  LayoutDashboard,
  LogIn,
  LogOut,
  UserRound,
  ArrowUpRight,
  Search,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "./lib/state";
import { Brand, Empty, Spinner } from "./components/ui";
import { Catalog, TitleDetail, Library, AuthPage, Help } from "./pages/Public";
const WatchPage = lazy(() =>
  import("./pages/Watch").then((m) => ({ default: m.WatchPage })),
);
const AdminLayout = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.AdminLayout })),
);
const AdminCatalog = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.AdminCatalog })),
);
const TitleEditor = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.TitleEditor })),
);
const AdminUsers = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.AdminUsers })),
);
const AdminRoles = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.AdminRoles })),
);
const AdminAudit = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.AdminAudit })),
);
const AdminGenres = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.AdminGenres })),
);
const AdminHome = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.AdminHome })),
);
const AdminPeople = lazy(() =>
  import("./features/admin/People").then((m) => ({ default: m.AdminPeople })),
);
const AdminBanners = lazy(() =>
  import("./features/admin/Banners").then((m) => ({ default: m.AdminBanners })),
);
const AdminSettings = lazy(() =>
  import("./features/admin/Settings").then((m) => ({
    default: m.AdminSettings,
  })),
);
const AdminReports = lazy(() =>
  import("./features/admin/Reports").then((m) => ({ default: m.AdminReports })),
);
export function RequireAuth({
  children,
  permission,
}: {
  children: ReactNode;
  permission?: string;
}) {
  const auth = useAuth(),
    location = useLocation();
  if (auth.loading) return <Spinner />;
  if (!auth.user)
    return (
      <Navigate
        to={
          "/login?next=" +
          encodeURIComponent(location.pathname + location.search)
        }
        replace
      />
    );
  if (permission && !auth.can(permission))
    return (
      <Empty
        title="Bạn chưa có quyền truy cập"
        text="Hãy dùng tài khoản được phân quyền phù hợp."
        action={
          <Link className="button" to="/">
            Về trang chủ
          </Link>
        }
      />
    );
  return <>{children}</>;
}
export default function App() {
  const auth = useAuth(),
    location = useLocation(),
    admin = location.pathname.startsWith("/admin");
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const catalogPage = location.pathname === "/";
  const kind = new URLSearchParams(location.search).get("kind");
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        accountMenu.current &&
        !accountMenu.current.contains(event.target as Node)
      )
        accountMenu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && accountMenu.current?.open) {
        accountMenu.current.open = false;
        accountMenu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const staff = !!auth.user?.permissions?.some((p: string) =>
    ["catalog.read_drafts", "users.read", "audit.read", "rbac.read"].includes(
      p,
    ),
  );
  useEffect(() => {
    document
      .querySelectorAll<HTMLDetailsElement>(".account-menu")
      .forEach((el) => (el.open = false));
    if (!location.hash) window.scrollTo(0, 0);
    document.title = admin
      ? "Quản trị — pj-Flim"
      : "pj-Flim — Phim hay, thật gần.";
  }, [location.pathname, location.hash, admin]);
  return (
    <>
      <a className="skip-link" href="#main-content">
        Đến nội dung chính
      </a>
      <header className={"site-header" + (admin ? " admin-header" : "")}>
        <div className="header-inner">
          <Brand />
          <nav aria-label="Điều hướng chính">
            <Link
              to="/"
              className={catalogPage && !kind ? "selected" : ""}
              aria-current={catalogPage && !kind ? "page" : undefined}
            >
              Khám phá
            </Link>
            <Link
              to="/?kind=MOVIE"
              className={catalogPage && kind === "MOVIE" ? "selected" : ""}
              aria-current={
                catalogPage && kind === "MOVIE" ? "page" : undefined
              }
            >
              Phim lẻ
            </Link>
            <Link
              to="/?kind=SERIES"
              className={catalogPage && kind === "SERIES" ? "selected" : ""}
              aria-current={
                catalogPage && kind === "SERIES" ? "page" : undefined
              }
            >
              Phim bộ
            </Link>
          </nav>
          <div className="header-actions">
            <Link
              className="icon-link header-search-link"
              to="/#tim-phim"
              aria-label="Tìm phim trong kho"
              title="Tìm phim"
            >
              <Search size={20} />
            </Link>
            <Link
              className="icon-link library-link"
              to="/library"
              title="Thư viện của tôi"
              aria-label="Thư viện của tôi"
            >
              <Bookmark size={19} />
              <span className="library-label">Thư viện</span>
            </Link>
            {auth.loading ? (
              <span className="muted">…</span>
            ) : auth.user ? (
              <details className="account-menu" ref={accountMenu}>
                <summary>
                  <span className="avatar">
                    {String(auth.user.displayName || "P").slice(0, 1)}
                  </span>
                  <span className="account-name">{auth.user.displayName}</span>
                  <ChevronDown size={15} />
                </summary>
                <div className="dropdown">
                  <strong>{auth.user.displayName}</strong>
                  <small>{auth.user.emailNormalized}</small>
                  <Link to="/library">
                    <Bookmark size={16} />
                    Thư viện của tôi
                  </Link>
                  {staff && (
                    <Link to="/admin">
                      <LayoutDashboard size={16} />
                      Trang quản trị
                    </Link>
                  )}
                  <button onClick={() => void auth.logout()}>
                    <LogOut size={16} />
                    Đăng xuất
                  </button>
                </div>
              </details>
            ) : (
              <Link className="button small" to="/login">
                <LogIn size={16} />
                Đăng nhập
              </Link>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" className={admin ? "admin-main" : "public-main"}>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<Catalog />} />
            <Route path="/titles/:id" element={<TitleDetail />} />
            <Route path="/watch/:id" element={<WatchPage />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/register" element={<AuthPage register />} />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <Library />
                </RequireAuth>
              }
            />
            <Route path="/help" element={<Help />} />
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <AdminLayout />
                </RequireAuth>
              }
            >
              <Route index element={<AdminHome />} />
              <Route
                path="titles"
                element={
                  <RequireAuth permission="catalog.read_drafts">
                    <AdminCatalog />
                  </RequireAuth>
                }
              />
              <Route
                path="titles/new"
                element={
                  <RequireAuth permission="catalog.write">
                    <TitleEditor />
                  </RequireAuth>
                }
              />
              <Route
                path="titles/:id"
                element={
                  <RequireAuth permission="catalog.read_drafts">
                    <TitleEditor />
                  </RequireAuth>
                }
              />
              <Route
                path="users"
                element={
                  <RequireAuth permission="users.read">
                    <AdminUsers />
                  </RequireAuth>
                }
              />
              <Route
                path="roles"
                element={
                  <RequireAuth permission="rbac.read">
                    <AdminRoles />
                  </RequireAuth>
                }
              />
              <Route
                path="audit-logs"
                element={
                  <RequireAuth permission="audit.read">
                    <AdminAudit />
                  </RequireAuth>
                }
              />
              <Route
                path="people"
                element={
                  <RequireAuth permission="catalog.read_drafts">
                    <AdminPeople />
                  </RequireAuth>
                }
              />
              <Route
                path="banners"
                element={
                  <RequireAuth permission="catalog.read_drafts">
                    <AdminBanners />
                  </RequireAuth>
                }
              />
              <Route
                path="settings"
                element={
                  <RequireAuth permission="settings.write">
                    <AdminSettings />
                  </RequireAuth>
                }
              />
              <Route
                path="reports"
                element={
                  <RequireAuth permission="reports.read">
                    <AdminReports />
                  </RequireAuth>
                }
              />
              <Route
                path="genres"
                element={
                  <RequireAuth permission="catalog.read_drafts">
                    <AdminGenres />
                  </RequireAuth>
                }
              />
            </Route>
            <Route
              path="*"
              element={
                <Empty
                  title="Không tìm thấy trang"
                  text="Đường dẫn này không tồn tại. Hãy quay lại kho phim."
                  action={
                    <Link className="button" to="/">
                      Khám phá phim
                    </Link>
                  }
                />
              }
            />
          </Routes>
        </Suspense>
      </main>
      {!admin && (
        <footer className="site-footer">
          <Brand />
          <p>Phim hay, thật gần.</p>
          <div>
            <Link to="/help">Hướng dẫn sử dụng</Link>
            {staff && (
              <Link to="/admin">
                Quản trị <ArrowUpRight size={14} />
              </Link>
            )}
          </div>
          <small>© {new Date().getFullYear()} pj-Flim</small>
        </footer>
      )}
    </>
  );
}
