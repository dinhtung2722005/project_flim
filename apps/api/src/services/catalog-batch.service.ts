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
  checkMutation,
  etag,
  fail,
  json,
  paginated,
  readCursor,
  requireMatch,
} from "../common";
import { assetReady } from "../viewer-common";
import { CatalogService } from "./catalog.service";
import {
  CatalogBatchPreviewDto,
  CatalogBatchQueryDto,
} from "../dto/catalog-batch.dto";
import type {
  CatalogBatchAction,
  CatalogBatchItem,
} from "../../../../packages/contracts/src/catalog-batch";
@Injectable()
export class CatalogBatchService {
  constructor(
    private readonly db: Database,
    private readonly catalog: CatalogService,
  ) {}
  private permission(action: CatalogBatchAction) {
    return action === "PUBLISH" || action === "UNPUBLISH"
      ? "catalog.publish"
      : "catalog.write";
  }
  private counts(items: CatalogBatchItem[]) {
    return Object.fromEntries(
      ["READY", "BLOCKED", "UNCHANGED", "APPLIED", "FAILED"].map((s) => [
        s.toLowerCase(),
        items.filter((i) => i.state === s).length,
      ]),
    );
  }
  private body(row: any, a: Principal) {
    return json({
      sameSession: row.owner_session_id === a.sid,
      id: row.id,
      action: row.action,
      reason: row.reason,
      genre_ids: row.genre_ids,
      state: row.state,
      items: row.items,
      counts: this.counts(row.items),
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      expired:
        row.state !== "COMPLETED" && +new Date(row.expires_at) <= Date.now(),
      started_at: row.started_at,
      finished_at: row.finished_at,
    });
  }
  private async owned(tx: Tx, a: Principal, id: string, lock = false) {
    const r = await one(
      tx,
      "SELECT * FROM movie.catalog_batches WHERE id=$1::uuid AND owner_user_id=$2::uuid" +
        (lock ? " FOR UPDATE" : ""),
      [id, a.id],
    );
    if (!r) fail("RESOURCE_NOT_FOUND");
    return r!;
  }
  async list(a: Principal, dto: CatalogBatchQueryDto) {
    const filter = { owner: a.id, state: dto.state ?? "" },
      cursor = readCursor(dto.cursor, "admin.catalog-batches", filter);
    return this.db.$transaction(async (tx) => {
      await checkMutation(tx, a, "catalog.read_drafts");
      const rows = await query(
        tx,
        "SELECT *,created_at::text AS __cursor_time FROM movie.catalog_batches WHERE owner_user_id=$1::uuid AND ($2='' OR state=$2) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5",
        [
          a.id,
          filter.state,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          dto.limit + 1,
        ],
      );
      const summaries = rows.map((r) => ({
        id: r.id,
        action: r.action,
        state: r.state,
        created_at: r.created_at,
        finished_at: r.finished_at,
        expires_at: r.expires_at,
        expired:
          r.state !== "COMPLETED" && +new Date(r.expires_at) <= Date.now(),
        counts: this.counts(r.items),
        __cursor_time: r.__cursor_time,
      }));
      return paginated(summaries, dto.limit, "admin.catalog-batches", filter);
    });
  }
  async get(a: Principal, id: string) {
    return this.db.$transaction(async (tx) => {
      await checkMutation(tx, a, "catalog.read_drafts");
      const r = await this.owned(tx, a, id);
      return {
        body: this.body(r, a),
        etag: etag("catalog-batch", id, r.version),
      };
    });
  }
  async preview(a: Principal, dto: CatalogBatchPreviewDto) {
    if (
      (dto.action === "PUBLISH" || dto.action === "UNPUBLISH") &&
      dto.genreIds !== undefined
    )
      fail("VALIDATION_FAILED", "Publication does not accept genreIds.");
    return this.db.$transaction(
      async (tx) => {
        await checkMutation(tx, a, "catalog.read_drafts");
        await checkMutation(tx, a, this.permission(dto.action));
        const genreIds = [...(dto.genreIds ?? [])].sort();
        if (genreIds.length) {
          const genres = await query(
            tx,
            "SELECT id FROM movie.genres WHERE id=ANY($1::uuid[]) FOR SHARE",
            [genreIds],
          );
          if (genres.length !== genreIds.length)
            fail("RESOURCE_NOT_FOUND", "A genre no longer exists.");
        }
        const rows = await query(
          tx,
          "SELECT t.id,t.localized_title,t.version,t.publication_status,ARRAY(SELECT tg.genre_id::text FROM movie.title_genres tg WHERE tg.title_id=t.id ORDER BY tg.genre_id) AS genre_ids,EXISTS(SELECT 1 FROM movie.episodes e JOIN movie.video_assets va ON va.id=e.active_asset_id WHERE e.title_id=t.id AND e.publication_status='PUBLISHED' AND " +
            assetReady("va") +
            ") AS video_ready FROM movie.titles t WHERE t.id=ANY($1::uuid[])",
          [dto.titleIds],
        );
        const items: CatalogBatchItem[] = dto.titleIds.map((titleId) => {
          const r = rows.find((t) => t.id === titleId);
          if (!r)
            return {
              titleId,
              title: null,
              expectedVersion: null,
              state: "BLOCKED",
              code: "RESOURCE_NOT_FOUND",
            };
          const item: CatalogBatchItem = {
            titleId,
            title: r.localized_title,
            expectedVersion: String(r.version),
            state: "READY",
          };
          if (dto.action === "PUBLISH" || dto.action === "UNPUBLISH") {
            item.beforeStatus = r.publication_status;
            item.targetStatus =
              dto.action === "PUBLISH" ? "PUBLISHED" : "UNPUBLISHED";
            if (r.publication_status === "ARCHIVED") {
              item.state = "BLOCKED";
              item.code = "CATALOG_INVALID_PUBLICATION_TRANSITION";
            } else if (r.publication_status === item.targetStatus)
              item.state = "UNCHANGED";
            else if (dto.action === "PUBLISH" && !r.video_ready) {
              item.state = "BLOCKED";
              item.code = "CATALOG_NO_PLAYABLE_EPISODE";
            }
          } else {
            item.beforeGenreIds = r.genre_ids;
            item.targetGenreIds =
              dto.action === "ADD_GENRES"
                ? [...new Set<string>([...r.genre_ids, ...genreIds])].sort()
                : genreIds;
            if (item.targetGenreIds.length > 30) {
              item.state = "BLOCKED";
              item.code = "VALIDATION_FAILED";
            } else if (
              JSON.stringify(item.beforeGenreIds) ===
              JSON.stringify(item.targetGenreIds)
            )
              item.state = "UNCHANGED";
          }
          return item;
        });
        const r = await one(
          tx,
          "INSERT INTO movie.catalog_batches(owner_user_id,owner_session_id,action,reason,genre_ids,items) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid[],$6::jsonb) RETURNING *",
          [
            a.id,
            a.sid,
            dto.action,
            dto.reason,
            genreIds,
            JSON.stringify(items),
          ],
        );
        await audit(
          tx,
          a,
          "catalog.batch.previewed",
          "catalog_batch",
          r!.id,
          {
            action: dto.action,
            total: items.length,
            counts: this.counts(items),
          },
          dto.reason,
        );
        return {
          body: this.body(r, a),
          etag: etag("catalog-batch", r!.id, r!.version),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 10000 },
    );
  }
  private async allowed(tx: Tx, a: Principal, r: any) {
    await checkMutation(tx, a, "catalog.read_drafts");
    await checkMutation(tx, a, this.permission(r.action));
    if (r.owner_session_id !== a.sid)
      fail(
        "RESOURCE_CONFLICT",
        "Create a new preview in the current login session.",
      );
    if (+new Date(r.expires_at) <= Date.now() && r.state !== "COMPLETED")
      fail("RESOURCE_CONFLICT", "The batch expired. Create a new preview.");
  }
  async execute(a: Principal, id: string, match?: string) {
    const started = await this.db.$transaction(async (tx) => {
      const r = await this.owned(tx, a, id, true);
      await this.allowed(tx, a, r);
      if (r.state === "PREVIEW") {
        requireMatch(match, "catalog-batch", id, r.version);
        if (!r.items.some((i: CatalogBatchItem) => i.state === "READY"))
          fail("RESOURCE_CONFLICT", "No ready items in this preview.");
        await query(
          tx,
          "UPDATE movie.catalog_batches SET state='RUNNING',started_at=clock_timestamp(),expires_at=clock_timestamp()+interval '15 minutes',version=version+1,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING id",
          [id],
        );
        await audit(
          tx,
          a,
          "catalog.batch.started",
          "catalog_batch",
          id,
          { action: r.action },
          r.reason,
        );
      } else if (
        match !== etag("catalog-batch", id, 1) &&
        match !== etag("catalog-batch", id, r.version)
      ) {
        requireMatch(match, "catalog-batch", id, r.version);
      }
      return r;
    });
    if (started.state !== "COMPLETED") {
      for (let index = 0; index < started.items.length; index++) {
        try {
          await this.db.$transaction(
            async (tx) => {
              const r = await this.owned(tx, a, id, true);
              await this.allowed(tx, a, r);
              if (r.state !== "RUNNING") return;
              const item: CatalogBatchItem = r.items[index];
              if (item.state !== "READY") return;
              const version = etag(
                "title",
                item.titleId,
                item.expectedVersion!,
              );
              const changed =
                r.action === "PUBLISH" || r.action === "UNPUBLISH"
                  ? await this.catalog.publication(
                      a,
                      item.titleId,
                      { status: item.targetStatus!, reason: r.reason },
                      version,
                      "title",
                      tx,
                    )
                  : await this.catalog.updateTitle(
                      a,
                      item.titleId,
                      { genreIds: item.targetGenreIds },
                      version,
                      tx,
                    );
              r.items[index] = {
                ...item,
                state: "APPLIED",
                resultVersion: String(changed.version),
              };
              await query(
                tx,
                "UPDATE movie.catalog_batches SET items=$2::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=$1::uuid",
                [id, JSON.stringify(r.items)],
              );
              await audit(
                tx,
                a,
                "catalog.batch.item.applied",
                "catalog_batch",
                id,
                {
                  titleId: item.titleId,
                  resultVersion: String(changed.version),
                },
                r.reason,
              );
            },
            { timeout: 10000 },
          );
        } catch (e) {
          if (
            !(e instanceof ApiError) ||
            e.status >= 500 ||
            e.code.startsWith("AUTH") ||
            e.code === "RESOURCE_CONFLICT"
          )
            throw e;
          await this.db.$transaction(async (tx) => {
            const r = await this.owned(tx, a, id, true);
            await this.allowed(tx, a, r);
            if (r.state !== "RUNNING" || r.items[index].state !== "READY")
              return;
            r.items[index] = {
              ...r.items[index],
              state: "FAILED",
              code: e.code,
            };
            await query(
              tx,
              "UPDATE movie.catalog_batches SET items=$2::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=$1::uuid",
              [id, JSON.stringify(r.items)],
            );
            await audit(
              tx,
              a,
              "catalog.batch.item.failed",
              "catalog_batch",
              id,
              { titleId: r.items[index].titleId, code: e.code },
              r.reason,
            );
          });
        }
      }
      await this.db.$transaction(async (tx) => {
        const r = await this.owned(tx, a, id, true);
        await this.allowed(tx, a, r);
        if (
          r.state !== "RUNNING" ||
          r.items.some((i: CatalogBatchItem) => i.state === "READY")
        )
          return;
        await query(
          tx,
          "UPDATE movie.catalog_batches SET state='COMPLETED',finished_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1::uuid",
          [id],
        );
        await audit(
          tx,
          a,
          "catalog.batch.completed",
          "catalog_batch",
          id,
          { counts: this.counts(r.items) },
          r.reason,
        );
      });
    }
    return this.get(a, id);
  }
}
