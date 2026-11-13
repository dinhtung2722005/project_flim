import { Injectable } from "@nestjs/common";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  ApiError,
  Principal,
  audit,
  changedFields,
  checkMutation,
  fail,
  json,
  normalize,
  outbox,
  paginated,
  readCursor,
  requireMatch,
  sqlState,
} from "../common";
import {
  CreateTitleDto,
  UpdateTitleDto,
  CreateSeasonDto,
  UpdateSeasonDto,
  CreateEpisodeDto,
  UpdateEpisodeDto,
  PublicationDto,
  ListDto,
} from "../dto/catalog.dto";
import { PageDto } from "../dto/common.dto";
@Injectable()
export class CatalogService {
  constructor(private readonly db: Database) {}
  private async unique<T>(code: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error: any) {
      if (sqlState(error) === "23505" || error?.code === "P2002")
        throw new ApiError(code);
      throw error;
    }
  }
  private async mutate<T>(
    actor: Principal,
    permission: string,
    action: (tx: Tx) => Promise<T>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await checkMutation(tx, actor, permission);
        return action(tx);
      },
      { timeout: 10000 },
    );
  }
  async titles(dto: ListDto) {
    const filter = { q: dto.q ?? "", status: dto.status ?? "" },
      cursor = readCursor(dto.cursor, "titles", filter);
    const rows = await query(
      this.db,
      "SELECT *,created_at::text AS __cursor_time FROM movie.titles WHERE ($1='' OR normalized_title LIKE '%'||$1||'%') AND ($2='' OR publication_status=$2) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5",
      [
        normalize(dto.q ?? ""),
        dto.status ?? "",
        cursor?.[0] ?? null,
        cursor?.[1] ?? null,
        dto.limit + 1,
      ],
    );
    return paginated(rows, dto.limit, "titles", filter);
  }
  async title(id: string, tx: Tx = this.db): Promise<Record<string, any>> {
    const row = await one(tx, "SELECT * FROM movie.titles WHERE id=$1::uuid", [
      id,
    ]);
    if (!row) fail("RESOURCE_NOT_FOUND");
    const [aliases, genres, credits] = await Promise.all([
      query(
        tx,
        "SELECT id,alias,language FROM movie.title_aliases WHERE title_id=$1::uuid ORDER BY normalized_alias",
        [id],
      ),
      query(
        tx,
        "SELECT g.id,g.slug,g.name FROM movie.genres g JOIN movie.title_genres tg ON tg.genre_id=g.id WHERE tg.title_id=$1::uuid ORDER BY g.name,g.id",
        [id],
      ),
      query(
        tx,
        "SELECT c.id,c.person_id,p.name,c.role,c.character_name,c.sort_order FROM movie.credits c JOIN movie.people p ON p.id=c.person_id WHERE c.title_id=$1::uuid ORDER BY c.sort_order,c.id",
        [id],
      ),
    ]);
    return { ...row, aliases, genres, credits };
  }
  private refs(body: Record<string, any>) {
    for (const key of [
      "posterAssetRef",
      "backdropAssetRef",
      "trailerAssetRef",
      "photoAssetRef",
      "imageAssetRef",
    ])
      if (body[key] && !/^[a-zA-Z0-9_./-]+$/.test(body[key]))
        fail(
          "VALIDATION_FAILED",
          "Media references must be provider identifiers, not URLs or credentials.",
        );
  }
  private async relations(
    tx: Tx,
    id: string,
    body: CreateTitleDto | UpdateTitleDto,
  ) {
    if (body.genreIds !== undefined) {
      await query(
        tx,
        "DELETE FROM movie.title_genres WHERE title_id=$1::uuid RETURNING title_id",
        [id],
      );
      for (const genre of body.genreIds ?? [])
        await query(
          tx,
          "INSERT INTO movie.title_genres(title_id,genre_id) VALUES ($1::uuid,$2::uuid) RETURNING title_id",
          [id, genre],
        );
    }
    if (body.aliases !== undefined) {
      const aliases = body.aliases ?? [],
        normalized = aliases.map((a) => normalize(a.alias));
      if (
        new Set(normalized).size !== aliases.length ||
        normalized.some((a) => !a)
      )
        fail(
          "VALIDATION_FAILED",
          "Aliases must be unique after normalization.",
        );
      await query(
        tx,
        "DELETE FROM movie.title_aliases WHERE title_id=$1::uuid RETURNING id",
        [id],
      );
      for (const a of aliases)
        await query(
          tx,
          "INSERT INTO movie.title_aliases(title_id,alias,normalized_alias,language) VALUES ($1::uuid,$2,$3,$4) RETURNING id",
          [id, a.alias, normalize(a.alias), a.language ?? null],
        );
    }
    if (body.credits !== undefined) {
      const credits = body.credits ?? [],
        keys = credits.map(
          (c) => c.personId + ":" + c.role + ":" + (c.characterName ?? ""),
        );
      if (new Set(keys).size !== keys.length)
        fail("VALIDATION_FAILED", "Duplicate credit.");
      await query(
        tx,
        "DELETE FROM movie.credits WHERE title_id=$1::uuid RETURNING id",
        [id],
      );
      for (const c of credits)
        await query(
          tx,
          "INSERT INTO movie.credits(title_id,person_id,role,character_name,sort_order) VALUES ($1::uuid,$2::uuid,$3,$4,$5) RETURNING id",
          [id, c.personId, c.role, c.characterName ?? "", c.sortOrder ?? 0],
        );
    }
  }
  async createTitle(actor: Principal, body: CreateTitleDto) {
    this.refs(body);
    if (!normalize(body.localizedTitle))
      fail("VALIDATION_FAILED", "Title must not be blank.");
    return this.unique("CATALOG_SLUG_CONFLICT", () =>
      this.mutate(actor, "catalog.write", async (tx) => {
        const row = await one(
          tx,
          "INSERT INTO movie.titles(kind,slug,localized_title,original_title,normalized_title,synopsis,release_year,country_codes,original_language,age_rating,poster_asset_ref,backdrop_asset_ref,trailer_asset_ref,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12,$13,$14::uuid,$14::uuid) RETURNING *",
          [
            body.kind,
            body.slug,
            body.localizedTitle,
            body.originalTitle ?? null,
            normalize(body.localizedTitle),
            body.synopsis ?? "",
            body.releaseYear ?? null,
            body.countryCodes ?? [],
            body.originalLanguage ?? null,
            body.ageRating ?? null,
            body.posterAssetRef ?? null,
            body.backdropAssetRef ?? null,
            body.trailerAssetRef ?? null,
            actor.id,
          ],
        );
        await this.relations(tx, row!.id, body);
        if (body.kind === "MOVIE") {
          const season = await one(
            tx,
            "INSERT INTO movie.seasons(title_id,number,is_technical,name) VALUES ($1::uuid,0,true,'Full movie') RETURNING id",
            [row!.id],
          );
          await query(
            tx,
            "INSERT INTO movie.episodes(title_id,season_id,number,name) VALUES ($1::uuid,$2::uuid,1,$3) RETURNING id",
            [row!.id, season!.id, body.localizedTitle],
          );
        }
        await audit(tx, actor, "catalog.title.created", "title", row!.id, {
          slug: body.slug,
          kind: body.kind,
        });
        await outbox(tx, actor, "title", row!.id, row!.version);
        return this.title(row!.id, tx);
      }),
    );
  }
  async updateTitle(
    actor: Principal,
    id: string,
    body: UpdateTitleDto,
    match: string | undefined,
  ) {
    this.refs(body);
    return this.unique("CATALOG_SLUG_CONFLICT", () =>
      this.mutate(actor, "catalog.write", async (tx) => {
        const current = await one(
          tx,
          "SELECT * FROM movie.titles WHERE id=$1::uuid FOR UPDATE",
          [id],
        );
        if (!current) fail("RESOURCE_NOT_FOUND");
        requireMatch(match, "title", id, current.version);
        if (body.kind !== undefined && body.kind !== current.kind)
          fail(
            "CATALOG_INVALID_PUBLICATION_TRANSITION",
            "A title kind cannot change after creation.",
          );
        if (
          body.localizedTitle !== undefined &&
          !normalize(body.localizedTitle)
        )
          fail("VALIDATION_FAILED");
        const row = await one(
          tx,
          "UPDATE movie.titles SET slug=$2,localized_title=$3,original_title=$4,normalized_title=$5,synopsis=$6,release_year=$7,country_codes=$8::text[],original_language=$9,age_rating=$10,poster_asset_ref=$11,backdrop_asset_ref=$12,trailer_asset_ref=$13,updated_by=$14::uuid,version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING *",
          [
            id,
            body.slug ?? current.slug,
            body.localizedTitle ?? current.localized_title,
            body.originalTitle === undefined
              ? current.original_title
              : body.originalTitle,
            normalize(body.localizedTitle ?? current.localized_title),
            body.synopsis ?? current.synopsis,
            body.releaseYear === undefined
              ? current.release_year
              : body.releaseYear,
            body.countryCodes ?? current.country_codes,
            body.originalLanguage === undefined
              ? current.original_language
              : body.originalLanguage,
            body.ageRating === undefined ? current.age_rating : body.ageRating,
            body.posterAssetRef === undefined
              ? current.poster_asset_ref
              : body.posterAssetRef,
            body.backdropAssetRef === undefined
              ? current.backdrop_asset_ref
              : body.backdropAssetRef,
            body.trailerAssetRef === undefined
              ? current.trailer_asset_ref
              : body.trailerAssetRef,
            actor.id,
          ],
        );
        await this.relations(tx, id, body);
        await audit(tx, actor, "catalog.title.updated", "title", id, {
          changedFields: changedFields(body),
          before: {
            slug: current.slug,
            title: current.localized_title,
            version: current.version,
          },
          after: {
            slug: row!.slug,
            title: row!.localized_title,
            version: row!.version,
          },
        });
        await outbox(tx, actor, "title", id, row!.version);
        return this.title(id, tx);
      }),
    );
  }
  async seasons(titleId: string, dto: PageDto) {
    await this.title(titleId);
    const filter = { titleId },
      cursor = readCursor(dto.cursor, "seasons", filter);
    return paginated(
      await query(
        this.db,
        "SELECT *,created_at::text AS __cursor_time FROM movie.seasons WHERE title_id=$1::uuid AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4",
        [titleId, cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
      ),
      dto.limit,
      "seasons",
      filter,
    );
  }
  async season(id: string, tx: Tx = this.db) {
    const row = await one(tx, "SELECT * FROM movie.seasons WHERE id=$1::uuid", [
      id,
    ]);
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async createSeason(actor: Principal, titleId: string, body: CreateSeasonDto) {
    return this.unique("CATALOG_SEASON_NUMBER_CONFLICT", () =>
      this.mutate(actor, "catalog.write", async (tx) => {
        const title = await one(
          tx,
          "SELECT id,kind FROM movie.titles WHERE id=$1::uuid FOR UPDATE",
          [titleId],
        );
        if (!title) fail("RESOURCE_NOT_FOUND");
        if (title.kind !== "SERIES")
          fail(
            "CATALOG_INVALID_PUBLICATION_TRANSITION",
            "Movies already have one technical season.",
          );
        const row = await one(
          tx,
          "INSERT INTO movie.seasons(title_id,number,name) VALUES ($1::uuid,$2,$3) RETURNING *",
          [titleId, body.number, body.name ?? null],
        );
        await audit(tx, actor, "catalog.season.created", "season", row!.id, {
          titleId,
          number: body.number,
        });
        await outbox(tx, actor, "season", row!.id, row!.version);
        return row!;
      }),
    );
  }
  async updateSeason(
    actor: Principal,
    id: string,
    body: UpdateSeasonDto,
    match: string | undefined,
  ) {
    const parent = await this.season(id);
    return this.unique("CATALOG_SEASON_NUMBER_CONFLICT", () =>
      this.mutate(actor, "catalog.write", async (tx) => {
        await query(
          tx,
          "SELECT id FROM movie.titles WHERE id=$1::uuid FOR UPDATE",
          [parent.title_id],
        );
        const current = await one(
          tx,
          "SELECT * FROM movie.seasons WHERE id=$1::uuid FOR UPDATE",
          [id],
        );
        if (!current) fail("RESOURCE_NOT_FOUND");
        requireMatch(match, "season", id, current.version);
        if (current.is_technical && body.number !== undefined)
          fail("CATALOG_INVALID_PUBLICATION_TRANSITION");
        const row = await one(
          tx,
          "UPDATE movie.seasons SET number=$2,name=$3,version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING *",
          [
            id,
            body.number ?? current.number,
            body.name === undefined ? current.name : body.name,
          ],
        );
        await audit(tx, actor, "catalog.season.updated", "season", id, {
          changedFields: changedFields(body),
          number: row!.number,
          version: row!.version,
        });
        await outbox(tx, actor, "season", id, row!.version);
        return row!;
      }),
    );
  }
  async episodes(seasonId: string, dto: PageDto) {
    await this.season(seasonId);
    const filter = { seasonId },
      cursor = readCursor(dto.cursor, "episodes", filter);
    return paginated(
      await query(
        this.db,
        "SELECT *,created_at::text AS __cursor_time FROM movie.episodes WHERE season_id=$1::uuid AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4",
        [seasonId, cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
      ),
      dto.limit,
      "episodes",
      filter,
    );
  }
  async episode(id: string, tx: Tx = this.db) {
    const row = await one(
      tx,
      "SELECT * FROM movie.episodes WHERE id=$1::uuid",
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async createEpisode(
    actor: Principal,
    seasonId: string,
    body: CreateEpisodeDto,
  ) {
    const parent = await this.season(seasonId);
    return this.unique("CATALOG_EPISODE_NUMBER_CONFLICT", () =>
      this.mutate(actor, "catalog.write", async (tx) => {
        const title = await one(
          tx,
          "SELECT id,kind FROM movie.titles WHERE id=$1::uuid FOR UPDATE",
          [parent.title_id],
        );
        await query(
          tx,
          "SELECT id FROM movie.seasons WHERE id=$1::uuid FOR UPDATE",
          [seasonId],
        );
        if (title!.kind === "MOVIE")
          fail(
            "CATALOG_INVALID_PUBLICATION_TRANSITION",
            "Edit the existing movie episode instead.",
          );
        const row = await one(
          tx,
          "INSERT INTO movie.episodes(title_id,season_id,number,name,synopsis) VALUES ($1::uuid,$2::uuid,$3,$4,$5) RETURNING *",
          [
            parent.title_id,
            seasonId,
            body.number,
            body.name,
            body.synopsis ?? "",
          ],
        );
        await audit(tx, actor, "catalog.episode.created", "episode", row!.id, {
          seasonId,
          number: body.number,
        });
        await outbox(tx, actor, "episode", row!.id, row!.version);
        return row!;
      }),
    );
  }
  private async readiness(tx: Tx, assetId: string | null, episodeId: string) {
    if (!assetId) fail("MEDIA_NOT_READY");
    const asset = await one(
      tx,
      "SELECT * FROM movie.video_assets WHERE id=$1::uuid AND episode_id=$2::uuid FOR UPDATE",
      [assetId, episodeId],
    );
    if (
      !asset ||
      asset.processing_status !== "READY" ||
      asset.lifecycle_status !== "ACTIVE" ||
      !asset.current_attempt_id
    )
      fail("MEDIA_NOT_READY");
    const attempt = await one(
      tx,
      "SELECT id,config_hash,profile_version,status FROM movie.media_attempts WHERE id=$1::uuid AND asset_id=$2::uuid FOR SHARE",
      [asset.current_attempt_id, asset.id],
    );
    if (!attempt || attempt.status !== "SUCCEEDED") fail("MEDIA_NOT_READY");
    const outputs = await query(
      tx,
      "SELECT id FROM movie.media_outputs WHERE attempt_id=$1::uuid AND config_hash=$2 AND format='HLS' AND profile_version=$3 AND status='READY' AND verified_at IS NOT NULL AND manifest_ref IS NOT NULL FOR SHARE",
      [attempt.id, attempt.config_hash, attempt.profile_version],
    );
    if (!outputs.length) fail("MEDIA_NOT_READY");
    const backup = await query(
      tx,
      "SELECT id FROM movie.source_backups WHERE asset_id=$1::uuid AND status='VERIFIED' AND sha256 IS NOT NULL AND bytes=$2::bigint AND bytes>0 AND source_manifest_ref IS NOT NULL AND verified_at IS NOT NULL AND ($3::boolean=false OR (storage_provider='S3' AND object_version IS NOT NULL)) FOR SHARE",
      [asset.id, asset.bytes, process.env.NODE_ENV === "production"],
    );
    if (asset.backup_status !== "VERIFIED" || !backup.length)
      fail("MEDIA_BACKUP_NOT_VERIFIED");
    return asset;
  }
  async updateEpisode(
    actor: Principal,
    id: string,
    body: UpdateEpisodeDto,
    match: string | undefined,
  ) {
    const parent = await this.episode(id);
    return this.unique("CATALOG_EPISODE_NUMBER_CONFLICT", () =>
      this.mutate(actor, "catalog.write", async (tx) => {
        await query(
          tx,
          "SELECT id FROM movie.titles WHERE id=$1::uuid FOR UPDATE",
          [parent.title_id],
        );
        const current = await one(
          tx,
          "SELECT * FROM movie.episodes WHERE id=$1::uuid FOR UPDATE",
          [id],
        );
        if (!current) fail("RESOURCE_NOT_FOUND");
        requireMatch(match, "episode", id, current.version);
        const title = await one(
          tx,
          "SELECT kind FROM movie.titles WHERE id=$1::uuid",
          [parent.title_id],
        );
        if (
          title!.kind === "MOVIE" &&
          body.number !== undefined &&
          body.number !== 1
        )
          fail("CATALOG_INVALID_PUBLICATION_TRANSITION");
        if (body.activeAssetId !== undefined) {
          await checkMutation(tx, actor, "catalog.publish");
          if (body.activeAssetId)
            await this.readiness(tx, body.activeAssetId, id);
          else if (current.publication_status === "PUBLISHED")
            fail("MEDIA_ASSET_IN_USE");
        }
        const introStart =
          body.introStartSeconds === undefined
            ? current.intro_start_seconds
            : body.introStartSeconds;
        const introEnd =
          body.introEndSeconds === undefined
            ? current.intro_end_seconds
            : body.introEndSeconds;
        const credits =
          body.creditsStartSeconds === undefined
            ? current.credits_start_seconds
            : body.creditsStartSeconds;
        if (
          (introStart === null) !== (introEnd === null) ||
          (introStart !== null && Number(introEnd) <= Number(introStart))
        )
          fail(
            "VALIDATION_FAILED",
            "Intro markers must form an increasing pair.",
          );
        const activeId =
          body.activeAssetId === undefined
            ? current.active_asset_id
            : body.activeAssetId;
        if (activeId) {
          const duration = await one(
            tx,
            "SELECT duration_seconds FROM movie.video_assets WHERE id=$1::uuid AND episode_id=$2::uuid",
            [activeId, id],
          );
          if (
            duration?.duration_seconds &&
            [introStart, introEnd, credits].some(
              (v) =>
                v !== null && Number(v) > Number(duration.duration_seconds),
            )
          )
            fail("VALIDATION_FAILED", "Markers exceed video duration.");
        }
        const row = await one(
          tx,
          "UPDATE movie.episodes SET number=$2,name=$3,synopsis=$4,active_asset_id=$5::uuid,intro_start_seconds=$6,intro_end_seconds=$7,credits_start_seconds=$8,version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING *",
          [
            id,
            body.number ?? current.number,
            body.name ?? current.name,
            body.synopsis ?? current.synopsis,
            activeId,
            introStart,
            introEnd,
            credits,
          ],
        );
        await audit(tx, actor, "catalog.episode.updated", "episode", id, {
          changedFields: changedFields(body),
          before: {
            activeAssetId: current.active_asset_id,
            version: current.version,
          },
          after: { activeAssetId: row!.active_asset_id, version: row!.version },
        });
        await outbox(tx, actor, "episode", id, row!.version);
        return row!;
      }),
    );
  }
  async publication(
    actor: Principal,
    id: string,
    body: PublicationDto,
    match: string | undefined,
    type: "title" | "episode",
  ) {
    const parent = type === "episode" ? await this.episode(id) : null;
    return this.mutate(actor, "catalog.publish", async (tx) => {
      const titleId = parent?.title_id ?? id;
      await query(
        tx,
        "SELECT id FROM movie.titles WHERE id=$1::uuid FOR UPDATE",
        [titleId],
      );
      const current = await one(
        tx,
        type === "title"
          ? "SELECT * FROM movie.titles WHERE id=$1::uuid FOR UPDATE"
          : "SELECT * FROM movie.episodes WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!current) fail("RESOURCE_NOT_FOUND");
      requireMatch(match, type, id, current.version);
      if (current.publication_status === "ARCHIVED")
        fail("CATALOG_INVALID_PUBLICATION_TRANSITION");
      if (body.status === current.publication_status) return current;
      if (body.status === "PUBLISHED") {
        if (type === "episode")
          await this.readiness(tx, current.active_asset_id, id);
        else {
          const episodes = await query(
            tx,
            "SELECT id,active_asset_id FROM movie.episodes WHERE title_id=$1::uuid AND publication_status='PUBLISHED' ORDER BY id FOR UPDATE",
            [id],
          );
          let playable = false;
          for (const episode of episodes) {
            try {
              await this.readiness(tx, episode.active_asset_id, episode.id);
              playable = true;
              break;
            } catch (error) {
              if (
                !(error instanceof ApiError) ||
                !["MEDIA_NOT_READY", "MEDIA_BACKUP_NOT_VERIFIED"].includes(
                  error.code,
                )
              )
                throw error;
            }
          }
          if (!playable) fail("CATALOG_NO_PLAYABLE_EPISODE");
        }
      }
      const table = type === "title" ? "movie.titles" : "movie.episodes";
      const row = await one(
        tx,
        "UPDATE " +
          table +
          " SET publication_status=$2,published_at=CASE WHEN $2='PUBLISHED' THEN now() ELSE published_at END,version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING *",
        [id, body.status],
      );
      await audit(
        tx,
        actor,
        "catalog.publication.changed",
        type,
        id,
        { before: current.publication_status, after: body.status },
        body.reason,
      );
      await outbox(tx, actor, type, id, row!.version);
      return row!;
    });
  }
}
