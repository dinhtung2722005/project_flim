import { Injectable } from "@nestjs/common";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  fail,
  json,
  normalize,
  pageCursor,
  readCursor,
  paginated,
} from "../common";
import { PageDto } from "../dto/common.dto";
import { PublicTitlesDto } from "../dto/catalog.dto";
import { publicTitle, publicEpisode, titleFields } from "../viewer-common";
@Injectable()
export class PublicCatalogService {
  constructor(private readonly db: Database) {}
  async titles(dto: PublicTitlesDto) {
    const filter = {
      q: normalize(dto.q ?? ""),
      slug: dto.slug ?? null,
      kind: dto.kind ?? null,
      genre: dto.genre ?? null,
      year: dto.year ?? null,
      country: dto.country ?? null,
      sort: dto.sort,
    };
    const cursor = readCursor(dto.cursor, "public.titles", filter);
    const asc = dto.sort === "oldest",
      cmp = asc ? ">" : "<",
      direction = asc ? "ASC" : "DESC";
    const rows = await query(
      this.db,
      "SELECT " +
        titleFields() +
        ",t.published_at::text AS __cursor_time FROM movie.titles t WHERE " +
        publicTitle() +
        " AND ($1='' OR position($1 in t.normalized_title)>0 OR EXISTS(SELECT 1 FROM movie.title_aliases al WHERE al.title_id=t.id AND position($1 in al.normalized_alias)>0) OR EXISTS(SELECT 1 FROM movie.credits cr JOIN movie.people pe ON pe.id=cr.person_id WHERE cr.title_id=t.id AND position($1 in pe.normalized_name)>0)) AND ($2::text IS NULL OR t.slug=$2) AND ($3::text IS NULL OR t.kind=$3) AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM movie.title_genres tg JOIN movie.genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND g.slug=$4)) AND ($5::int IS NULL OR t.release_year=$5) AND ($6::text IS NULL OR $6=ANY(t.country_codes)) AND ($7::timestamptz IS NULL OR (t.published_at,t.id)" +
        cmp +
        "($7::timestamptz,$8::uuid)) ORDER BY t.published_at " +
        direction +
        ",t.id " +
        direction +
        " LIMIT $9",
      [
        filter.q,
        filter.slug,
        filter.kind,
        filter.genre,
        filter.year,
        filter.country,
        cursor?.[0] ?? null,
        cursor?.[1] ?? null,
        dto.limit + 1,
      ],
    );
    return paginated(rows, dto.limit, "public.titles", filter, "published_at");
  }
  async title(id: string, tx: Tx = this.db) {
    const row = await one(
      tx,
      "SELECT " +
        titleFields() +
        " FROM movie.titles t WHERE t.id=$1::uuid AND " +
        publicTitle(),
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async detail(id: string) {
    const row = await this.title(id);
    const genres = await query(
      this.db,
      "SELECT g.id,g.slug,g.name FROM movie.genres g JOIN movie.title_genres tg ON tg.genre_id=g.id WHERE tg.title_id=$1::uuid ORDER BY g.name,g.id",
      [id],
    );
    const credits = await query(
      this.db,
      "SELECT c.id,c.role,c.character_name,c.sort_order,p.id AS person_id,p.name,p.photo_asset_ref FROM movie.credits c JOIN movie.people p ON p.id=c.person_id WHERE c.title_id=$1::uuid ORDER BY c.sort_order,c.id LIMIT 200",
      [id],
    );
    return json({ ...row, genres, credits });
  }
  async genres(dto: PageDto) {
    const cursor = readCursor(dto.cursor, "public.genres", {});
    const rows = await query(
      this.db,
      "SELECT id,slug,name FROM movie.genres WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2",
      [cursor?.[1] ?? null, dto.limit + 1],
    );
    const data = rows.slice(0, dto.limit),
      hasMore = rows.length > dto.limit;
    return {
      data: json(data),
      page: {
        limit: dto.limit,
        hasMore,
        nextCursor: hasMore
          ? pageCursor("public.genres", {}, [
              "1970-01-01T00:00:00.000Z",
              data.at(-1)!.id,
            ])
          : null,
      },
    };
  }
  async seasons(id: string, dto: PageDto) {
    await this.title(id);
    const filter = { titleId: id },
      cursor = readCursor(dto.cursor, "public.seasons", filter);
    const rows = await query(
      this.db,
      "SELECT s.id,s.title_id,s.number,s.name FROM movie.seasons s JOIN movie.titles t ON t.id=s.title_id WHERE s.title_id=$1::uuid AND " +
        publicTitle() +
        " AND EXISTS(SELECT 1 FROM movie.episodes e JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE e.season_id=s.id AND " +
        publicEpisode() +
        ") AND ($2::int IS NULL OR (s.number,s.id)>($2::int,$3::uuid)) ORDER BY s.number,s.id LIMIT $4",
      [
        id,
        cursor ? Number(new Date(cursor[0] as string).getTime()) : null,
        cursor?.[1] ?? null,
        dto.limit + 1,
      ],
    );
    return this.numberPage(rows, dto, "public.seasons", filter);
  }
  private numberPage(
    rows: Record<string, any>[],
    dto: PageDto,
    resource: string,
    filter: object,
  ) {
    const data = rows.slice(0, dto.limit),
      hasMore = rows.length > dto.limit,
      last = data.at(-1);
    return {
      data: json(data),
      page: {
        limit: dto.limit,
        hasMore,
        nextCursor: hasMore
          ? pageCursor(resource, filter, [
              new Date(last!.number).toISOString(),
              last!.id,
            ])
          : null,
      },
    };
  }
  async episodes(id: string, dto: PageDto) {
    const visible = await one(
      this.db,
      "SELECT s.id FROM movie.seasons s JOIN movie.titles t ON t.id=s.title_id WHERE s.id=$1::uuid AND EXISTS(SELECT 1 FROM movie.episodes e JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE e.season_id=s.id AND " +
        publicEpisode() +
        ")",
      [id],
    );
    if (!visible) fail("RESOURCE_NOT_FOUND");
    const filter = { seasonId: id },
      cursor = readCursor(dto.cursor, "public.episodes", filter);
    const rows = await query(
      this.db,
      "SELECT e.id,e.title_id,e.season_id,e.number,e.name,e.synopsis,e.intro_start_seconds,e.intro_end_seconds,e.credits_start_seconds,a.duration_seconds FROM movie.episodes e JOIN movie.titles t ON t.id=e.title_id JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE e.season_id=$1::uuid AND " +
        publicEpisode() +
        " AND ($2::int IS NULL OR (e.number,e.id)>($2::int,$3::uuid)) ORDER BY e.number,e.id LIMIT $4",
      [
        id,
        cursor ? Number(new Date(cursor[0] as string).getTime()) : null,
        cursor?.[1] ?? null,
        dto.limit + 1,
      ],
    );
    return this.numberPage(rows, dto, "public.episodes", filter);
  }
  async episode(id: string, tx: Tx = this.db) {
    const row = await one(
      tx,
      "SELECT e.id,e.title_id,e.season_id,e.number,e.name,e.synopsis,e.intro_start_seconds,e.intro_end_seconds,e.credits_start_seconds,a.duration_seconds FROM movie.episodes e JOIN movie.titles t ON t.id=e.title_id JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE e.id=$1::uuid AND " +
        publicEpisode(),
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async recommendations(id: string, dto: PageDto) {
    await this.title(id);
    const filter = { titleId: id },
      cursor = readCursor(dto.cursor, "public.recommendations", filter);
    return paginated(
      await query(
        this.db,
        "SELECT " +
          titleFields() +
          ",t.published_at::text AS __cursor_time FROM movie.titles t WHERE t.id<>$1::uuid AND " +
          publicTitle() +
          " AND EXISTS(SELECT 1 FROM movie.title_genres own JOIN movie.title_genres other ON other.genre_id=own.genre_id WHERE own.title_id=$1::uuid AND other.title_id=t.id) AND ($2::timestamptz IS NULL OR (t.published_at,t.id)<($2::timestamptz,$3::uuid)) ORDER BY t.published_at DESC,t.id DESC LIMIT $4",
        [id, cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
      ),
      dto.limit,
      "public.recommendations",
      filter,
      "published_at",
    );
  }
}
