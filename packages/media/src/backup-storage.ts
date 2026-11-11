import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { ApiError } from "../../backend-core/src/errors";
import { cdnFetch } from "./hls-verifier";
export type BackupResult = {
  provider: string;
  bucket: string;
  key: string;
  version: string | null;
  manifestRef: string;
  sha256: string;
  bytes: number;
};
async function digest(
  input: AsyncIterable<any>,
  expectedBytes: number,
  signal?: AbortSignal,
) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const part of input) {
    signal?.throwIfAborted();
    bytes += part.length;
    if (bytes > expectedBytes) throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
    hash.update(part);
  }
  if (bytes !== expectedBytes) throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
  return { sha256: hash.digest("hex"), bytes };
}
export class BackupStorage {
  readonly driver: string;
  readonly bucket: string;
  readonly root: string;
  private s3?: S3Client;
  constructor() {
    this.driver = process.env.BACKUP_DRIVER ?? "filesystem";
    this.root = resolve(process.env.BACKUP_LOCAL_ROOT ?? ".local/backups");
    this.bucket =
      this.driver === "s3"
        ? (process.env.BACKUP_BUCKET ?? "")
        : "local-private";
    if (this.driver === "filesystem" && process.env.NODE_ENV === "production")
      throw new Error("Production requires independent S3 backup.");
    if (this.driver === "s3") {
      if (
        !this.bucket ||
        !process.env.BACKUP_ACCESS_KEY_ID ||
        !process.env.BACKUP_SECRET_ACCESS_KEY
      )
        throw new Error("Explicit backup S3 credentials and bucket required.");
      const endpoint = process.env.BACKUP_S3_ENDPOINT;
      if (
        endpoint &&
        new URL(endpoint).protocol !== "https:" &&
        process.env.NODE_ENV === "production"
      )
        throw new Error("S3 backup endpoint must use HTTPS.");
      this.s3 = new S3Client({
        region: process.env.BACKUP_REGION ?? "ap-southeast-1",
        endpoint: endpoint || undefined,
        forcePathStyle: !!endpoint,
        credentials: {
          accessKeyId: process.env.BACKUP_ACCESS_KEY_ID,
          secretAccessKey: process.env.BACKUP_SECRET_ACCESS_KEY,
        },
        maxAttempts: 3,
      });
    } else if (this.driver !== "filesystem")
      throw new Error("Invalid backup storage.");
  }
  async check() {
    if (this.s3) {
      const versioning = await this.s3.send(
        new GetBucketVersioningCommand({ Bucket: this.bucket }),
      );
      if (versioning.Status !== "Enabled")
        throw new Error("Backup bucket must enable versioning.");
      if (process.env.NODE_ENV === "production") {
        const access = await this.s3.send(
          new GetPublicAccessBlockCommand({ Bucket: this.bucket }),
        );
        if (
          !access.PublicAccessBlockConfiguration?.BlockPublicAcls ||
          !access.PublicAccessBlockConfiguration.BlockPublicPolicy ||
          !access.PublicAccessBlockConfiguration.IgnorePublicAcls ||
          !access.PublicAccessBlockConfiguration.RestrictPublicBuckets
        )
          throw new Error("Backup bucket must block public access.");
      }
    } else {
      await mkdir(this.root, { recursive: true });
      const root = await realpath(this.root);
      if (root.toLowerCase() !== this.root.toLowerCase())
        throw new Error("Backup root cannot be a symlink.");
    }
  }
  private path(key: string) {
    if (
      isAbsolute(key) ||
      key.includes("\\") ||
      key.split("/").some((p) => p === ".." || p === "." || !p)
    )
      throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
    const path = resolve(this.root, key),
      rel = relative(this.root, path);
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
      throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
    return path;
  }
  async verifyExisting(result: BackupResult, signal?: AbortSignal) {
    if (
      result.provider !== (this.s3 ? "S3" : "FILESYSTEM") ||
      result.bucket !== this.bucket
    )
      throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
    let input: AsyncIterable<any>;
    if (this.s3) {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: result.key,
          VersionId: result.version ?? undefined,
        }),
        { abortSignal: signal },
      );
      if (!response.Body) throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
      input = response.Body as AsyncIterable<any>;
    } else {
      const p = this.path(result.key),
        actual = await realpath(p);
      if (actual.toLowerCase() !== p.toLowerCase())
        throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
      input = createReadStream(p);
    }
    const actual = await digest(input, result.bytes, signal);
    if (actual.sha256 !== result.sha256)
      throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
    return result;
  }
  async copySource(
    input: {
      url: string;
      cloudName: string;
      assetId: string;
      providerAssetId: string;
      providerVersion: string;
      format: string;
      bytes: number;
    },
    signal?: AbortSignal,
  ): Promise<BackupResult> {
    if (
      !/^[a-f0-9-]{36}$/i.test(input.assetId) ||
      !/^[0-9]+$/.test(input.providerVersion) ||
      !/^[a-z0-9]{1,20}$/i.test(input.format)
    )
      throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
    const key =
      "assets/" +
      input.assetId +
      "/" +
      input.providerVersion +
      "/source." +
      input.format;
    const response = await cdnFetch(
      input.url,
      input.cloudName,
      signal,
      undefined,
      3600000,
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new ApiError("MEDIA_PROVIDER_UNAVAILABLE");
    }
    const hash = createHash("sha256");
    let bytes = 0;
    async function* stream() {
      for await (const raw of Readable.fromWeb(response.body as any)) {
        signal?.throwIfAborted();
        const chunk = Buffer.from(raw);
        bytes += chunk.length;
        if (bytes > input.bytes)
          throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
        hash.update(chunk);
        yield chunk;
      }
      if (bytes !== input.bytes)
        throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
    }
    const body = Readable.from(stream());
    let version: string | null = null;
    if (this.s3) {
      const upload = new Upload({
        client: this.s3,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: "application/octet-stream",
          ServerSideEncryption: "AES256",
        },
        queueSize: 2,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      });
      const abort = () => {
        void upload.abort().catch(() => undefined);
        body.destroy(new Error("Backup interrupted."));
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await upload.done();
        version = result.VersionId ?? null;
        if (!version) throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    } else {
      const final = this.path(key);
      await mkdir(dirname(final), { recursive: true });
      const actualDir = await realpath(dirname(final));
      if (actualDir.toLowerCase() !== dirname(final).toLowerCase())
        throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
      const temp = final + "." + randomUUID() + ".part";
      try {
        await pipeline(
          body,
          createWriteStream(temp, { flags: "wx", mode: 0o600 }),
          { signal },
        );
        // Immutable source key: an existing file must match the source just downloaded.
        const sourceHash = hash.copy().digest("hex");
        try {
          await stat(final);
          const existing = await digest(createReadStream(final), bytes, signal);
          if (existing.sha256 !== sourceHash)
            throw new ApiError("MEDIA_BACKUP_NOT_VERIFIED");
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error;
          await rename(temp, final);
        }
      } finally {
        // Only remove the exact temporary file created above; never recursive cleanup.
        await rm(temp, { force: true });
      }
    }
    const result: BackupResult = {
      provider: this.s3 ? "S3" : "FILESYSTEM",
      bucket: this.bucket,
      key,
      version,
      manifestRef: key + ".manifest.json",
      sha256: hash.digest("hex"),
      bytes,
    };
    await this.verifyExisting(result, signal);
    const manifest =
      JSON.stringify(
        {
          schemaVersion: 1,
          assetId: input.assetId,
          providerAssetId: input.providerAssetId,
          providerVersion: input.providerVersion,
          storageProvider: result.provider,
          bucket: result.bucket,
          objectKey: key,
          objectVersion: version,
          sha256: result.sha256,
          bytes,
          verifiedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n";
    if (this.s3)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: result.manifestRef,
          Body: manifest,
          ContentType: "application/json",
          ServerSideEncryption: "AES256",
        }),
        { abortSignal: signal },
      );
    else {
      const manifestPath = this.path(result.manifestRef),
        temp = manifestPath + "." + randomUUID() + ".part";
      try {
        await writeFile(temp, manifest, { flag: "wx", mode: 0o600 });
        await rename(temp, manifestPath);
      } finally {
        await rm(temp, { force: true });
      }
    }
    return result;
  }
  close() {
    this.s3?.destroy();
  }
}
