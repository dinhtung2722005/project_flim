import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link, useParams } from "react-router-dom";
import type Hls from "hls.js";
import hlsWorkerUrl from "hls.js/dist/hls.worker.js?url";
import {
  ArrowLeft,
  ChevronRight,
  Flag,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError, type Row, type Page } from "../lib/api";
import { useAuth, useData, usePages, useNotice } from "../lib/state";
import { Empty, ErrorBox, Field, Spinner, asError } from "../components/ui";
import {
  PlaybackTracker,
  guestId,
  managementHeaders,
  closeSession,
} from "../features/player/tracker";
function VideoPlayer({
  session,
  episode,
  owner,
  onRetry,
}: {
  session: Row;
  episode: Row;
  owner: RefObject<PlaybackTracker | null>;
  onRetry: () => void;
}) {
  const auth = useAuth(),
    video = useRef<HTMLVideoElement>(null),
    trackerRef = useRef<PlaybackTracker | null>(null),
    hlsRef = useRef<Hls | null>(null),
    fallbackRef = useRef<() => void>(() => {}),
    adaptiveRetryRef = useRef<() => Promise<void>>(async () => {});
  const [fallback, setFallback] = useState(false),
    [needsPlay, setNeedsPlay] = useState(false),
    [activeHeight, setActiveHeight] = useState(0),
    [nativePlayback, setNativePlayback] = useState(false),
    [restarting, setRestarting] = useState(false);
  const [levels, setLevels] = useState<{ height: number; index: number }[]>([]),
    [quality, setQuality] = useState(-1),
    [speed, setSpeed] = useState(1),
    [error, setError] = useState<Error | null>(null),
    [status, setStatus] = useState("Sẵn sàng phát"),
    [hint, setHint] = useState("");
  useEffect(() => {
    const media = video.current!;
    let disposed = false,
      recoveries = 0,
      resume = 0,
      metadataReady = false,
      usingFallback = false,
      retrying = false;
    let loadTimer: ReturnType<typeof setTimeout> | undefined,
      recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tracker = new PlaybackTracker(
      session,
      episode,
      auth.user?.id,
      (text) => {
        if (!disposed) setHint(text);
      },
    );
    trackerRef.current = tracker;
    owner.current = tracker;
    const events: [string, EventListener][] = [];
    const on = (name: string, fn: EventListener) => {
      media.addEventListener(name, fn);
      events.push([name, fn]);
    };
    adaptiveRetryRef.current = async () => {
      if (disposed || retrying) return;
      retrying = true;
      setRestarting(true);
      media.pause();
      tracker.position(media.currentTime);
      await tracker.dispose();
      if (!disposed) onRetry();
    };
    const updateHeight = () => {
      if (!disposed) setActiveHeight(media.videoHeight);
    };
    on("resize", updateHeight);
    on("loadeddata", updateHeight);
    const failure = (code: string, message: string) => {
      if (disposed) return;
      if (loadTimer) clearTimeout(loadTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      setNeedsPlay(false);
      tracker.event("error", { errorCode: code });
      setError(new Error(message + " (" + code + ")"));
      setStatus("Không thể tải video");
    };
    const useFallback = () => {
      if (disposed || usingFallback || !session.delivery.fallback?.url)
        return false;
      usingFallback = true;
      if (loadTimer) clearTimeout(loadTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      resume = metadataReady ? media.currentTime : resume;
      metadataReady = false;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      setFallback(true);
      setActiveHeight(0);
      setLevels([]);
      setQuality(-1);
      setError(null);
      setNeedsPlay(false);
      setStatus("Đang tải video bằng cách phát dự phòng…");
      media.src = session.delivery.fallback.url;
      media.load();
      loadTimer = setTimeout(
        () =>
          failure(
            "MP4_LOAD_TIMEOUT",
            "Video tải quá lâu. Kiểm tra kết nối hoặc mở lại video.",
          ),
        25000,
      );
      return true;
    };
    fallbackRef.current = () => {
      useFallback();
    };
    const ready = () => {
      if (disposed || metadataReady) return;
      metadataReady = true;
      updateHeight();
      if (loadTimer) clearTimeout(loadTimer);
      if (resume > 0 && Number.isFinite(media.duration))
        media.currentTime = Math.min(resume, Math.max(0, media.duration - 1));
      setStatus("Nhấn phát để bắt đầu");
      void media.play().catch(() => {
        if (!disposed) {
          setStatus("Nhấn nút phát để bắt đầu xem");
          setNeedsPlay(true);
        }
      });
    };
    on("loadedmetadata", ready);
    on("timeupdate", () => {
      if (!media.seeking) tracker.position(media.currentTime);
    });
    on("playing", () => {
      if (recoveryTimer) clearTimeout(recoveryTimer);
      setNeedsPlay(false);
      tracker.position(media.currentTime);
      tracker.play();
      setError(null);
      setStatus("Đang phát");
    });
    on("pause", () => {
      if (!media.ended) {
        tracker.pause();
        setStatus("Đã tạm dừng");
      }
    });
    on("seeking", () => tracker.seeking(media.currentTime));
    on("seeked", () => tracker.seeked(media.currentTime));
    on("waiting", () => {
      tracker.event("buffering-start");
      setStatus("Đang tải thêm video…");
    });
    on("canplay", () => {
      tracker.event("buffering-end");
    });
    on("ended", () => {
      tracker.position(media.currentTime);
      void tracker.ended();
      setStatus("Đã xem hết tập");
    });
    on("error", () => {
      if (!disposed) {
        if (!useFallback())
          failure(
            "MEDIA_SOURCE_ERROR_" + (media.error?.code || 0),
            "Không thể phát video. Kiểm tra kết nối hoặc thử mở lại video.",
          );
      }
    });
    const start = async () => {
      resume = await tracker.resume();
      if (disposed) return;
      loadTimer = setTimeout(() => {
        if (!useFallback())
          failure(
            "PLAYER_LOAD_TIMEOUT",
            "Video tải quá lâu. Kiểm tra kết nối hoặc mở lại video.",
          );
      }, 25000);
      const nativeHls = !!media.canPlayType("application/vnd.apple.mpegurl");
      // Chrome can report "maybe" without reliable native playback. Prefer MSE there.
      if (
        nativeHls &&
        ("ManagedMediaSource" in window || !("MediaSource" in window))
      ) {
        setNativePlayback(true);
        media.src = session.delivery.url;
        media.load();
      } else {
        const { default: Hls } = await import("hls.js");
        if (disposed) return;
        if (Hls.isSupported()) {
          const hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            backBufferLength: 30,
            enableWorker: true,
            workerPath: hlsWorkerUrl,
          });
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!disposed)
              setLevels(
                [
                  ...new Map(
                    hls.levels.map((level, index) => [
                      level.height,
                      { height: level.height, index },
                    ]),
                  ).values(),
                ]
                  .filter((level) => level.height > 0)
                  .sort((a, b) => b.height - a.height),
              );
          });
          hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) =>
            tracker.event("quality-change", {
              height: hls.levels[data.level]?.height || 1,
            }),
          );
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (disposed || usingFallback || !data.fatal) return;
            // Never send provider exception text or signed URLs to telemetry.
            const code = (
              "HLS_" +
              String(data.details || data.type)
                .replace(/[^a-z0-9]/gi, "_")
                .toUpperCase()
            ).slice(0, 80);
            tracker.event("error", { errorCode: code });
            if (
              data.details ===
                Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR ||
              data.details === Hls.ErrorDetails.ATTACH_MEDIA_ERROR
            ) {
              if (!useFallback())
                failure(
                  code,
                  "Trình duyệt không hỗ trợ định dạng video này. Hãy cập nhật Chrome hoặc thử trình duyệt khác.",
                );
              return;
            }
            if (recoveries++ < 2 && data.type === Hls.ErrorTypes.NETWORK_ERROR)
              timers.push(
                setTimeout(() => {
                  if (!disposed && !usingFallback) {
                    if (hls.levels.length) hls.startLoad();
                    else hls.loadSource(session.delivery.url);
                  }
                }, 1500 * recoveries),
              );
            else if (
              recoveries <= 2 &&
              data.type === Hls.ErrorTypes.MEDIA_ERROR
            ) {
              hls.recoverMediaError();
              if (recoveryTimer) clearTimeout(recoveryTimer);
              recoveryTimer = setTimeout(() => {
                if (!useFallback())
                  failure(
                    code,
                    "Không thể khôi phục video. Hãy mở lại phiên xem.",
                  );
              }, 4000);
            } else if (!useFallback()) {
              failure(
                code,
                "Video tạm thời không phát được. Bạn có thể mở lại phiên xem.",
              );
              hls.stopLoad();
            }
          });
          hls.attachMedia(media);
          hls.loadSource(session.delivery.url);
        } else if (nativeHls) {
          setNativePlayback(true);
          media.src = session.delivery.url;
          media.load();
        } else if (!useFallback())
          failure(
            "PLAYER_UNSUPPORTED",
            "Trình duyệt này chưa hỗ trợ định dạng video. Hãy cập nhật trình duyệt.",
          );
      }
    };
    void start().catch(() =>
      setError(new Error("Không thể khởi tạo video. Hãy thử lại.")),
    );
    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      if (loadTimer) clearTimeout(loadTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      fallbackRef.current = () => {};
      adaptiveRetryRef.current = async () => {};
      events.forEach(([name, fn]) => media.removeEventListener(name, fn));
      media.pause();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      media.removeAttribute("src");
      media.load();
      void tracker.dispose();
      trackerRef.current = null;
    };
  }, [session.id]);
  return (
    <>
      <div className="video-shell">
        <video
          ref={video}
          controls
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          aria-label={"Video: " + episode.name}
        />
        {needsPlay && !error && (
          <button
            className="video-start button"
            onClick={() => {
              void video.current
                ?.play()
                .catch(() =>
                  setStatus("Chưa phát được video. Hãy thử đổi cách phát."),
                );
            }}
          >
            <Play size={24} fill="currentColor" />
            Phát video
          </button>
        )}
        {error && (
          <div className="video-error">
            <ErrorBox error={error} />
            <button className="button small" onClick={onRetry}>
              <RefreshCw size={16} />
              Mở lại video
            </button>
          </div>
        )}
      </div>
      <div className="player-toolbar">
        <span className="player-status">
          <span className="live-dot" />
          {status}
        </span>
        <div>
          {fallback ? (
            <div className="fallback-quality">
              <span className="muted">
                Phát dự phòng MP4 · không tự đổi chất lượng
              </span>
              <button
                className="button ghost small"
                disabled={restarting}
                onClick={() => void adaptiveRetryRef.current()}
              >
                {restarting
                  ? "Đang mở lại…"
                  : "Thử lại HLS để đổi độ phân giải"}
              </button>
            </div>
          ) : (
            session.delivery.fallback?.url && (
              <button
                className="button ghost small"
                onClick={() => fallbackRef.current()}
              >
                Đổi cách phát
              </button>
            )
          )}
          <div className="resolution-control">
            <label>
              Độ phân giải
              <select
                aria-label="Chất lượng video"
                aria-describedby="resolution-status"
                disabled={restarting || fallback || levels.length === 0}
                value={fallback || levels.length === 0 ? -1 : quality}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  const hls = hlsRef.current;
                  if (
                    !hls ||
                    (value !== -1 && !levels.some((l) => l.index === value))
                  )
                    return;
                  setQuality(value);
                  hls.currentLevel = value;
                }}
              >
                <option value={-1}>
                  {fallback
                    ? activeHeight
                      ? activeHeight + "p (video gốc)"
                      : "Video gốc"
                    : nativePlayback
                      ? "Tự động (trình duyệt)"
                      : "Tự động"}
                </option>
                {!fallback &&
                  levels.map((l) => (
                    <option key={l.index} value={l.index}>
                      {l.height}p
                    </option>
                  ))}
              </select>
            </label>
            <span
              id="resolution-status"
              className="resolution-status"
              role="status"
            >
              {quality >= 0 &&
              !fallback &&
              levels.find((l) => l.index === quality)?.height !== activeHeight
                ? "Đang chuyển sang " +
                  levels.find((l) => l.index === quality)?.height +
                  "p…"
                : activeHeight
                  ? "Hiện tại: " +
                    activeHeight +
                    "p" +
                    (!fallback && quality === -1 ? " · tự động" : "")
                  : error
                    ? "Chưa xác định độ phân giải"
                    : "Đang tải thông tin video…"}
            </span>
          </div>
          <label>
            Tốc độ{" "}
            <select
              aria-label="Tốc độ phát"
              value={speed}
              onChange={(e) => {
                setSpeed(Number(e.target.value));
                if (video.current) {
                  video.current.defaultPlaybackRate = Number(e.target.value);
                  video.current.playbackRate = Number(e.target.value);
                }
              }}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {hint && (
        <p className="sync-status">
          <ShieldCheck size={14} />
          {hint}
        </p>
      )}
    </>
  );
}
export function WatchPage() {
  const { id } = useParams(),
    auth = useAuth(),
    notice = useNotice();
  const episode = useData("/episodes/" + id),
    [session, setPlayback] = useState<Row | null>(null),
    [error, setError] = useState<Error | null>(null),
    [revision, setRevision] = useState(0);
  const [reporting, setReporting] = useState(false),
    [message, setMessage] = useState(""),
    [reportBusy, setReportBusy] = useState(false);
  const dispose = useRef<() => void>(() => {}),
    owner = useRef<PlaybackTracker | null>(null);
  const siblings = usePages(
    episode.data
      ? "/seasons/" + episode.data.seasonId + "/episodes?limit=100"
      : null,
  );
  useEffect(() => {
    if (auth.loading) return;
    let active = true,
      current: Row | null = null,
      renewTimer: ReturnType<typeof setTimeout> | undefined;
    setPlayback(null);
    setError(null);
    const intentKey = crypto.randomUUID();
    function schedule(row: Row) {
      const expiry = Date.parse(row.expiresAt),
        maximum = Date.parse(row.maxExpiresAt);
      if (expiry >= maximum) {
        renewTimer = setTimeout(
          () => {
            if (active)
              setError(
                new Error(
                  "Phiên xem đã đạt thời lượng tối đa. Hãy mở lại video.",
                ),
              );
          },
          Math.max(1000, maximum - Date.now()),
        );
        return;
      }
      renewTimer = setTimeout(
        () => void renew(row),
        Math.max(1000, expiry - Date.now() - 60000),
      );
    }
    async function renew(row: Row) {
      const key = crypto.randomUUID();
      for (let attempt = 0; active && attempt < 3; attempt++) {
        try {
          const next = (
            await api("/playback-sessions/" + row.id + "/renewals", {
              method: "POST",
              headers: { ...managementHeaders(row), "Idempotency-Key": key },
              body: { format: "HLS" },
            })
          ).data;
          current = next;
          if (active) {
            setPlayback(next);
            schedule(next);
          }
          return;
        } catch (e) {
          if (e instanceof ApiError && e.status < 500) {
            if (active) setError(e);
            return;
          }
          if (attempt < 2)
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * 2 ** attempt),
            );
          else if (active) setError(asError(e));
        }
      }
    }
    void api("/episodes/" + id + "/playback-sessions", {
      method: "POST",
      headers: {
        "Idempotency-Key": intentKey,
        ...(!auth.user ? { "X-Guest-Id": guestId() } : {}),
      },
      body: { format: "HLS" },
    })
      .then((r) => {
        current = r.data;
        if (!active) {
          void closeSession(r.data);
          return;
        }
        setPlayback(r.data);
        schedule(r.data);
      })
      .catch((e) => {
        if (active) setError(asError(e));
      });
    dispose.current = () => {
      active = false;
      if (renewTimer) clearTimeout(renewTimer);
      if (current) {
        if (owner.current && owner.current.session.id === current.id)
          void owner.current.dispose();
        else void closeSession(current);
      }
    };
    return () => dispose.current();
  }, [id, auth.loading, auth.user?.id, revision]);
  useEffect(() => {
    const stop = () => {
      dispose.current();
      setPlayback(null);
    };
    window.addEventListener("pj-flim:logout", stop);
    return () => window.removeEventListener("pj-flim:logout", stop);
  }, []);
  async function report(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    setReportBusy(true);
    try {
      await api("/reports", {
        method: "POST",
        headers: managementHeaders(session),
        body: {
          titleId: episode.data?.titleId,
          episodeId: id,
          playbackSessionId: session.id,
          category: "PLAYBACK",
          message,
        },
      });
      setReporting(false);
      setMessage("");
      notice("Đã gửi báo lỗi. Cảm ơn bạn đã phản hồi.");
    } catch (e) {
      notice(asError(e).message, "error");
    } finally {
      setReportBusy(false);
    }
  }
  return (
    <div className="container watch-container">
      <Link
        className="back-link"
        to={episode.data ? "/titles/" + episode.data.titleId : "/"}
      >
        <ArrowLeft size={16} />
        Chi tiết phim
      </Link>
      {episode.loading ? (
        <Spinner />
      ) : (
        <>
          <div className="watch-heading">
            <div>
              <p className="eyebrow">ĐANG XEM</p>
              <h1>{episode.data?.name || "Xem phim"}</h1>
            </div>
            <button
              className="button ghost small"
              disabled={!session}
              onClick={() => setReporting(!reporting)}
            >
              <Flag size={15} />
              Báo lỗi
            </button>
          </div>
          <div
            className={
              "watch-layout" +
              (siblings.rows.length > 1 || siblings.cursor
                ? " with-episodes"
                : "")
            }
          >
            <section className="watch-main" aria-label="Trình phát phim">
              <ErrorBox error={episode.error || error} />
              {!error && session && episode.data ? (
                <VideoPlayer
                  key={session.id}
                  session={session}
                  episode={episode.data}
                  owner={owner}
                  onRetry={() => setRevision((v) => v + 1)}
                />
              ) : !error && !episode.error ? (
                <Spinner label="Đang chuẩn bị phiên xem…" />
              ) : (
                <div className="player-retry">
                  <button
                    className="button"
                    onClick={() => setRevision((v) => v + 1)}
                  >
                    <RefreshCw size={17} />
                    Mở lại video
                  </button>
                </div>
              )}
              {reporting && (
                <form
                  className="panel report-form"
                  onSubmit={(e) => void report(e)}
                >
                  <Field label="Bạn gặp vấn đề gì?">
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Mô tả lỗi phát video bạn đang gặp…"
                      minLength={3}
                      maxLength={2000}
                      required
                    />
                  </Field>
                  <div className="button-row">
                    <button className="button small" disabled={reportBusy}>
                      {reportBusy ? "Đang gửi…" : "Gửi báo lỗi"}
                    </button>
                    <button
                      className="button ghost small"
                      type="button"
                      onClick={() => setReporting(false)}
                    >
                      Hủy
                    </button>
                  </div>
                </form>
              )}
            </section>
            {(siblings.rows.length > 1 || siblings.cursor) && (
              <aside className="watch-sidebar" aria-label="Điều hướng tập phim">
                <section className="panel episodes-panel">
                  <div className="section-heading">
                    <h2>Các tập phim</h2>
                    <span className="episode-count">
                      {siblings.rows.length} tập{siblings.cursor ? "+" : ""}
                    </span>
                  </div>
                  {siblings.rows.findIndex((row) => row.id === id) >= 0 &&
                    siblings.rows[
                      siblings.rows.findIndex((row) => row.id === id) + 1
                    ] && (
                      <Link
                        className="button secondary next-episode"
                        to={
                          "/watch/" +
                          siblings.rows[
                            siblings.rows.findIndex((row) => row.id === id) + 1
                          ].id
                        }
                      >
                        Tập tiếp theo <ChevronRight size={18} />
                      </Link>
                    )}
                  <div className="episode-grid">
                    {siblings.rows.map((row) => (
                      <Link
                        className={
                          "episode-item " + (row.id === id ? "current" : "")
                        }
                        aria-current={row.id === id ? "page" : undefined}
                        to={"/watch/" + row.id}
                        key={row.id}
                      >
                        <span className="episode-number">{row.number}</span>
                        <div>
                          <strong>{row.name}</strong>
                          {row.id === id && <small>Đang xem</small>}
                        </div>
                        <Play size={15} />
                      </Link>
                    ))}
                  </div>
                  {siblings.cursor && (
                    <button
                      className="button secondary small"
                      disabled={siblings.loading}
                      onClick={() => void siblings.more()}
                    >
                      Thêm tập phim
                    </button>
                  )}
                  <ErrorBox error={siblings.error} onRetry={siblings.reload} />
                </section>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
