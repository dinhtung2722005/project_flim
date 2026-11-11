import assert from "node:assert/strict";
import {
  uploadVideoDirect,
  DirectUpload,
} from "../packages/media/src/browser-upload";
export async function runBrowserUploadChecks() {
  const originalFetch = globalThis.fetch;
  let checks = 0,
    calls = 0;
  const size = 20 * 1024 * 1024 + 3,
    file = new File([new Uint8Array(size)], "video.mp4", { type: "video/mp4" });
  const upload: DirectUpload = {
    url: "https://api.cloudinary.com/v1_1/test/video/upload",
    chunkSize: 20 * 1024 * 1024,
    signatureExpiresAt: new Date(Date.now() + 60000).toISOString(),
    expectedBytes: size,
    maxBytes: size,
    fields: { timestamp: 123, overwrite: false, signature: "example" },
  };
  try {
    globalThis.fetch = async (input, options) => {
      calls++;
      assert.equal(input, upload.url);
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      assert.equal((options?.headers as any).Authorization, undefined);
      assert.match(
        (options?.headers as any)["X-Unique-Upload-Id"],
        /^[a-f0-9-]{36}$/,
      );
      assert.equal(
        (options?.headers as any)["Content-Range"],
        calls === 1
          ? "bytes 0-20971519/" + size
          : "bytes 20971520-20971522/" + size,
      );
      const form = options?.body as FormData;
      assert.equal(form.get("overwrite"), "false");
      assert.equal(
        (form.get("file") as File).size,
        calls === 1 ? 20 * 1024 * 1024 : 3,
      );
      checks += 8;
      return Response.json(
        calls === 1 ? { done: false } : { done: true, asset_id: "asset" },
      );
    };
    const progress: number[] = [];
    await uploadVideoDirect(file, upload, {
      onProgress: (bytes) => progress.push(bytes),
    });
    assert.equal(calls, 2);
    assert.deepEqual(progress, [20 * 1024 * 1024, size]);
    checks += 2;
    await assert.rejects(
      uploadVideoDirect(file, { ...upload, expectedBytes: size - 1 }),
      /size/,
    );
    checks++;
    await assert.rejects(
      uploadVideoDirect(file, {
        ...upload,
        url: "https://attacker.invalid/upload",
      }),
      /endpoint/,
    );
    checks++;
    await assert.rejects(
      uploadVideoDirect(file, { ...upload, signatureExpiresAt: "invalid" }),
      /expired/,
    );
    checks++;
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      uploadVideoDirect(file, upload, { signal: abort.signal }),
      (e) => (e as Error).name === "AbortError",
    );
    checks++;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: { message: "denied" } }, { status: 400 });
    };
    const before = calls;
    await assert.rejects(uploadVideoDirect(file, upload), /failed/);
    assert.equal(calls, before + 1);
    checks += 2;
    return checks;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
