export type RatingTitle = {
  kind: string;
  localized_title: string;
  original_title?: string | null;
  release_year?: number | null;
};
export type RatingStatus =
  "READY" | "NOT_CONFIGURED" | "NOT_FOUND" | "UNAVAILABLE";
export type MovieRatings = {
  status: RatingStatus;
  provider: "OMDB";
  imdb: {
    score: number | null;
    votes: number | null;
    url: string | null;
    scale: 10;
  };
  metacritic: { score: number | null; scale: 100 };
  fetchedAt: string | null;
};
export const emptyRatings = (status: RatingStatus): MovieRatings => ({
  status,
  provider: "OMDB",
  imdb: { score: null, votes: null, url: null, scale: 10 },
  metacritic: { score: null, scale: 100 },
  fetchedAt: null,
});
export function ratingsConfiguration() {
  return { key: process.env.OMDB_API_KEY?.trim() || "" };
}
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function score(value: unknown, scale: number): number | null {
  if (value == null || value === "N/A" || value === "") return null;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value))
    throw Error("INVALID_SCORE");
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > scale ||
    (scale === 100 && !Number.isInteger(n))
  )
    throw Error("INVALID_SCORE");
  return n;
}
function votes(value: unknown): number | null {
  if (value == null || value === "N/A" || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value)
  )
    throw Error("INVALID_VOTES");
  const n = Number(value.replace(/,/g, ""));
  if (!Number.isSafeInteger(n) || n > 1e12) throw Error("INVALID_VOTES");
  return n;
}
export class OmdbRatingsClient {
  constructor(
    private readonly key: string,
    private readonly send: typeof fetch = fetch,
  ) {}
  async lookup(title: RatingTitle): Promise<MovieRatings> {
    if (!this.key) return emptyRatings("NOT_CONFIGURED");
    if (!Number.isInteger(title.release_year) || !title.release_year)
      return emptyRatings("NOT_FOUND");
    const kind = title.kind === "MOVIE" ? "movie" : "series";
    const name = title.original_title || title.localized_title;
    // OMDb requires apikey in the query. Never log this URL, exceptions or raw response.
    const url = new URL("https://www.omdbapi.com/");
    url.search = new URLSearchParams({
      apikey: this.key,
      t: name,
      y: String(title.release_year),
      type: kind,
      plot: "short",
      r: "json",
    }).toString();
    try {
      const r = await this.send(url.toString(), {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(6000),
      });
      if (
        !r.ok ||
        !r.headers.get("content-type")?.includes("application/json") ||
        Number(r.headers.get("content-length") || 0) > 256000
      )
        return emptyRatings("UNAVAILABLE");
      if (!r.body) return emptyRatings("UNAVAILABLE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of r.body as any) {
        size += chunk.length;
        if (size > 256000) return emptyRatings("UNAVAILABLE");
        chunks.push(chunk);
      }
      const row = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!row || Array.isArray(row) || typeof row !== "object")
        return emptyRatings("UNAVAILABLE");
      if (row.Response === "False")
        return emptyRatings(
          typeof row.Error === "string" &&
            /^(?:Movie|Series|Episode) not found[.!]?$/i.test(row.Error.trim())
            ? "NOT_FOUND"
            : "UNAVAILABLE",
        );
      if (
        row.Response !== "True" ||
        typeof row.Title !== "string" ||
        typeof row.Year !== "string" ||
        typeof row.imdbID !== "string"
      )
        return emptyRatings("UNAVAILABLE");
      const names = [title.original_title, title.localized_title]
        .filter((n): n is string => !!n)
        .map(normalize)
        .filter(Boolean);
      if (
        !names.includes(normalize(row.Title)) ||
        row.Type !== kind ||
        !/^[0-9]{4}(?:[–-][0-9]{0,4})?$/.test(row.Year) ||
        Number(row.Year.slice(0, 4)) !== title.release_year ||
        !/^tt[0-9]{7,10}$/.test(row.imdbID)
      )
        return emptyRatings("NOT_FOUND");
      const imdbScore = score(row.imdbRating, 10),
        metaScore = score(row.Metascore, 100),
        voteCount = votes(row.imdbVotes);
      return {
        status: "READY",
        provider: "OMDB",
        imdb: {
          score: imdbScore,
          votes: voteCount,
          url: "https://www.imdb.com/title/" + row.imdbID + "/",
          scale: 10,
        },
        metacritic: { score: metaScore, scale: 100 },
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return emptyRatings("UNAVAILABLE");
    }
  }
}
