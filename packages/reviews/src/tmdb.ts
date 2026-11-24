import { ApiError, fail } from "../../backend-core/src/errors";
export type ReviewTitle = {
  kind: string;
  localized_title: string;
  original_title?: string | null;
  release_year?: number | null;
};
export type ReviewItem = {
  externalId: string;
  author: string;
  content: string;
  rating: number | null;
  language: "vi-VN" | "en-US";
  sourceUrl: string;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
};
export type Mapping = {
  externalId: number;
  kind: "movie" | "tv";
  sourceUrl: string;
};
export function reviewConfiguration() {
  const token = process.env.TMDB_API_READ_TOKEN?.trim() || "";
  return {
    token,
    enabled: process.env.REVIEWS_ENABLED !== "false",
    configured: !!token,
  };
}
function text(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  // Review text is plain text. Never execute or render provider HTML/Markdown.
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .normalize("NFC")
    .slice(0, max);
}
const normalize = (v: unknown) =>
  text(v, 500)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const date = (v: unknown) =>
  typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v))
    ? new Date(v).toISOString()
    : null;
export class TmdbReviewClient {
  constructor(
    private readonly token: string,
    private readonly send: typeof fetch = fetch,
  ) {}
  private async get(path: string, signal?: AbortSignal) {
    if (!this.token) fail("REVIEW_PROVIDER_NOT_CONFIGURED");
    if (
      !/^\/(?:movie|tv)\/(?:[1-9][0-9]{0,9})(?:\/reviews\?language=(?:vi-VN|en-US)&page=1)?$/.test(
        path,
      ) &&
      !/^\/search\/(?:movie|tv)\?[^#]*$/.test(path)
    )
      fail("REVIEW_PROVIDER_INVALID_RESPONSE");
    try {
      const response = await this.send("https://api.themoviedb.org/3" + path, {
        redirect: "error",
        headers: {
          Authorization: "Bearer " + this.token,
          Accept: "application/json",
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
      });
      if (response.status === 401 || response.status === 403)
        fail("REVIEW_PROVIDER_AUTH_FAILED");
      if (response.status === 429) fail("REVIEW_PROVIDER_RATE_LIMITED");
      if (!response.ok) fail("REVIEW_PROVIDER_UNAVAILABLE");
      if (!response.headers.get("content-type")?.includes("application/json"))
        fail("REVIEW_PROVIDER_INVALID_RESPONSE");
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > 1024000) fail("REVIEW_PROVIDER_INVALID_RESPONSE");
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (!response.body) fail("REVIEW_PROVIDER_INVALID_RESPONSE");
      for await (const chunk of response.body as any) {
        length += chunk.length;
        if (length > 1024000) fail("REVIEW_PROVIDER_INVALID_RESPONSE");
        chunks.push(chunk);
      }
      let result: any;
      try {
        result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        fail("REVIEW_PROVIDER_INVALID_RESPONSE");
      }
      if (!result || typeof result !== "object" || Array.isArray(result))
        fail("REVIEW_PROVIDER_INVALID_RESPONSE");
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      fail("REVIEW_PROVIDER_UNAVAILABLE");
    }
  }
  async candidates(title: ReviewTitle) {
    if (!this.token) fail("REVIEW_PROVIDER_NOT_CONFIGURED");
    const kind = title.kind === "MOVIE" ? "movie" : "tv";
    const name = title.original_title || title.localized_title;
    const params = new URLSearchParams({
      query: name,
      language: "en-US",
      page: "1",
    });
    if (title.release_year)
      params.set(
        kind === "movie" ? "year" : "first_air_date_year",
        String(title.release_year),
      );
    const body = await this.get("/search/" + kind + "?" + params);
    if (!Array.isArray(body.results)) fail("REVIEW_PROVIDER_INVALID_RESPONSE");
    return body.results
      .slice(0, 10)
      .filter(
        (r: any) =>
          r && Number.isInteger(r.id) && r.id > 0 && r.id <= 2147483647,
      )
      .map((r: any) => ({
        externalId: r.id,
        name: text(r.title || r.name, 300),
        originalName: text(r.original_title || r.original_name, 300),
        releaseDate: text(r.release_date || r.first_air_date, 10),
        kind,
        sourceUrl: "https://www.themoviedb.org/" + kind + "/" + r.id,
        verified: false,
      }));
  }

  async verify(
    title: ReviewTitle,
    id: number,
    signal?: AbortSignal,
  ): Promise<Mapping> {
    if (!Number.isInteger(id) || id < 1 || id > 2147483647)
      fail("REVIEW_MAPPING_MISMATCH");
    const kind = title.kind === "MOVIE" ? "movie" : "tv",
      row = await this.get("/" + kind + "/" + id, signal);
    const names = [title.localized_title, title.original_title]
      .map(normalize)
      .filter(Boolean);
    const remote = [row.title, row.original_title, row.name, row.original_name]
      .map(normalize)
      .filter(Boolean);
    const year = Number(
      String(row.release_date || row.first_air_date || "").slice(0, 4),
    );
    if (
      row.id !== id ||
      !names.some((n) => remote.includes(n)) ||
      title.release_year == null ||
      !year ||
      Math.abs(year - title.release_year) > 1
    )
      fail("REVIEW_MAPPING_MISMATCH");
    return {
      externalId: id,
      kind,
      sourceUrl: "https://www.themoviedb.org/" + kind + "/" + id,
    };
  }
  async reviews(
    mapping: Mapping,
  ): Promise<{ items: ReviewItem[]; language: string; truncated: boolean }> {
    const signal = AbortSignal.timeout(20000);
    let language: "vi-VN" | "en-US" = "vi-VN";
    let body = await this.get(
      "/" +
        mapping.kind +
        "/" +
        mapping.externalId +
        "/reviews?language=" +
        language +
        "&page=1",
      signal,
    );
    const valid = (b: any) =>
      b.id === mapping.externalId &&
      b.page === 1 &&
      Number.isInteger(b.total_pages) &&
      b.total_pages >= 0 &&
      Number.isInteger(b.total_results) &&
      b.total_results >= 0 &&
      Array.isArray(b.results);
    if (!valid(body)) fail("REVIEW_PROVIDER_INVALID_RESPONSE");
    if (!body.results.length) {
      language = "en-US";
      body = await this.get(
        "/" +
          mapping.kind +
          "/" +
          mapping.externalId +
          "/reviews?language=" +
          language +
          "&page=1",
        signal,
      );
    }
    if (!valid(body)) fail("REVIEW_PROVIDER_INVALID_RESPONSE");
    const seen = new Set<string>(),
      items: ReviewItem[] = [];
    for (const row of body.results.slice(0, 20)) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !/^[a-f0-9]{24}$/.test(row.id) ||
        seen.has(row.id)
      )
        fail("REVIEW_PROVIDER_INVALID_RESPONSE");
      const sourceUrl = "https://www.themoviedb.org/review/" + row.id;
      const author = text(row.author, 200),
        content = text(row.content, 12000),
        rating = row.author_details?.rating ?? null;
      if (
        row.url !== sourceUrl ||
        !author ||
        !content ||
        (rating !== null &&
          (typeof rating !== "number" ||
            !Number.isFinite(rating) ||
            rating < 0 ||
            rating > 10))
      )
        fail("REVIEW_PROVIDER_INVALID_RESPONSE");
      seen.add(row.id);
      items.push({
        externalId: row.id,
        author,
        content,
        rating,
        language,
        sourceUrl,
        sourceCreatedAt: date(row.created_at),
        sourceUpdatedAt: date(row.updated_at),
      });
    }
    return {
      items,
      language,
      truncated: body.total_pages > 1 || body.total_results > items.length,
    };
  }
}
