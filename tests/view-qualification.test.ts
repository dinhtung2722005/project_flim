import assert from "node:assert/strict";
import {
  qualifyView,
  viewThreshold,
  type ViewEvent,
} from "../packages/analytics/src/views";
let checks = 0;
const start = new Date("2026-11-24T23:58:00Z");
const timeline = (rows: [string, number, number][]): ViewEvent[] =>
  rows.map(([type, time, pos], sequence) => ({
    sequence,
    type,
    elapsed_ms: time * 1000,
    position_seconds: pos,
    received_at: new Date(+start + time * 1000),
  }));
const normal = timeline([
  ["play", 0, 0],
  ...Array.from(
    { length: 8 },
    (_, i) =>
      ["heartbeat", (i + 1) * 15, (i + 1) * 15] as [string, number, number],
  ),
]);
function eq(a: unknown, b: unknown) {
  assert.deepEqual(a, b);
  checks++;
}
const run = (e: ViewEvent[], duration = 1000) =>
  qualifyView(e, duration, start);
eq(viewThreshold(1000), 120);
eq(viewThreshold(100), 50);
eq(viewThreshold(0), Infinity);
eq(run([]).qualified, false);
eq(run(normal.slice(0, 1)).started, true);
eq(run(normal.slice(0, 8)).qualified, false);
eq(run(normal).qualified, true);
eq(run(normal).seconds, 120);
eq(run(normal).qualifiedAt, "2026-11-25T00:00:00.000Z");
eq(run(normal.filter((e) => e.sequence !== 3)).qualified, false);
eq(run(normal.filter((e) => e.sequence !== 0)).started, false);
eq(run([...normal].reverse()).qualified, false);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["heartbeat", 25, 25],
      ["ended", 50, 50],
    ]),
    100,
  ).qualified,
  true,
);
eq(
  run(
    timeline([
      ["heartbeat", 0, 0],
      ["heartbeat", 30, 30],
      ["heartbeat", 60, 60],
    ]),
    100,
  ).seconds,
  0,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["pause", 15, 15],
      ["heartbeat", 30, 30],
      ["heartbeat", 60, 60],
    ]),
    100,
  ).seconds,
  15,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["buffering-start", 15, 15],
      ["heartbeat", 30, 30],
      ["buffering-end", 45, 45],
      ["heartbeat", 60, 60],
    ]),
    100,
  ).seconds,
  30,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["seek", 15, 80],
      ["heartbeat", 30, 95],
    ]),
    100,
  ).seconds,
  15,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["heartbeat", 15, 15],
      ["seek", 16, 0],
      ["heartbeat", 31, 15],
      ["heartbeat", 46, 30],
    ]),
    100,
  ).seconds,
  30,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["heartbeat", 60, 60],
      ["heartbeat", 120, 120],
    ]),
  ).seconds,
  0,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["heartbeat", 15, 200],
    ]),
  ).seconds,
  0,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["heartbeat", 15, 30],
      ["heartbeat", 30, 60],
    ]),
    100,
  ).seconds,
  30,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["heartbeat", 30, 15],
      ["heartbeat", 60, 30],
    ]),
    100,
  ).seconds,
  30,
);
eq(run(normal.map((e) => ({ ...e, received_at: start }))).qualified, false);
eq(run(normal.map((e) => ({ ...e, received_at: "invalid" }))).started, false);
eq(run(normal.map((e) => ({ ...e, position_seconds: null }))).started, false);
eq(run(normal.map((e) => ({ ...e, position_seconds: -1 }))).started, false);
eq(run(normal, NaN).qualified, false);
eq(
  run(normal.map((e) => ({ ...e, sequence: Number(e.sequence) + 1 })))
    .qualified,
  false,
);
eq(run(normal, NaN).seconds, 0);
eq(run(normal, 0).seconds, 0);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["heartbeat", 30, 30],
      ["play", 10, 100],
      ["play", 11, 100],
      ["heartbeat", 41, 130],
      ["play", 20, 200],
      ["play", 21, 200],
      ["heartbeat", 51, 230],
      ["play", 25, 300],
      ["play", 26, 300],
      ["heartbeat", 56, 330],
    ]),
  ).qualified,
  false,
);
eq(
  run(
    timeline([
      ["play", 0, 0],
      ["heartbeat", 30, 30],
      ["play", 10, 100],
      ["play", 11, 100],
      ["heartbeat", 41, 130],
      ["play", 20, 200],
      ["play", 21, 200],
      ["heartbeat", 51, 230],
      ["play", 25, 300],
      ["play", 26, 300],
      ["heartbeat", 56, 330],
    ]),
  ).seconds,
  30,
);
console.log(
  JSON.stringify({ event: "view-qualification.tests", checks, passed: true }),
);
