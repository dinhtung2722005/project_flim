import { Injectable } from "@nestjs/common";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  Principal,
  assertStepUp,
  audit,
  changedFields,
  checkMutation,
  fail,
  json,
  normalize,
  pageCursor,
  paginated,
  readCursor,
  requireMatch,
  requireRowMatch,
} from "../common";
import {
  CreateGenreDto,
  UpdateGenreDto,
  CreatePersonDto,
  UpdatePersonDto,
  CreateBannerDto,
  UpdateBannerDto,
  SiteSettingsDto,
} from "../dto/resources.dto";
import { PageDto } from "../dto/common.dto";
import { AuditQueryDto } from "../dto/audit.dto";
import { ReportsQueryDto } from "../dto/reports.dto";
@Injectable()
export class ResourcesService {
  constructor(private readonly db: Database) {}
  private async mutate<T>(
    actor: Principal,
    permission: string,
    action: (tx: Tx) => Promise<T>,
  ) {
    return this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, permission);
      return action(tx);
    });
  }
  private refs(value: string | undefined | null) {
    if (value && !/^[A-Za-z0-9_./-]+$/.test(value))
      fail("VALIDATION_FAILED", "Use a provider reference, not a signed URL.");
  }
  async genres(dto: PageDto) {
    const cursor = readCursor(dto.cursor, "genres", {}),
      rows = await query(
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
          ? pageCursor("genres", {}, [
              "1970-01-01T00:00:00.000Z",
              data.at(-1)!.id,
            ])
          : null,
      },
    };
  }
  async genre(id: string) {
    const row = await one(
      this.db,
      "SELECT * FROM movie.genres WHERE id=$1::uuid",
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async createGenre(actor: Principal, body: CreateGenreDto) {
    return this.mutate(actor, "catalog.write", async (tx) => {
      const row = await one(
        tx,
        "INSERT INTO movie.genres(slug,name) VALUES ($1,$2) RETURNING *",
        [body.slug, body.name],
      );
      const auditVersion = await audit(
        tx,
        actor,
        "catalog.genre.created",
        "genre",
        row!.id,
        { slug: body.slug },
      );
      await this.catalogEvent(tx, actor, "genre", row!.id, auditVersion);
      return row!;
    });
  }
  async updateGenre(
    actor: Principal,
    id: string,
    body: UpdateGenreDto,
    match: string | undefined,
  ) {
    return this.mutate(actor, "catalog.write", async (tx) => {
      const current = await one(
        tx,
        "SELECT * FROM movie.genres WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!current) fail("RESOURCE_NOT_FOUND");
      requireRowMatch(match, "genre", current);
      const row = await one(
        tx,
        "UPDATE movie.genres SET slug=$2,name=$3 WHERE id=$1::uuid RETURNING *",
        [id, body.slug ?? current.slug, body.name ?? current.name],
      );
      const auditVersion = await audit(
        tx,
        actor,
        "catalog.genre.updated",
        "genre",
        id,
        { changedFields: changedFields(body), before: current, after: row },
      );
      await this.catalogEvent(tx, actor, "genre", id, auditVersion);
      return row!;
    });
  }
  async people(dto: PageDto) {
    const cursor = readCursor(dto.cursor, "people", {});
    return paginated(
      await query(
        this.db,
        "SELECT *,created_at::text AS __cursor_time FROM movie.people WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid)) ORDER BY created_at DESC,id DESC LIMIT $3",
        [cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
      ),
      dto.limit,
      "people",
      {},
    );
  }
  async person(id: string) {
    const row = await one(
      this.db,
      "SELECT * FROM movie.people WHERE id=$1::uuid",
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async createPerson(actor: Principal, body: CreatePersonDto) {
    this.refs(body.photoAssetRef);
    return this.mutate(actor, "catalog.write", async (tx) => {
      const row = await one(
        tx,
        "INSERT INTO movie.people(name,normalized_name,biography,photo_asset_ref) VALUES ($1,$2,$3,$4) RETURNING *",
        [
          body.name,
          normalize(body.name),
          body.biography ?? "",
          body.photoAssetRef ?? null,
        ],
      );
      const auditVersion = await audit(
        tx,
        actor,
        "catalog.person.created",
        "person",
        row!.id,
        { name: body.name },
      );
      await this.catalogEvent(tx, actor, "person", row!.id, auditVersion);
      return row!;
    });
  }
  async updatePerson(
    actor: Principal,
    id: string,
    body: UpdatePersonDto,
    match: string | undefined,
  ) {
    this.refs(body.photoAssetRef);
    return this.mutate(actor, "catalog.write", async (tx) => {
      const current = await one(
        tx,
        "SELECT * FROM movie.people WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!current) fail("RESOURCE_NOT_FOUND");
      requireRowMatch(match, "person", current);
      const row = await one(
        tx,
        "UPDATE movie.people SET name=$2,normalized_name=$3,biography=$4,photo_asset_ref=$5,updated_at=now() WHERE id=$1::uuid RETURNING *",
        [
          id,
          body.name ?? current.name,
          normalize(body.name ?? current.name),
          body.biography ?? current.biography,
          body.photoAssetRef === undefined
            ? current.photo_asset_ref
            : body.photoAssetRef,
        ],
      );
      const auditVersion = await audit(
        tx,
        actor,
        "catalog.person.updated",
        "person",
        id,
        { changedFields: changedFields(body), name: row!.name },
      );
      await this.catalogEvent(tx, actor, "person", id, auditVersion);
      return row!;
    });
  }
  private async catalogEvent(
    tx: Tx,
    actor: Principal,
    type: string,
    id: string,
    version: bigint,
  ) {
    await query(
      tx,
      "INSERT INTO movie.outbox_events(type,aggregate_type,aggregate_id,aggregate_version,initiating_actor_id,correlation_id,payload) VALUES ('catalog.changed',$1,$2::uuid,$5::bigint,$3::uuid,$4,$6::jsonb) RETURNING id",
      [
        type,
        id,
        actor.id,
        actor.requestId,
        version.toString(),
        JSON.stringify({ resourceType: type, resourceId: id }),
      ],
    );
  }
  async banners(dto: PageDto) {
    const cursor = readCursor(dto.cursor, "banners", {});
    return paginated(
      await query(
        this.db,
        "SELECT *,created_at::text AS __cursor_time FROM movie.homepage_banners WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid)) ORDER BY created_at DESC,id DESC LIMIT $3",
        [cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
      ),
      dto.limit,
      "banners",
      {},
    );
  }
  async banner(id: string) {
    const row = await one(
      this.db,
      "SELECT * FROM movie.homepage_banners WHERE id=$1::uuid",
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async createBanner(actor: Principal, body: CreateBannerDto) {
    this.refs(body.imageAssetRef);
    return this.mutate(actor, "catalog.write", async (tx) => {
      const row = await one(
        tx,
        "INSERT INTO movie.homepage_banners(title_id,image_asset_ref,headline,sort_order,enabled,starts_at,ends_at,updated_by) VALUES ($1::uuid,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::uuid) RETURNING *",
        [
          body.titleId,
          body.imageAssetRef,
          body.headline ?? null,
          body.sortOrder ?? 0,
          body.enabled ?? false,
          body.startsAt ?? null,
          body.endsAt ?? null,
          actor.id,
        ],
      );
      await audit(tx, actor, "catalog.banner.created", "banner", row!.id, {
        titleId: body.titleId,
      });
      await this.catalogEvent(tx, actor, "banner", row!.id, row!.version);
      return row!;
    });
  }
  async updateBanner(
    actor: Principal,
    id: string,
    body: UpdateBannerDto,
    match: string | undefined,
  ) {
    this.refs(body.imageAssetRef);
    return this.mutate(actor, "catalog.write", async (tx) => {
      const current = await one(
        tx,
        "SELECT * FROM movie.homepage_banners WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!current) fail("RESOURCE_NOT_FOUND");
      requireMatch(match, "banner", id, current.version);
      const row = await one(
        tx,
        "UPDATE movie.homepage_banners SET title_id=$2::uuid,image_asset_ref=$3,headline=$4,sort_order=$5,enabled=$6,starts_at=$7::timestamptz,ends_at=$8::timestamptz,updated_by=$9::uuid,version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING *",
        [
          id,
          body.titleId ?? current.title_id,
          body.imageAssetRef ?? current.image_asset_ref,
          body.headline === undefined ? current.headline : body.headline,
          body.sortOrder ?? current.sort_order,
          body.enabled ?? current.enabled,
          body.startsAt === undefined ? current.starts_at : body.startsAt,
          body.endsAt === undefined ? current.ends_at : body.endsAt,
          actor.id,
        ],
      );
      await audit(tx, actor, "catalog.banner.updated", "banner", id, {
        changedFields: changedFields(body),
        enabled: row!.enabled,
        version: row!.version,
      });
      await this.catalogEvent(tx, actor, "banner", id, row!.version);
      return row!;
    });
  }
  async settings() {
    const row = await one(
      this.db,
      "SELECT * FROM movie.system_settings WHERE key='site'",
    );
    if (!row)
      fail(
        "RESOURCE_NOT_FOUND",
        "Run admin bootstrap to initialize site settings.",
      );
    return row;
  }
  async updateSettings(
    actor: Principal,
    body: SiteSettingsDto,
    match: string | undefined,
  ) {
    assertStepUp(actor);
    return this.mutate(actor, "settings.write", async (tx) => {
      const current = await one(
        tx,
        "SELECT * FROM movie.system_settings WHERE key='site' FOR UPDATE",
      );
      if (!current) fail("RESOURCE_NOT_FOUND");
      requireMatch(match, "settings", "site", current.version);
      const row = await one(
        tx,
        "UPDATE movie.system_settings SET value=$1::jsonb,version=version+1,updated_by=$2::uuid,updated_at=now() WHERE key='site' RETURNING *",
        [JSON.stringify(body), actor.id],
      );
      await audit(tx, actor, "settings.updated", "settings", "site", {
        before: current.value,
        after: body,
      });
      return row!;
    });
  }
  async summary() {
    return one(
      this.db,
      "SELECT (SELECT count(*) FROM movie.titles) AS titles,(SELECT count(*) FROM movie.titles WHERE publication_status='PUBLISHED') AS published_titles,(SELECT count(*) FROM movie.episodes) AS episodes,(SELECT count(*) FROM movie.users WHERE status='ACTIVE') AS active_users,(SELECT count(*) FROM movie.content_reports WHERE status='OPEN') AS open_reports,(SELECT coalesce(sum(qualified_views),0)::text FROM movie.title_daily_stats WHERE day>=current_date-7 AND definition_version=1) AS views_last_seven_days",
    );
  }
  async reports(actor: Principal, dto: ReportsQueryDto) {
    const filter = { status: dto.status ?? "" },
      cursor = readCursor(dto.cursor, "reports", filter);
    const auditor =
      actor.roles.includes("AUDITOR") &&
      !actor.roles.some((r) => ["EDITOR", "ADMIN", "SUPER_ADMIN"].includes(r));
    const columns = auditor
      ? "id,title_id,episode_id,category,status,version,created_at,updated_at"
      : "id,title_id,episode_id,category,message,status,version,handled_by,resolution_note,created_at,updated_at";
    return paginated(
      await query(
        this.db,
        "SELECT " +
          columns +
          ",created_at::text AS __cursor_time FROM movie.content_reports WHERE ($1='' OR status=$1) AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4",
        [
          dto.status ?? "",
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          dto.limit + 1,
        ],
      ),
      dto.limit,
      "reports",
      filter,
    );
  }
  async auditLogs(actor: Principal, dto: AuditQueryDto) {
    const from = dto.from ?? new Date(Date.now() - 7 * 86400000).toISOString(),
      to = dto.to ?? new Date().toISOString();
    if (
      Date.parse(to) < Date.parse(from) ||
      Date.parse(to) - Date.parse(from) > 31 * 86400000
    )
      fail(
        "VALIDATION_FAILED",
        "Audit date range must be ordered and at most 31 days.",
      );
    const filter = {
        from: dto.from ?? "",
        to: dto.to ?? "",
        actorId: dto.actorId ?? "",
        action: dto.action ?? "",
      },
      cursor = readCursor(dto.cursor, "audit", filter);
    await this.db.$transaction((tx) =>
      audit(tx, actor, "audit.read", "audit", "query", { from, to }),
    );
    return paginated(
      await query(
        this.db,
        "SELECT id,actor_user_id,initiator_user_id,actor_kind,actor_role_codes_snapshot,action,resource_type,resource_id,outcome,safe_diff,reason,error_code,request_id,trace_id,occurred_at,occurred_at::text AS __cursor_time FROM movie.audit_logs WHERE occurred_at>=$1::timestamptz AND occurred_at<=$2::timestamptz AND ($3::uuid IS NULL OR actor_user_id=$3::uuid) AND ($4='' OR action=$4) AND ($5::timestamptz IS NULL OR (occurred_at,id)<($5::timestamptz,$6::bigint)) ORDER BY occurred_at DESC,id DESC LIMIT $7",
        [
          from,
          to,
          dto.actorId ?? null,
          dto.action ?? "",
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          dto.limit + 1,
        ],
      ),
      dto.limit,
      "audit",
      filter,
      "occurred_at",
    );
  }
  async auditLog(actor: Principal, id: string) {
    if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
      fail("REQUEST_INVALID_IDENTIFIER");
    const row = await one(
      this.db,
      "SELECT * FROM movie.audit_logs WHERE id=$1::bigint",
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    await this.db.$transaction((tx) =>
      audit(tx, actor, "audit.read", "audit", id),
    );
    return row;
  }
  async mediaAsset(id: string) {
    const row = await one(
      this.db,
      "SELECT id,episode_id,provider,internal_version,processing_status,lifecycle_status,backup_status,duration_seconds,width,height,bytes,current_attempt_id,version,created_at,updated_at FROM movie.video_assets WHERE id=$1::uuid",
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async attempt(id: string) {
    const row = await one(
      this.db,
      "SELECT id,asset_id,operation_id,profile_version,status,attempt_no,error_code,created_at,updated_at,completed_at FROM movie.media_attempts WHERE id=$1::uuid",
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async operation(actor: Principal, id: string) {
    const row = await one(
      this.db,
      "SELECT id,type,resource_type,resource_id,status,progress,result_ref,error_code,error_message,error_retryable,created_at,updated_at,completed_at FROM movie.operations WHERE id=$1::uuid AND owner_user_id=$2::uuid",
      [id, actor.id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
}
