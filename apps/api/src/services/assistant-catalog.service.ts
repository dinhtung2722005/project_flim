import { Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  Database,
  one,
  query,
  Tx,
} from "../../../../packages/database/src/database";
import { HELP_ARTICLES } from "../../../../packages/assistant/src/help";
import {
  normalized,
  rankCatalog,
  terms,
} from "../../../../packages/assistant/src/search";
import type {
  Evidence,
  Selection,
} from "../../../../packages/contracts/src/assistant";
import { fail, hash, json } from "../common";
import { publicTitle, publicEpisode } from "../viewer-common";
import {
  AssistantFiltersDto,
  AssistantHelpDto,
  AssistantSearchDto,
  AssistantTitleDto,
} from "../dto/assistant.dto";
import { RatingsService } from "./ratings.service";
import { ReviewsService } from "./reviews.service";
type Row = Record<string, any>;
const fields =
  "t.id,t.localized_title,t.original_title,t.kind,t.release_year,t.synopsis,t.version::text AS version,t.country_codes,t.original_language";
const genres =
  "COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',g.slug,'name',g.name) ORDER BY g.slug) FROM movie.title_genres tg JOIN movie.genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id),'[]'::jsonb) AS genres";
const aliases =
  "COALESCE((SELECT array_agg(a.alias) FROM movie.title_aliases a WHERE a.title_id=t.id),ARRAY[]::text[]) AS aliases";
const credits =
  "COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.name,'role',c.role) ORDER BY c.sort_order,c.id) FROM movie.credits c JOIN movie.people p ON p.id=c.person_id WHERE c.title_id=t.id),'[]'::jsonb) AS credits";
export function checkedArgs<T extends object>(
  cls: new () => T,
  value: unknown,
): T {
  const dto = plainToInstance(cls, value);
  if (
    !dto ||
    validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length
  )
    fail("VALIDATION_FAILED");
  return dto;
}
@Injectable()
export class AssistantCatalogService {
  constructor(
    private readonly db: Database,
    private readonly ratings: RatingsService,
    private readonly reviews: ReviewsService,
  ) {}
  private fact(kind: Evidence["kind"], entityId: string, data: Row): Evidence {
    const version = hash(JSON.stringify(data));
    return {
      id: "ev-" + hash(kind + ":" + entityId + ":" + version).slice(0, 32),
      kind,
      entityId,
      version,
      retrievedAt: new Date().toISOString(),
      fields: data,
    };
  }
  private titleFact(row: Row, avoid: boolean) {
    return this.fact("TITLE", row.id, {
      id: row.id,
      name: row.localized_title,
      originalTitle: row.original_title ?? null,
      kind: row.kind,
      year: row.release_year ?? null,
      genres: row.genres ?? [],
      credits: (row.credits ?? []).slice(0, 20),
      countries: row.country_codes ?? [],
      language: row.original_language ?? null,
      version: row.version,
      ...(!avoid ? { synopsis: (row.synopsis ?? "").slice(0, 1000) } : {}),
    });
  }
  async title(id: string, avoid = true, db: Tx = this.db) {
    const row = await one(
      db,
      "SELECT " +
        fields +
        "," +
        genres +
        "," +
        credits +
        " FROM movie.titles t WHERE t.id=$1::uuid AND " +
        publicTitle(),
      [id],
    );
    return row ? this.titleFact(row, avoid) : null;
  }
  async search(
    dto: AssistantSearchDto,
    avoid: boolean,
    forced: AssistantFiltersDto = {},
  ) {
    for (const key of ["kind", "year", "genre", "country"] as const) {
      if (
        forced[key] !== undefined &&
        dto[key] !== undefined &&
        forced[key] !== dto[key]
      )
        fail("AGENT_CONTEXT_CHANGED");
    }
    const f = { ...dto, ...forced };
    const rows = await query(
      this.db,
      "SELECT " +
        fields +
        "," +
        genres +
        "," +
        aliases +
        "," +
        credits +
        " FROM movie.titles t WHERE " +
        publicTitle() +
        " AND ($1::text IS NULL OR t.kind=$1) AND ($2::int IS NULL OR t.release_year=$2) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM movie.title_genres tg JOIN movie.genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND g.slug=$3)) AND ($4::text IS NULL OR $4=ANY(t.country_codes)) ORDER BY t.published_at DESC,t.id DESC LIMIT 1001",
      [f.kind ?? null, f.year ?? null, f.genre ?? null, f.country ?? null],
    );
    const ranked = rankCatalog(
      rows.slice(0, 1000) as any[],
      dto.query,
      dto.limit,
    ).map((r) => this.titleFact(r, avoid));
    return { evidence: ranked, candidateTruncated: rows.length > 1000 };
  }
  async episodes(id: string, avoid: boolean) {
    const title = await this.title(id, avoid);
    if (!title) fail("RESOURCE_NOT_FOUND");
    const rows = await query(
      this.db,
      "SELECT e.id,e.title_id,e.season_id,e.number,e.name,e.version::text AS version,s.number AS season_number,a.duration_seconds FROM movie.episodes e JOIN movie.titles t ON t.id=e.title_id JOIN movie.seasons s ON s.id=e.season_id JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE e.title_id=$1::uuid AND " +
        publicEpisode() +
        " ORDER BY s.number,e.number,e.id LIMIT 21",
      [id],
    );
    return {
      evidence: [
        title,
        ...rows.slice(0, 20).map((r) =>
          this.fact("EPISODE", r.id, {
            id: r.id,
            titleId: r.title_id,
            seasonNumber: r.season_number,
            number: r.number,
            name: r.name,
            version: r.version,
            durationSeconds: Number(r.duration_seconds),
          }),
        ),
      ],
      hasMore: rows.length > 20,
    };
  }
  private async feedback(id: string, loadRatings = false) {
    const [ratings, reviews] = await Promise.all([
      loadRatings ? this.ratings.get(id) : this.ratings.peek(id),
      this.reviews.list(id, { limit: 3 }, false, true),
    ]);
    // Text remains server-side: neither model prompts, embeddings nor run evidence
    // receive third-party review bodies. The hash invalidates changed/purged text.
    const items = reviews.data.map((r: any) => ({
      id: r.id,
      author: r.author,
      rating: r.rating,
      language: r.language,
      sourceUrl: r.sourceUrl,
      fetchedAt: r.fetchedAt,
      contentVersion: hash(String(r.content ?? "")),
    }));
    return {
      fact: this.fact("FEEDBACK", id, {
        titleId: id,
        ratings,
        reviews: { ...reviews.meta, hasMore: reviews.page.hasMore, items },
      }),
      bodies: reviews.data,
    };
  }
  help(q: string) {
    const tokens = terms(q);
    const phrase = normalized(q);
    const ranked = HELP_ARTICLES.map((a) => ({
      a,
      score:
        tokens.reduce((n, t) => n + (a.keywords.includes(t) ? 1 : 0), 0) +
        (phrase.includes(a.id) ? 1 : 0),
    }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return {
      evidence: ranked.map(({ a }) =>
        this.fact("HELP", a.id, {
          id: a.id,
          heading: a.heading,
          text: a.text,
          url: a.url,
        }),
      ),
    };
  }
  private matches(f: Record<string, any>, filter: AssistantFiltersDto) {
    return (
      (!filter.kind || f.kind === filter.kind) &&
      (!filter.year || f.year === filter.year) &&
      (!filter.country || f.countries?.includes(filter.country)) &&
      (!filter.genre || f.genres?.some((g: any) => g.slug === filter.genre))
    );
  }
  async execute(
    tool: string,
    args: unknown,
    avoid: boolean,
    filters: AssistantFiltersDto,
  ) {
    if (tool === "search_catalog")
      return this.search(checkedArgs(AssistantSearchDto, args), avoid, filters);
    if (tool === "get_title_details") {
      const { titleId } = checkedArgs(AssistantTitleDto, args);
      const title = await this.title(titleId, avoid);
      if (!title || !this.matches(title.fields, filters))
        fail("RESOURCE_NOT_FOUND");
      return { evidence: [title] };
    }
    if (tool === "get_title_feedback") {
      const { titleId } = checkedArgs(AssistantTitleDto, args);
      const title = await this.title(titleId, avoid);
      if (!title || !this.matches(title.fields, filters))
        fail("RESOURCE_NOT_FOUND");
      const { fact } = await this.feedback(titleId, true);
      return { evidence: [title, fact] };
    }
    if (tool === "get_published_episodes")
      return this.episodes(checkedArgs(AssistantTitleDto, args).titleId, avoid);
    if (tool === "search_help")
      return this.help(checkedArgs(AssistantHelpDto, args).query);
    fail("AUTH_FORBIDDEN");
  }
  async render(
    selection: Selection,
    stored: Evidence[],
    avoid: boolean,
    filters: AssistantFiltersDto = {},
  ) {
    const selected: Evidence[] = [];
    for (const id of selection.titleIds) {
      const fact = await this.title(id, avoid);
      if (!fact || !this.matches(fact.fields, filters)) return this.changed();
      selected.push(fact);
    }
    for (const id of selection.helpIds) {
      const a = HELP_ARTICLES.find((a) => a.id === id);
      if (!a) return this.changed();
      selected.push(
        this.fact("HELP", a.id, {
          id: a.id,
          heading: a.heading,
          text: a.text,
          url: a.url,
        }),
      );
    }
    for (const id of selection.episodeIds) {
      const r = await one(
        this.db,
        "SELECT e.id,e.title_id,e.season_id,e.number,e.name,e.version::text AS version,s.number AS season_number,a.duration_seconds FROM movie.episodes e JOIN movie.titles t ON t.id=e.title_id JOIN movie.seasons s ON s.id=e.season_id JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE e.id=$1::uuid AND " +
          publicEpisode(),
        [id],
      );
      if (!r) return this.changed();
      selected.push(
        this.fact("EPISODE", id, {
          id: r.id,
          titleId: r.title_id,
          seasonNumber: r.season_number,
          number: r.number,
          name: r.name,
          version: r.version,
          durationSeconds: Number(r.duration_seconds),
        }),
      );
    }
    const feedback: Row[] = [];
    const requestedFeedback = stored.filter(
      (e) => e.kind === "FEEDBACK" && selection.evidenceIds.includes(e.id),
    );
    if (
      requestedFeedback.some((e) => !selection.titleIds.includes(e.entityId)) ||
      new Set(requestedFeedback.map((e) => e.entityId)).size !==
        requestedFeedback.length
    )
      return this.changed();
    for (const old of requestedFeedback) {
      let snapshot;
      try {
        snapshot = await this.feedback(old.entityId);
      } catch {
        return this.changed();
      }
      selected.push(snapshot.fact);
      const f = snapshot.fact.fields as Row;
      const { revision, cacheVersion, ...reviewMetadata } = f.reviews;
      feedback.push({
        titleId: old.entityId,
        titleName: selected.find(
          (e) => e.kind === "TITLE" && e.entityId === old.entityId,
        )?.fields.name,
        ratings: f.ratings,
        reviews: {
          ...reviewMetadata,
          textHidden: avoid,
          items: f.reviews.items.map((item: Row) => {
            const { contentVersion, ...metadata } = item;
            const body = snapshot.bodies.find((r: any) => r.id === item.id);
            return {
              ...metadata,
              ...(!avoid
                ? {
                    excerpt: String(body?.content ?? "").slice(0, 600),
                    truncated: String(body?.content ?? "").length > 600,
                  }
                : {}),
            };
          }),
        },
      });
    }
    for (const current of selected) {
      if (
        !stored.some(
          (old) =>
            selection.evidenceIds.includes(old.id) &&
            old.kind === current.kind &&
            old.entityId === current.entityId &&
            old.version === current.version,
        )
      )
        return this.changed();
    }
    const titleFacts = selected.filter((x) => x.kind === "TITLE"),
      help = selected.filter((x) => x.kind === "HELP"),
      episodes = selected.filter((x) => x.kind === "EPISODE");
    const cards = titleFacts.map((x) => ({
      ...x.fields,
      url: "/titles/" + x.entityId,
    }));
    const sources = selected.map((x) => ({
      id: x.id,
      kind: x.kind,
      entityId: x.entityId,
      label:
        x.kind === "FEEDBACK"
          ? "Điểm OMDb và review TMDB"
          : (x.fields.name ?? x.fields.heading ?? "Nội dung pj-Flim"),
      url:
        x.kind === "HELP"
          ? x.fields.url
          : x.kind === "EPISODE"
            ? "/watch/" + x.entityId
            : "/titles/" + x.entityId,
      retrievedAt: x.retrievedAt,
    }));
    let answer =
      selection.kind === "NEEDS_INPUT"
        ? "Bạn muốn hỏi phim nào? Hãy chọn một phim hoặc nhập tên rõ hơn."
        : cards.length
          ? "Tôi tìm thấy " + cards.length + " phim đang có trong kho."
          : "Chưa tìm thấy phim phù hợp trong kho hiện tại. Bạn có thể thử tên hoặc thể loại khác.";
    if (titleFacts.length === 1 && selection.kind !== "NEEDS_INPUT") {
      const f = titleFacts[0].fields;
      answer =
        String(f.name) +
        (f.year ? " (" + f.year + ")" : "") +
        ". " +
        (Array.isArray(f.genres) && f.genres.length
          ? "Thể loại: " + f.genres.map((g: any) => g.name).join(", ") + ". "
          : "") +
        (Array.isArray(f.credits) && f.credits.length
          ? "Người tham gia: " +
            f.credits
              .map(
                (c: any) =>
                  c.name +
                  " (" +
                  (
                    {
                      ACTOR: "diễn viên",
                      DIRECTOR: "đạo diễn",
                      WRITER: "biên kịch",
                      PRODUCER: "nhà sản xuất",
                    } as Record<string, string>
                  )[c.role] +
                  ")",
              )
              .join(", ") +
            ". "
          : "") +
        (typeof f.synopsis === "string" ? f.synopsis : "");
    }
    if (help.length)
      answer = help
        .map((x) => x.fields.heading + ": " + x.fields.text)
        .join("\n\n");
    if (episodes.length)
      answer =
        "Các tập đang xem được được liệt kê bên dưới. Danh sách hiển thị tối đa 20 tập.";
    if (feedback.length) {
      answer = feedback
        .map((f) => {
          const r = f.ratings;
          const score = (v: unknown, scale: number) =>
            typeof v === "number" ? v + "/" + scale : "chưa có điểm";
          return (
            f.titleName +
            ": IMDb " +
            score(r.imdb.score, 10) +
            "; Metacritic (Metascore) " +
            score(r.metacritic.score, 100) +
            " (nguồn OMDb). " +
            (f.reviews.items.length
              ? "Có " +
                f.reviews.items.length +
                " review người dùng TMDB trong phần hiển thị" +
                (f.reviews.hasMore ? " (còn thêm)." : ".")
              : "Chưa có review TMDB khả dụng.") +
            (avoid && f.reviews.items.length
              ? " Nội dung review được ẩn để tránh tiết lộ phim."
              : "")
          );
        })
        .join("\n\n");
    }
    return json({
      kind: selection.kind,
      answer,
      cards,
      feedback,
      episodes: episodes.map((x) => ({
        ...x.fields,
        url: "/watch/" + x.entityId,
      })),
      sources,
      warnings: [],
    });
  }
  private changed() {
    return {
      kind: "NEEDS_INPUT",
      answer:
        "Thông tin nguồn đã thay đổi. Hãy gửi lại câu hỏi để lấy dữ liệu hiện tại.",
      cards: [],
      episodes: [],
      sources: [],
      warnings: ["AGENT_CONTEXT_CHANGED"],
    };
  }
}
