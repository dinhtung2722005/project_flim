import { api, ApiError, type Row } from "../../lib/api";
import { registerPlaybackCleanup } from "../../lib/playback-cleanup";
const round = (n: number) => Math.round(Math.max(0, n) * 1000) / 1000;
export function guestId() {
  const key = "pj-flim.guest";
  let id = "";
  try {
    id = localStorage.getItem(key) || "";
  } catch {}
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    id = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    try {
      localStorage.setItem(key, id);
    } catch {}
  }
  return id;
}
export const managementHeaders = (session: Row): Record<string, string> =>
  session.managementToken
    ? { "X-Playback-Management": String(session.managementToken) }
    : {};
export async function closeSession(session: Row) {
  try {
    await api("/playback-sessions/" + session.id, {
      method: "DELETE",
      headers: managementHeaders(session),
    });
  } catch {}
}
export class PlaybackTracker {
  private started = performance.now();
  private eventSequence = 0;
  private progressSequence = 0;
  private events: Row[] = [];
  private eventFlight: Promise<void> | null = null;
  private eventBatch: Row | null = null;
  private progressPending = 0;
  private progressFlight = Promise.resolve();
  private intervalStart: number | null = null;
  private playing = false;
  private disposed = false;
  private disposal: Promise<void> | null = null;
  private unregister: () => void;
  private progressDisabled = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  lastPosition = 0;
  constructor(
    public session: Row,
    private episode: Row,
    private userId: string | undefined,
    private onStatus: (text: string) => void,
  ) {
    this.unregister = registerPlaybackCleanup(session.id, () => this.dispose());
    this.timers.push(
      setInterval(() => void this.flushEvents(), 5000),
      setInterval(() => {
        this.event("heartbeat");
        this.save(false);
      }, 15000),
    );
  }
  async resume() {
    try {
      if (this.userId) {
        const row = (await api("/me/watch-progress/" + this.episode.id)).data;
        if (
          row.assetId === this.session.assetId &&
          row.resumeEligible &&
          !row.completedAt
        )
          return Number(row.positionSeconds) || 0;
      } else {
        return Number(localStorage.getItem(this.storageKey()) || 0);
      }
    } catch {}
    return 0;
  }
  private storageKey() {
    return "pj-flim.progress:" + this.episode.id + ":" + this.session.assetId;
  }
  event(type: string, fields: Row = {}) {
    if (this.disposed) return;
    if (this.events.length >= 150) this.events.shift();
    this.events.push({
      id: crypto.randomUUID(),
      sequence: this.eventSequence++,
      type,
      elapsedMs: Math.max(0, Math.floor(performance.now() - this.started)),
      positionSeconds: round(this.lastPosition),
      ...fields,
    });
  }
  async flushEvents(): Promise<void> {
    if (this.eventFlight) return this.eventFlight;
    if (!this.eventBatch && this.events.length)
      this.eventBatch = {
        batchId: crypto.randomUUID(),
        events: this.events.splice(0, 50),
      };
    if (!this.eventBatch) return;
    const batch = this.eventBatch;
    this.eventFlight = (async () => {
      await api("/playback-sessions/" + this.session.id + "/events", {
        method: "POST",
        headers: { "X-Playback-Telemetry": this.session.telemetryToken },
        body: batch,
        auth: false,
      });
      if (this.eventBatch === batch) this.eventBatch = null;
    })()
      .catch((error) => {
        if (
          error instanceof ApiError &&
          [
            "PLAYBACK_SESSION_EXPIRED",
            "PLAYBACK_SESSION_REVOKED",
            "TELEMETRY_SESSION_MISMATCH",
          ].includes(error.code)
        ) {
          this.eventBatch = null;
          this.events = [];
        }
        // Collector failure never stops media playback.
      })
      .finally(() => {
        this.eventFlight = null;
      });
    return this.eventFlight;
  }
  position(value: number) {
    if (Number.isFinite(value)) this.lastPosition = round(value);
  }
  play() {
    this.playing = true;
    if (this.intervalStart === null) this.intervalStart = this.lastPosition;
    this.event("play");
  }
  pause() {
    this.save(false);
    this.playing = false;
    this.intervalStart = null;
    this.event("pause");
  }
  seeking(target: number) {
    this.save(false);
    this.intervalStart = null;
    this.position(target);
    this.event("seek");
  }
  seeked(value: number) {
    this.position(value);
    if (this.playing) this.intervalStart = this.lastPosition;
  }
  save(ended: boolean) {
    if (
      this.disposed ||
      this.progressDisabled ||
      (!ended && this.progressPending >= 2)
    )
      return;
    const position = round(
      Math.min(
        this.lastPosition,
        Number(this.session.durationSeconds) || this.lastPosition,
      ),
    );
    if (!this.userId) {
      try {
        localStorage.setItem(this.storageKey(), String(ended ? 0 : position));
      } catch {}
      return;
    }
    const body: Row = {
      sessionId: this.session.id,
      sequence: this.progressSequence++,
      positionSeconds: position,
      ended,
    };
    if (this.intervalStart !== null && position >= this.intervalStart)
      body.intervalStartSeconds = round(this.intervalStart);
    this.intervalStart = this.playing ? position : null;
    this.progressPending++;
    this.progressFlight = this.progressFlight
      .then(async () => {
        for (let retry = 0; retry < 2; retry++) {
          try {
            await api("/me/watch-progress/" + this.episode.id, {
              method: "PUT",
              body,
            });
            this.onStatus("Đã lưu tiến trình");
            return;
          } catch (error) {
            if (
              error instanceof ApiError &&
              [
                "PROGRESS_SESSION_STALE",
                "AUTH_SESSION_REVOKED",
                "PLAYBACK_SESSION_REVOKED",
              ].includes(error.code)
            ) {
              this.progressDisabled = true;
              this.onStatus("Tiến trình được cập nhật ở một phiên khác");
              return;
            }
            if (
              !(error instanceof ApiError && error.status >= 500) ||
              retry === 1
            ) {
              this.onStatus("Chưa đồng bộ được tiến trình");
              return;
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        this.progressPending--;
      });
  }
  async ended() {
    this.event("ended");
    for (
      let attempt = 0;
      attempt < 5 &&
      (this.events.length || this.eventBatch || this.eventFlight);
      attempt++
    )
      await this.flushEvents();
    if (this.eventBatch || this.events.length) {
      this.onStatus("Đã xem xong; đang chờ đồng bộ");
      return;
    }
    this.save(true);
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.timers.forEach(clearInterval);
    this.save(false);
    this.disposed = true;
    this.disposal = (async () => {
      await this.progressFlight;
      await this.flushEvents();
      await closeSession(this.session);
    })().finally(() => this.unregister());
    return this.disposal;
  }
}
