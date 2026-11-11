// Browser-safe helper: no Cloudinary secret, SDK, Node API or local file proxy.
// The backend access token is used only for the same-origin verification call.
export type DirectUpload = {
  url: string;
  chunkSize: number;
  signatureExpiresAt: string;
  expectedBytes: number;
  maxBytes: number;
  fields: Record<string, string | number | boolean>;
};
export async function uploadVideoDirect(
  file: File,
  upload: DirectUpload,
  options: {
    signal?: AbortSignal;
    onProgress?: (uploaded: number, total: number) => void;
  } = {},
): Promise<void> {
  if (file.size !== upload.expectedBytes || file.size > upload.maxBytes)
    throw new Error("File size does not match the upload intent.");
  const target = new URL(upload.url);
  if (
    target.protocol !== "https:" ||
    target.hostname !== "api.cloudinary.com" ||
    !/^\/v1_1\/[a-z0-9_-]+\/video\/upload$/i.test(target.pathname)
  )
    throw new Error("Invalid upload endpoint.");
  if (
    !Number.isFinite(Date.parse(upload.signatureExpiresAt)) ||
    Date.now() >= Date.parse(upload.signatureExpiresAt)
  )
    throw new Error("Upload signature expired. Create a new intent.");
  const chunkSize = upload.chunkSize;
  if (
    !Number.isInteger(chunkSize) ||
    chunkSize < 5 * 1024 * 1024 ||
    chunkSize > 20 * 1024 * 1024 ||
    file.size < 1
  )
    throw new Error("Invalid upload size.");
  const uploadId = crypto.randomUUID();
  for (let start = 0; start < file.size; start += chunkSize) {
    if (options.signal?.aborted)
      throw new DOMException("Upload cancelled.", "AbortError");
    const end = Math.min(start + chunkSize, file.size);
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields))
      form.append(key, String(value));
    form.append("file", file.slice(start, end), file.name);
    const response = await fetch(upload.url, {
      method: "POST",
      body: form,
      signal: options.signal,
      headers: {
        "X-Unique-Upload-Id": uploadId,
        "Content-Range": "bytes " + start + "-" + (end - 1) + "/" + file.size,
      },
      // Never forward JWT/cookies to Cloudinary. A lost final response is
      // reconciled by the backend verification endpoint, not blindly re-uploaded.
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        "Cloudinary upload failed (" +
          response.status +
          "). Verify the intent before restarting.",
      );
    const data = await response.json();
    if (end === file.size && (data.done === false || !data.asset_id))
      throw new Error("Cloudinary did not confirm the final chunk.");
    options.onProgress?.(end, file.size);
  }
}
