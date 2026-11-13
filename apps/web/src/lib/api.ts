export type Row = Record<string, any>;
export type Page = {
  data: Row[];
  page: { hasMore: boolean; nextCursor: string | null; limit: number };
};
export type Result<T> = { data: T; etag: string; status: number };
type Session = { accessToken: string; refreshToken: string };
const storeKey = "pj-flim.auth";
let session: Session | null = null;
try {
  session = JSON.parse(sessionStorage.getItem(storeKey) || "null");
} catch {}
let generation = 0;
let renewal: Promise<void> | undefined;
export const hasSession = () => !!session?.accessToken;
export function setSession(value: Session | null) {
  generation++;
  session = value;
  try {
    if (value) sessionStorage.setItem(storeKey, JSON.stringify(value));
    else sessionStorage.removeItem(storeKey);
  } catch {}
}
const messages: Record<string, string> = {
  RECOMMENDATION_FEED_EXPIRED:
    "Danh sách gợi ý đã hết hạn hoặc tùy chọn vừa thay đổi. Hãy làm mới gợi ý.",
  CATALOG_NO_PLAYABLE_EPISODE:
    "Phim chưa có tập đã xuất bản và phát được. Hãy chuẩn bị video, chọn video và xuất bản tập trước.",
  CATALOG_EPISODE_NUMBER_CONFLICT: "Số tập đã tồn tại. Vui lòng chọn số khác.",
  CATALOG_SEASON_NUMBER_CONFLICT: "Số mùa đã tồn tại. Vui lòng chọn số khác.",
  CATALOG_INVALID_PUBLICATION_TRANSITION:
    "Không thể chuyển trạng thái nội dung này. Hãy kiểm tra trạng thái hiện tại.",
  PRECONDITION_REQUIRED: "Hãy tải lại dữ liệu trước khi lưu thay đổi.",
  MEDIA_PROCESSING_ALREADY_ACTIVE:
    "Video đang có lượt xử lý. Hãy chờ hoàn tất trước khi thử lại.",
  AUTH_ACCOUNT_SUSPENDED:
    "Tài khoản đã bị tạm khóa. Vui lòng liên hệ quản trị.",
  AUTH_CHALLENGE_EXPIRED: "Mã yêu cầu xác minh đã hết hạn. Hãy đăng nhập lại.",
  AUTH_INVALID_CREDENTIALS: "Email hoặc mật khẩu chưa đúng.",
  AUTHENTICATION_REQUIRED: "Bạn cần đăng nhập để tiếp tục.",
  AUTH_SESSION_REVOKED: "Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.",
  AUTH_TOKEN_EXPIRED: "Phiên đăng nhập đã hết hạn.",
  AUTH_FORBIDDEN: "Tài khoản của bạn chưa có quyền thực hiện thao tác này.",
  AUTH_MFA_REQUIRED: "Tài khoản này cần xác minh hai bước trước khi tiếp tục.",
  AUTH_MFA_ENROLLMENT_REQUIRED:
    "Tài khoản quản trị cần thiết lập xác minh hai bước.",
  AUTH_MFA_INVALID: "Mã xác minh không đúng hoặc đã được dùng. Hãy thử mã mới.",
  AUTH_STEP_UP_REQUIRED: "Thao tác này cần xác minh lại bằng mã bảo mật.",
  RATE_LIMITED: "Bạn thao tác hơi nhanh. Vui lòng chờ một lát rồi thử lại.",
  RESOURCE_NOT_FOUND:
    "Nội dung không còn khả dụng hoặc bạn chưa được cấp quyền.",
  RESOURCE_VERSION_MISMATCH:
    "Dữ liệu vừa được thay đổi. Hãy tải lại trước khi lưu.",
  VALIDATION_FAILED: "Vui lòng kiểm tra lại thông tin đã nhập.",
  MEDIA_NOT_READY: "Video đang được chuẩn bị. Hãy chờ xử lý hoàn tất.",
  MEDIA_BACKUP_NOT_VERIFIED:
    "Video chưa hoàn tất sao lưu nên chưa thể xuất bản.",
  MEDIA_FILE_LIMIT_EXCEEDED:
    "Video vượt giới hạn dung lượng hoặc thời lượng cho phép.",
  MEDIA_UPLOAD_MISMATCH: "Video chưa khớp với tập phim. Vui lòng kiểm tra lại.",
  MEDIA_PROVIDER_UNAVAILABLE:
    "Kho video tạm thời chưa sẵn sàng. Hãy thử lại sau.",
  MEDIA_ASSET_IN_USE: "Video này đang được sử dụng hoặc đang xử lý.",
  MEDIA_UPLOAD_INTENT_EXPIRED:
    "Phiên tải lên đã hết hạn. Hãy tạo lượt tải mới.",
  PLAYBACK_SESSION_EXPIRED: "Phiên xem đã hết hạn. Hãy mở lại video.",
  PLAYBACK_SESSION_REVOKED: "Phiên xem đã kết thúc.",
  PLAYBACK_CONCURRENCY_LIMIT:
    "Bạn đang mở quá nhiều phiên xem. Hãy đóng một cửa sổ và thử lại.",
  PROGRESS_SESSION_STALE:
    "Tiến trình đang được cập nhật từ một phiên xem mới hơn.",
  PROGRESS_INTERVAL_INVALID:
    "Tiến trình xem chưa được đồng bộ. Video vẫn có thể tiếp tục phát.",
  RBAC_LAST_SUPER_ADMIN:
    "Không thể vô hiệu tài khoản quản trị cao nhất cuối cùng.",
  CATALOG_SLUG_CONFLICT: "Đường dẫn phim đã tồn tại. Hãy chọn đường dẫn khác.",
  ACCOUNT_CONFLICT: "Email này đã được đăng ký.",
  SERVICE_UNAVAILABLE: "Dịch vụ tạm thời gián đoạn. Hãy thử lại sau.",
};
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public fields: Row[] = [],
    public requestId = "",
  ) {
    super(
      messages[code] ||
        (status >= 500
          ? "Dịch vụ tạm thời gián đoạn. Hãy thử lại sau."
          : "Không thể hoàn tất thao tác. Vui lòng kiểm tra dữ liệu và thử lại."),
    );
  }
}
type Options = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  auth?: boolean;
};
async function refresh() {
  if (renewal) return renewal;
  const current = session,
    version = generation;
  if (!current?.refreshToken)
    throw new ApiError("AUTHENTICATION_REQUIRED", 401);
  const key = crypto.randomUUID();
  renewal = (async () => {
    const res = await fetch("/api/v1/auth/token-renewals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new ApiError("AUTH_SESSION_REVOKED", 401);
    const data = await res.json();
    if (version !== generation) throw new ApiError("AUTH_SESSION_REVOKED", 401);
    setSession(data);
  })().finally(() => {
    renewal = undefined;
  });
  return renewal;
}
export async function api<T = Row>(
  path: string,
  options: Options = {},
): Promise<Result<T>> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new Error("Invalid API path");
  const url = path.startsWith("/api/v1/") ? path : "/api/v1" + path;
  async function run(retry: boolean): Promise<Result<T>> {
    const headers = new Headers(options.headers);
    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    if (options.auth !== false && session?.accessToken)
      headers.set("Authorization", "Bearer " + session.accessToken);
    let res: Response;
    try {
      res = await fetch(url, {
        method: options.method || "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        credentials: "omit",
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError("SERVICE_UNAVAILABLE", 503);
    }
    if (
      res.status === 401 &&
      retry &&
      options.auth !== false &&
      session?.refreshToken &&
      !path.startsWith("/auth/")
    ) {
      const previous = session;
      try {
        await refresh();
        return run(false);
      } catch {
        if (session !== previous && session)
          throw new ApiError("AUTH_SESSION_REVOKED", 401);
        setSession(null);
        window.dispatchEvent(new Event("pj-flim:signout"));
        throw new ApiError("AUTH_SESSION_REVOKED", 401);
      }
    }
    const data =
      res.status === 204 ? undefined : await res.json().catch(() => ({}));
    if (!res.ok)
      throw new ApiError(
        data?.code || "REQUEST_FAILED",
        res.status,
        data?.errors || [],
        data?.requestId || "",
      );
    return { data, etag: res.headers.get("etag") || "", status: res.status };
  }
  return run(true);
}
export const query = (values: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.toString();
};
export function poster(ref?: string, width = 480) {
  const cloud = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  if (!ref || !cloud || !/^[a-zA-Z0-9_./-]+$/.test(ref)) return undefined;
  return (
    "https://res.cloudinary.com/" +
    encodeURIComponent(cloud) +
    "/image/upload/f_auto,q_auto,w_" +
    width +
    "/" +
    ref.split("/").map(encodeURIComponent).join("/")
  );
}
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
export const dateLabel = (s?: string) =>
  s
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(s))
    : "—";
export const statusLabel: Record<string, string> = {
  DRAFT: "Bản nháp",
  PUBLISHED: "Đã xuất bản",
  UNPUBLISHED: "Đã ẩn",
  ARCHIVED: "Lưu trữ",
  ACTIVE: "Hoạt động",
  SUSPENDED: "Tạm khóa",
  DELETED: "Đã xóa",
  READY: "Sẵn sàng",
  UPLOADED: "Đã tải lên",
  PROCESSING: "Đang xử lý",
  VERIFIED: "Đã xác minh",
  PENDING: "Đang chờ",
  RUNNING: "Đang thực hiện",
  QUEUED: "Đang chờ",
  SUCCEEDED: "Hoàn tất",
  FAILED: "Thất bại",
  WAITING: "Đang chờ",
  MOVIE: "Phim lẻ",
  SERIES: "Phim bộ",
};
