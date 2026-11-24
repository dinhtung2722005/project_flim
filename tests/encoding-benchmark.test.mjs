import { test } from "node:test";
import assert from "node:assert/strict";
import { targetSizes } from "../scripts/encoding-benchmark.mjs";
test("720p source never gains a fake 1080p rendition", () => {
  assert.deepEqual(targetSizes(1280, 720), [
    { width: 640, height: 360 },
    { width: 852, height: 480 },
    { width: 1280, height: 720 },
  ]);
});
test("odd dimensions preserve safe even encoding bounds", () => {
  for (const s of targetSizes(1919, 1079)) {
    assert.equal(s.width % 2, 0);
    assert.ok(s.width <= 1919 && s.height <= 1079);
  }
});
test("invalid dimensions are rejected before invoking media tools", () => {
  for (const [w, h] of [
    [0, 720],
    [1280, 0],
    [Infinity, 720],
    [1280, NaN],
  ])
    assert.throws(() => targetSizes(w, h));
});
test("small source has no upscale candidates", () =>
  assert.deepEqual(targetSizes(320, 240), []));
