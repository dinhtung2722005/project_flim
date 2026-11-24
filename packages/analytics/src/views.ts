export const VIEW_DEFINITION_VERSION = 2;
export const MAX_VIEW_EVENTS = 2000;
export function viewThreshold(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return Infinity;
  return Math.min(120, duration / 2);
}
export type ViewEvent = {
  sequence: string | number | bigint;
  type: string;
  elapsed_ms: string | number | bigint;
  position_seconds: string | number | null;
  received_at: string | Date;
};
export function qualifyView(
  events: ViewEvent[],
  duration: number,
  createdAt: string | Date,
) {
  const threshold = viewThreshold(duration),
    start = +new Date(createdAt);
  let expected = 0,
    playing = false,
    buffering = false,
    previous: { time: number; pos: number } | null = null,
    lastTime = -1,
    seconds = 0,
    started = false;
  if (!Number.isFinite(threshold) || !Number.isFinite(start))
    return { started: false, qualified: false, seconds: 0, qualifiedAt: null };
  let ranges: [number, number][] = [];
  const addRange = (a: number, b: number) => {
    let unique = b - a,
      merged: [number, number][] = [];
    for (const [x, y] of ranges) {
      unique -= Math.max(0, Math.min(b, y) - Math.max(a, x));
    }
    let low = a,
      high = b;
    for (const [x, y] of ranges) {
      if (y < low || x > high) merged.push([x, y]);
      else {
        low = Math.min(low, x);
        high = Math.max(high, y);
      }
    }
    merged.push([low, high]);
    ranges = merged.sort((a, b) => a[0] - b[0]);
    return Math.max(0, unique);
  };
  for (const e of events) {
    const sequence = Number(e.sequence),
      time = Number(e.elapsed_ms) / 1000,
      pos = e.position_seconds == null ? null : Number(e.position_seconds);
    if (sequence !== expected) break; // A missing sequence cannot conceal an unreceived pause/seek.
    expected++;
    if (
      !Number.isFinite(+new Date(e.received_at)) ||
      !Number.isFinite(time) ||
      time < 0 ||
      !Number.isFinite(start) ||
      time * 1000 > +new Date(e.received_at) - start + 2000 ||
      time < lastTime ||
      pos == null ||
      !Number.isFinite(pos) ||
      pos < 0 ||
      pos > duration + 1
    ) {
      playing = false;
      buffering = false;
      previous = null;
      continue;
    }
    lastTime = time;
    if (previous && playing && !buffering && e.type !== "seek") {
      const dt = time - previous.time,
        dp = pos - previous.pos;
      if (dt > 0 && dt <= 45 && dp > 0 && dp <= dt * 2.25 + 1) {
        seconds += Math.min(
          dt,
          addRange(Math.min(duration, previous.pos), Math.min(duration, pos)),
        );
        if (seconds + 1e-6 >= threshold)
          return {
            started: true,
            qualified: true,
            seconds: Math.round(seconds * 1000) / 1000,
            qualifiedAt: new Date(
              Math.min(start + time * 1000, +new Date(e.received_at)),
            ).toISOString(),
          };
      }
    }
    if (e.type === "play") {
      started = true;
      playing = true;
      buffering = false;
    }
    if (e.type === "pause" || e.type === "ended" || e.type === "error") {
      playing = false;
    }
    if (e.type === "buffering-start") buffering = true;
    if (e.type === "buffering-end") buffering = false;
    previous = { time, pos };
  }
  return {
    started,
    qualified: false,
    seconds: Math.round(seconds * 1000) / 1000,
    qualifiedAt: null,
  };
}
