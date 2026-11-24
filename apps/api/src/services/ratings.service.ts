import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Database, one } from "../../../../packages/database/src/database";
import { fail } from "../common";
import { publicTitle } from "../viewer-common";
import {
  OmdbRatingsClient,
  ratingsConfiguration,
  emptyRatings,
  MovieRatings,
  RatingTitle,
} from "../../../../packages/ratings/src/omdb";
@Injectable()
export class RatingsService {
  constructor(private readonly db: Database) {}
  private cache = new Map<string, { expires: number; value: MovieRatings }>();
  private pending = new Map<string, Promise<MovieRatings>>();
  private active = 0;
  private day = "";
  private calls = 0;
  client(key: string) {
    return new OmdbRatingsClient(key);
  }
  private async visible(id: string) {
    const row = await one(
      this.db,
      "SELECT t.id,t.kind,t.localized_title,t.original_title,t.release_year,t.version FROM movie.titles t WHERE t.id=$1::uuid AND " +
        publicTitle(),
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row! as RatingTitle & { id: string; version: bigint };
  }
  /** Rendering a stored answer must never start a provider request. */
  async peek(id: string): Promise<MovieRatings> {
    const title = await this.visible(id),
      config = ratingsConfiguration();
    if (!config.key) return emptyRatings("NOT_CONFIGURED");
    const key =
      id +
      ":" +
      title.version +
      ":" +
      createHash("sha256").update(config.key).digest("hex");
    const cached = this.cache.get(key);
    return cached && cached.expires > Date.now()
      ? cached.value
      : emptyRatings("UNAVAILABLE");
  }
  async get(id: string) {
    const title = await this.visible(id),
      config = ratingsConfiguration();
    if (!config.key) return emptyRatings("NOT_CONFIGURED");
    const cacheKey =
      id +
      ":" +
      title.version +
      ":" +
      createHash("sha256").update(config.key).digest("hex");
    let result: MovieRatings;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      result = cached.value;
    } else {
      const existing = this.pending.get(cacheKey);
      if (existing) result = await existing;
      else {
        const today = new Date().toISOString().slice(0, 10);
        if (this.day !== today) {
          this.day = today;
          this.calls = 0;
        }
        if (this.active >= 2 || this.calls >= 200)
          return emptyRatings("UNAVAILABLE");
        this.calls++;
        this.active++;
        const request = (async () => {
          let value: MovieRatings;
          try {
            value = await this.client(config.key).lookup(title);
          } catch {
            value = emptyRatings("UNAVAILABLE");
          }
          const ttl =
            value.status === "READY"
              ? 86400000
              : value.status === "NOT_FOUND"
                ? 300000
                : 60000;
          this.cache.set(cacheKey, { expires: Date.now() + ttl, value });
          while (this.cache.size > 500)
            this.cache.delete(this.cache.keys().next().value!);
          return value;
        })();
        this.pending.set(cacheKey, request);
        try {
          result = await request;
        } finally {
          this.pending.delete(cacheKey);
          this.active--;
        }
      }
    }
    // A cache never grants eligibility. Check again after a shared external request.
    const current = await this.visible(id);
    return current.version === title.version
      ? result
      : emptyRatings("NOT_FOUND");
  }
}
