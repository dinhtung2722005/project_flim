import {
  useId,
  useState,
  Children,
  isValidElement,
  cloneElement,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  Clapperboard,
  Play,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Film,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { ApiError, poster, statusLabel, type Row } from "../lib/api";
export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="pj-Flim — Trang chủ">
      <span className="brand-icon">
        <Play size={18} fill="currentColor" />
      </span>
      <span>
        pj-Flim<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
export function Spinner({ label = "Đang tải…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorBox({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <div>
        <strong>{error.message || "Không thể tải nội dung."}</strong>
        {error instanceof ApiError && error.fields.length > 0 && (
          <ul>
            {error.fields.slice(0, 5).map((f, i) => (
              <li key={i}>
                Kiểm tra trường{" "}
                {String(f.pointer || "")
                  .split("/")
                  .pop()}
                .
              </li>
            ))}
          </ul>
        )}
        {error instanceof ApiError && error.requestId && (
          <details>
            <summary>Mã hỗ trợ</summary>
            <small>{error.requestId}</small>
          </details>
        )}
      </div>
      {onRetry && (
        <button className="button ghost small" onClick={onRetry}>
          <RefreshCw size={15} />
          Thử lại
        </button>
      )}
    </div>
  );
}
export function Empty({
  title = "Chưa có nội dung",
  text,
  action,
}: {
  title?: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Clapperboard size={36} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Badge({ value }: { value?: string }) {
  return (
    <span
      className={
        "badge " +
        (value === "PUBLISHED" ||
        value === "READY" ||
        value === "VERIFIED" ||
        value === "SUCCEEDED" ||
        value === "ACTIVE"
          ? "good"
          : value === "FAILED" || value === "SUSPENDED"
            ? "bad"
            : "")
      }
    >
      {statusLabel[value || ""] || value || "—"}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow?: string;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {text && <p className="muted">{text}</p>}
      </div>
      {action}
    </div>
  );
}
export function MovieCard({ movie }: { movie: Row }) {
  const image = poster(movie.posterAssetRef);
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <Link className="movie-card" to={"/titles/" + (movie.titleId || movie.id)}>
      <div className="poster">
        {image && !imageFailed ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="poster-placeholder">
            <Film size={34} />
            <span>{movie.localizedTitle?.slice(0, 1) || "P"}</span>
          </div>
        )}
        <span className="poster-kind">
          {movie.kind === "SERIES" ? "PHIM BỘ" : "PHIM LẺ"}
        </span>
        <span className="card-play">
          <Play size={25} fill="currentColor" />
        </span>
      </div>
      <h3 title={movie.localizedTitle}>{movie.localizedTitle}</h3>
      <p>
        {movie.releaseYear || "Chưa cập nhật"}
        <span>·</span>
        {movie.ageRating || "Chưa phân loại"}
        <ChevronRight size={14} />
      </p>
    </Link>
  );
}
export function Grid({ movies }: { movies: Row[] }) {
  return (
    <div className="movie-grid">
      {movies.map((movie, index) => (
        <MovieCard movie={movie} key={movie.id || index} />
      ))}
    </div>
  );
}
export function SectionHeading({
  title,
  link,
}: {
  title: string;
  link?: string;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {link && (
        <Link className="text-link" to={link}>
          Xem tất cả <ArrowRight size={15} />
        </Link>
      )}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  group = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  group?: boolean;
}) {
  const id = useId();
  let assigned = false;
  function bind(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (
        !isValidElement<{
          children?: ReactNode;
          id?: string;
          "aria-describedby"?: string;
        }>(node)
      )
        return node;
      if (
        !assigned &&
        typeof node.type === "string" &&
        ["input", "select", "textarea"].includes(node.type)
      ) {
        assigned = true;
        return cloneElement(node, {
          id,
          "aria-describedby": hint ? id + "-hint" : undefined,
        });
      }
      if (node.props.children)
        return cloneElement(node, { children: bind(node.props.children) });
      return node;
    });
  }
  return (
    <div className="field">
      {group ? (
        <div role="group" aria-labelledby={id}>
          <span id={id}>{label}</span>
          {children}
        </div>
      ) : (
        <>
          <label htmlFor={id}>{label}</label>
          {bind(children)}
        </>
      )}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export const asError = (e: unknown) =>
  e instanceof Error ? e : new Error("Không thể hoàn tất thao tác.");
