import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Clapperboard,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { api, poster, query, type Page, type Row } from "../lib/api";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  kind: string;
  genre: string;
  sort: string;
};
type Suggestions = {
  key: string;
  rows: Row[];
  loading: boolean;
  error: boolean;
};

export function LiveSearch({
  value,
  onChange,
  onSearch,
  inputRef,
  kind,
  genre,
  sort,
}: Props) {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(-1);
  const [revision, setRevision] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestions>({
    key: "",
    rows: [],
    loading: false,
    error: false,
  });
  const term = value.trim();
  const eligible = Array.from(term).length >= 2;
  const path = "/titles?" + query({ q: term, kind, genre, sort, limit: 6 });
  const expanded = open && eligible && !composing;
  const current = suggestions.key === path;
  const rows = expanded && current ? suggestions.rows : [];
  const loading = expanded && (!current || suggestions.loading);
  const failed = expanded && current && suggestions.error;
  const selected = active >= 0 && active < rows.length ? active : -1;

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setActive(-1);
    setSuggestions({ key: path, rows: [], loading: true, error: false });
    const timer = window.setTimeout(() => {
      void api<Page>(path, { auth: false, signal: controller.signal })
        .then(({ data }) => {
          if (!controller.signal.aborted)
            setSuggestions({
              key: path,
              rows: data.data,
              loading: false,
              error: false,
            });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setSuggestions({
              key: path,
              rows: [],
              loading: false,
              error: true,
            });
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [expanded, path, revision]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) closeSuggestions();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  useEffect(() => {
    if (expanded && selected >= 0)
      document
        .getElementById(id + "-option-" + selected)
        ?.scrollIntoView({ block: "nearest" });
  }, [expanded, selected, id]);

  function closeSuggestions() {
    setOpen(false);
    setActive(-1);
    setSuggestions({ key: "", rows: [], loading: false, error: false });
  }

  function search() {
    if (composing) return;
    closeSuggestions();
    setActive(-1);
    onSearch(term);
  }

  return (
    <div
      className="live-search"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          closeSuggestions();
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !composing &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          inputRef.current?.focus();
          closeSuggestions();
          setActive(-1);
        }
      }}
    >
      <form
        className="hero-search catalog-search"
        id="tim-phim"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <Search size={21} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Tìm phim"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? id + "-results" : undefined}
          aria-activedescendant={
            expanded && selected >= 0 ? id + "-option-" + selected : undefined
          }
          aria-describedby={id + "-hint"}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Bạn muốn xem phim gì?"
          value={value}
          maxLength={200}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            onChange(event.currentTarget.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (
              composing ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            ) {
              if (event.key === "Enter") event.preventDefault();
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (!eligible) return;
              event.preventDefault();
              setOpen(true);
              if (rows.length)
                setActive((previous) =>
                  event.key === "ArrowDown"
                    ? Math.min(previous + 1, rows.length - 1)
                    : previous <= 0
                      ? rows.length - 1
                      : previous - 1,
                );
            } else if (event.key === "Enter" && expanded && selected >= 0) {
              event.preventDefault();
              closeSuggestions();
              navigate("/titles/" + rows[selected].id);
            } else if (event.key === "Tab") {
              closeSuggestions();
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="clear-search"
            aria-label="Xóa từ khóa"
            onClick={() => {
              onChange("");
              closeSuggestions();
              setActive(-1);
              onSearch("");
              inputRef.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        )}
        <button type="submit" aria-label="Tìm kiếm">
          <Search size={19} />
          <span>Tìm kiếm</span>
        </button>
      </form>
      <span className="sr-only" id={id + "-hint"}>
        Nhập từ 2 ký tự để xem gợi ý. Dùng phím lên xuống để chọn phim, Enter để
        mở hoặc tìm kiếm, Escape để đóng.
      </span>
      {expanded && (
        <div className="search-suggestions">
          <div className="search-suggestions-heading">Gợi ý phim</div>
          <div
            id={id + "-results"}
            role="listbox"
            aria-label="Gợi ý phim"
            aria-busy={loading}
            className="search-options"
          >
            {rows.map((film, index) => (
              <Link
                key={film.id}
                id={id + "-option-" + index}
                role="option"
                aria-selected={selected === index}
                tabIndex={-1}
                className="search-option"
                to={"/titles/" + film.id}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse") event.preventDefault();
                }}
                onMouseMove={() => setActive(index)}
                onClick={() => setOpen(false)}
              >
                <div className="search-option-poster" aria-hidden="true">
                  {poster(film.posterAssetRef, 90) ? (
                    <img
                      src={poster(film.posterAssetRef, 90)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <Clapperboard size={21} />
                  )}
                </div>
                <div className="search-option-copy">
                  <strong>{film.localizedTitle}</strong>
                  {film.originalTitle &&
                    film.originalTitle !== film.localizedTitle && (
                      <span>{film.originalTitle}</span>
                    )}
                  <small>
                    {film.kind === "SERIES" ? "Phim bộ" : "Phim lẻ"}
                    {film.releaseYear ? " · " + film.releaseYear : ""}
                  </small>
                </div>
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            ))}
          </div>
          {loading ? (
            <p className="search-feedback" role="status">
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
              Đang tìm phim…
            </p>
          ) : failed ? (
            <div className="search-feedback">
              <span role="status">
                Chưa tải được gợi ý. Bạn có thể thử lại.
              </span>
              <button
                type="button"
                className="text-link"
                onClick={() => setRevision((v) => v + 1)}
              >
                Thử lại gợi ý
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p className="search-feedback" role="status">
              Không tìm thấy phim phù hợp. Thử từ khóa khác hoặc bỏ bớt bộ lọc.
            </p>
          ) : (
            <span className="sr-only" role="status">
              {rows.length} phim gợi ý
            </span>
          )}
          <button type="button" className="search-all" onClick={search}>
            Xem tất cả kết quả <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
