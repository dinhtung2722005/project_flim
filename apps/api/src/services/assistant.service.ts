import { Injectable } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import {
  Database,
  one,
  query,
  Tx,
} from "../../../../packages/database/src/database";
import {
  Evidence,
  Selection,
  TERMINAL,
} from "../../../../packages/contracts/src/assistant";
import {
  Principal,
  fail,
  hash,
  json,
  pageCursor,
  readCursor,
  secureEqual,
} from "../common";
import { checkViewer } from "../viewer-common";
import { assistantConfiguration } from "../assistant.config";
import { AssistantCatalogService } from "./assistant-catalog.service";
import {
  CreateAssistantRunDto,
  AssistantRunQueryDto,
  AssistantToolDto,
  AssistantResultDto,
} from "../dto/assistant.dto";
type Row = Record<string, any>;
@Injectable()
export class AssistantService {
  constructor(
    private readonly db: Database,
    private readonly catalog: AssistantCatalogService,
  ) {}
  capabilities() {
    const c = assistantConfiguration();
    return {
      enabled: c.enabled,
      engine: c.engine,
      scope: "PUBLIC_CATALOG_HELP_AND_FEEDBACK",
      retentionDays: 7,
      maxContextTurns: 5,
    };
  }
  private enabled() {
    if (!assistantConfiguration().enabled) fail("AGENT_DISABLED");
  }
  private actor(r: Row): Principal {
    return {
      id: r.user_id,
      sid: r.auth_session_id,
      authVersion: r.auth_version.toString(),
      roles: [],
      permissions: [],
      stepUpAt: null,
      requestId: "assistant-" + r.id,
    };
  }
  private async event(tx: Tx, run: Row) {
    await query(
      tx,
      "INSERT INTO movie.outbox_events(type,aggregate_type,aggregate_id,aggregate_version,initiating_actor_id,correlation_id,payload) VALUES ('assistant.run.requested','assistant_run',$1::uuid,$2::bigint,$3::uuid,$4,$5::jsonb) RETURNING id",
      [
        run.id,
        (BigInt(run.generation) + 1n).toString(),
        run.user_id,
        "assistant-" + run.id,
        JSON.stringify({ runId: run.id }),
      ],
    );
  }
  async create(
    actor: Principal,
    dto: CreateAssistantRunDto,
    key: string | undefined,
  ) {
    this.enabled();
    if (!key) fail("IDEMPOTENCY_KEY_REQUIRED");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail("REQUEST_INVALID");
    const filters = {
      kind: dto.filters?.kind,
      year: dto.filters?.year,
      genre: dto.filters?.genre,
      country: dto.filters?.country,
    };
    const options = {
      filters,
      limit: dto.limit,
      avoidSpoilers: dto.avoidSpoilers,
    };
    const fingerprint = hash(
      JSON.stringify({
        message: dto.message,
        ...options,
        contextTitleId: dto.contextTitleId ?? null,
        parentRunId: dto.parentRunId ?? null,
      }),
    );
    return this.db.$transaction(async (tx) => {
      await checkViewer(tx, actor);
      await query(
        tx,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
        ["assistant.user:" + actor.id],
      );
      const old = await one(
        tx,
        "SELECT * FROM movie.assistant_runs WHERE user_id=$1::uuid AND idempotency_key=$2 AND expires_at>clock_timestamp()",
        [actor.id, key],
      );
      if (old) {
        if (old.request_hash !== fingerprint) fail("IDEMPOTENCY_KEY_REUSED");
        return this.summary(old);
      }
      const usage = await one(
        tx,
        "SELECT count(*) FILTER(WHERE created_at>clock_timestamp()-interval '1 minute')::int AS recent,count(*) FILTER(WHERE status IN('QUEUED','RUNNING'))::int AS active FROM movie.assistant_runs WHERE user_id=$1::uuid AND expires_at>clock_timestamp()",
        [actor.id],
      );
      if (usage!.recent >= 10 || usage!.active >= 2) fail("RATE_LIMITED");
      let context = dto.contextTitleId ?? null,
        depth = 0;
      if (dto.parentRunId) {
        const parent = await one(
          tx,
          "SELECT id,context_title_id,context_depth,selection FROM movie.assistant_runs WHERE id=$1::uuid AND user_id=$2::uuid AND status='SUCCEEDED' AND created_at>clock_timestamp()-interval '24 hours' AND expires_at>clock_timestamp()",
          [dto.parentRunId, actor.id],
        );
        if (!parent) fail("RESOURCE_NOT_FOUND");
        depth = parent.context_depth + 1;
        if (depth > 4) fail("AGENT_CONTEXT_CHANGED");
        context =
          context ??
          (parent.selection?.titleIds?.length === 1
            ? parent.selection.titleIds[0]
            : parent.context_title_id);
      }
      if (context && !(await this.catalog.title(context, true, tx)))
        fail("RESOURCE_NOT_FOUND");
      const row = (await one(
        tx,
        "INSERT INTO movie.assistant_runs(user_id,auth_session_id,auth_version,message,options,context_title_id,parent_run_id,context_depth,idempotency_key,request_hash) VALUES($1::uuid,$2::uuid,$3::bigint,$4,$5::jsonb,$6::uuid,$7::uuid,$8,$9,$10) RETURNING *",
        [
          actor.id,
          actor.sid,
          actor.authVersion,
          dto.message,
          JSON.stringify(options),
          context,
          dto.parentRunId ?? null,
          depth,
          key,
          fingerprint,
        ],
      ))!;
      await this.event(tx, row);
      return this.summary(row);
    });
  }
  private summary(r: Row) {
    return json({
      id: r.id,
      status: r.status,
      message: r.message,
      contextTitleId: r.context_title_id,
      parentRunId: r.parent_run_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      errorCode: r.error_code ?? null,
    });
  }
  async list(actor: Principal, dto: AssistantRunQueryDto) {
    this.enabled();
    const scope = { owner: actor.id };
    const cursor = readCursor(dto.cursor, "assistant.runs", scope);
    await checkViewer(this.db, actor);
    const rows = await query(
      this.db,
      "SELECT *,created_at::text AS cursor_time FROM movie.assistant_runs WHERE user_id=$1::uuid AND expires_at>clock_timestamp() AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4",
      [actor.id, cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
    );
    const data = rows.slice(0, dto.limit),
      more = rows.length > dto.limit,
      last = data.at(-1);
    return {
      data: data.map((r) => this.summary(r)),
      page: {
        limit: dto.limit,
        hasMore: more,
        nextCursor: more
          ? pageCursor("assistant.runs", scope, [last!.cursor_time, last!.id])
          : null,
      },
    };
  }
  private async owned(
    actor: Principal,
    id: string,
    tx: Tx = this.db,
    lock = false,
  ) {
    await checkViewer(tx, actor);
    const row = await one(
      tx,
      "SELECT * FROM movie.assistant_runs WHERE id=$1::uuid AND user_id=$2::uuid AND expires_at>clock_timestamp()" +
        (lock ? " FOR UPDATE" : ""),
      [id, actor.id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async get(actor: Principal, id: string) {
    this.enabled();
    const r = await this.owned(actor, id);
    let status = r.status,
      result = null,
      errorCode = r.error_code ?? null;
    if (
      !TERMINAL.has(status) &&
      new Date(r.deadline_at).getTime() <= Date.now()
    ) {
      status = "TIMED_OUT";
      errorCode = "AGENT_TIMEOUT";
    }
    if (status === "SUCCEEDED") {
      const steps = await query(
        this.db,
        "SELECT evidence FROM movie.assistant_run_steps WHERE run_id=$1::uuid AND generation=$2::bigint",
        [id, r.generation.toString()],
      );
      result = await this.catalog.render(
        r.selection,
        steps.flatMap((s) => s.evidence.evidence ?? []),
        r.options.avoidSpoilers,
        r.options.filters,
      );
    }
    await checkViewer(this.db, actor);
    return {
      ...this.summary(r),
      status,
      errorCode,
      result,
      engine: r.engine ?? null,
    };
  }
  async cancel(actor: Principal, id: string) {
    this.enabled();
    return this.db.$transaction(async (tx) => {
      const r = await this.owned(actor, id, tx, true);
      if (!TERMINAL.has(r.status))
        await query(
          tx,
          "UPDATE movie.assistant_runs SET status='CANCELLED',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING id",
          [id],
        );
    });
  }
  checkWorker(value: string | undefined) {
    this.enabled();
    if (!value || !secureEqual(value, assistantConfiguration().secret))
      fail("AUTH_FORBIDDEN");
  }
  private token(r: Row) {
    const p = Buffer.from(
      JSON.stringify({
        v: 1,
        r: r.id,
        g: r.generation.toString(),
        l: r.lease_id,
        e: Math.floor(new Date(r.deadline_at).getTime() / 1000),
      }),
    ).toString("base64url");
    return (
      p +
      "." +
      createHmac("sha256", assistantConfiguration().secret)
        .update(p)
        .digest("base64url")
    );
  }
  private tokenClaims(token: string) {
    try {
      if (token.length > 1024) throw 0;
      const [p, s, ...rest] = token.split(".");
      if (
        rest.length ||
        !s ||
        !secureEqual(
          s,
          createHmac("sha256", assistantConfiguration().secret)
            .update(p)
            .digest("base64url"),
        )
      )
        throw 0;
      const value = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
      if (
        value.v !== 1 ||
        typeof value.g !== "string" ||
        !/^\d+$/.test(value.g) ||
        typeof value.r !== "string" ||
        typeof value.l !== "string" ||
        typeof value.e !== "number" ||
        value.e <= Date.now() / 1000
      )
        throw 0;
      return value;
    } catch {
      fail("AUTH_FORBIDDEN");
    }
  }
  private async leased(tx: Tx, id: string, token: string, checkUser = true) {
    this.enabled();
    const c = this.tokenClaims(token);
    if (c.r !== id) fail("AUTH_FORBIDDEN");
    const r = await one(
      tx,
      "SELECT * FROM movie.assistant_runs WHERE id=$1::uuid AND generation=$2::bigint AND lease_id=$3::uuid AND status='RUNNING' AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE",
      [id, c.g, c.l],
    );
    if (!r) fail("AGENT_CONTEXT_CHANGED");
    if (checkUser) await checkViewer(tx, this.actor(r));
    return r;
  }
  async claim(id: string) {
    this.enabled();
    return this.db.$transaction(async (tx) => {
      const r = await one(
        tx,
        "SELECT * FROM movie.assistant_runs WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (
        !r ||
        TERMINAL.has(r.status) ||
        new Date(r.deadline_at).getTime() <= Date.now() ||
        (r.status === "RUNNING" &&
          new Date(r.lease_until).getTime() > Date.now())
      )
        return { active: false };
      try {
        await checkViewer(tx, this.actor(r));
      } catch {
        await query(
          tx,
          "UPDATE movie.assistant_runs SET status='CANCELLED',error_code='AUTH_SESSION_REVOKED',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING id",
          [id],
        );
        return { active: false };
      }
      if (r.attempt_count >= 3) return { active: false };
      const row = (await one(
        tx,
        "UPDATE movie.assistant_runs SET status='RUNNING',generation=generation+1,lease_id=$2::uuid,lease_until=LEAST(deadline_at,clock_timestamp()+interval '30 seconds'),deadline_at=LEAST(deadline_at,clock_timestamp()+interval '120 seconds'),started_at=COALESCE(started_at,clock_timestamp()),attempt_count=attempt_count+1,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING *",
        [id, randomUUID()],
      ))!;
      return {
        active: true,
        capability: this.token(row),
        run: {
          id: row.id,
          message: row.message,
          ...row.options,
          contextTitleId: row.context_title_id ?? null,
        },
      };
    });
  }
  async heartbeat(id: string, token: string) {
    return this.db.$transaction(async (tx) => {
      await this.leased(tx, id, token);
      await query(
        tx,
        "UPDATE movie.assistant_runs SET lease_until=LEAST(deadline_at,clock_timestamp()+interval '30 seconds') WHERE id=$1::uuid RETURNING id",
        [id],
      );
      return { active: true };
    });
  }
  async tool(id: string, token: string, dto: AssistantToolDto) {
    return this.db.$transaction(
      async (tx) => {
        const r = await this.leased(tx, id, token);
        const old = await one(
          tx,
          "SELECT args_hash,evidence FROM movie.assistant_run_steps WHERE run_id=$1::uuid AND generation=$2::bigint AND call_id=$3",
          [id, r.generation.toString(), dto.callId],
        );
        const fingerprint = hash(
          JSON.stringify({ tool: dto.tool, args: dto.args }),
        );
        if (old) {
          if (old.args_hash !== fingerprint) fail("IDEMPOTENCY_KEY_REUSED");
          return old.evidence;
        }
        const count = await one(
          tx,
          "SELECT count(*)::int AS n FROM movie.assistant_run_steps WHERE run_id=$1::uuid AND generation=$2::bigint",
          [id, r.generation.toString()],
        );
        if (count!.n >= 6) fail("AGENT_TOOL_BUDGET_EXCEEDED");
        const data = await this.catalog.execute(
          dto.tool,
          dto.args,
          r.options.avoidSpoilers,
          r.options.filters,
        );
        await query(
          tx,
          "INSERT INTO movie.assistant_run_steps(run_id,generation,call_id,tool,args_hash,evidence) VALUES($1::uuid,$2::bigint,$3,$4,$5,$6::jsonb) RETURNING id",
          [
            id,
            r.generation.toString(),
            dto.callId,
            dto.tool,
            fingerprint,
            JSON.stringify(data),
          ],
        );
        return data;
      },
      { timeout: 15000 },
    );
  }
  async complete(id: string, token: string, dto: AssistantResultDto) {
    return this.db.$transaction(
      async (tx) => {
        const r = await this.leased(tx, id, token);
        if (dto.engine !== assistantConfiguration().engine)
          fail("AGENT_ANSWER_INVALID");
        const steps = await query(
          tx,
          "SELECT evidence FROM movie.assistant_run_steps WHERE run_id=$1::uuid AND generation=$2::bigint",
          [id, r.generation.toString()],
        );
        const evidence: Evidence[] = steps.flatMap(
          (s) => s.evidence.evidence ?? [],
        );
        const s = dto.selection;
        if (
          !steps.length ||
          s.evidenceIds.some((id) => !evidence.some((e) => e.id === id))
        )
          fail("AGENT_ANSWER_INVALID");
        if (
          (s.kind === "FOUND" && !s.titleIds.length) ||
          (s.kind === "HELP" && !s.helpIds.length) ||
          (s.kind === "EMPTY" &&
            (s.titleIds.length || s.helpIds.length || s.episodeIds.length)) ||
          s.titleIds.length > r.options.limit
        )
          fail("AGENT_ANSWER_INVALID");
        for (const [kind, ids] of [
          ["TITLE", s.titleIds],
          ["HELP", s.helpIds],
          ["EPISODE", s.episodeIds],
        ] as const) {
          if (
            ids.some(
              (entityId) =>
                !evidence.some(
                  (e) =>
                    e.kind === kind &&
                    e.entityId === entityId &&
                    s.evidenceIds.includes(e.id),
                ),
            )
          )
            fail("AGENT_ANSWER_INVALID");
        }
        if (
          evidence.some(
            (e) =>
              e.kind === "FEEDBACK" &&
              s.evidenceIds.includes(e.id) &&
              !s.titleIds.includes(e.entityId),
          )
        )
          fail("AGENT_ANSWER_INVALID");
        const rendered = await this.catalog.render(
          s,
          evidence,
          r.options.avoidSpoilers,
          r.options.filters,
        );
        if (rendered.warnings.length) fail("AGENT_CONTEXT_CHANGED");
        await query(
          tx,
          "UPDATE movie.assistant_runs SET status='SUCCEEDED',selection=$2::jsonb,engine=$3,lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING id",
          [id, JSON.stringify(s), dto.engine],
        );
        return { accepted: true };
      },
      { timeout: 15000 },
    );
  }
  async failure(id: string, token: string, code: string) {
    return this.db.$transaction(async (tx) => {
      await this.leased(tx, id, token, false);
      await query(
        tx,
        "UPDATE movie.assistant_runs SET status=$2,error_code=$3,lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING id",
        [
          id,
          code === "AUTH_SESSION_REVOKED"
            ? "CANCELLED"
            : code === "AGENT_TIMEOUT"
              ? "TIMED_OUT"
              : "FAILED",
          code,
        ],
      );
      return { accepted: true };
    });
  }
  async maintain() {
    if (!assistantConfiguration().enabled) return;
    await this.db.$transaction(async (tx) => {
      await query(
        tx,
        "UPDATE movie.assistant_runs SET status='TIMED_OUT',error_code='AGENT_TIMEOUT',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE status IN('QUEUED','RUNNING') AND (deadline_at<=clock_timestamp() OR attempt_count>=3 AND lease_until<=clock_timestamp()) RETURNING id",
      );
      const retry = await query(
        tx,
        "UPDATE movie.assistant_runs SET status='QUEUED',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id IN(SELECT id FROM movie.assistant_runs WHERE status='RUNNING' AND lease_until<=clock_timestamp() AND deadline_at>clock_timestamp() AND attempt_count<3 LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *",
      );
      for (const r of retry) await this.event(tx, r);
      await query(
        tx,
        "DELETE FROM movie.assistant_runs WHERE id IN(SELECT id FROM movie.assistant_runs WHERE expires_at<=clock_timestamp() LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING id",
      );
    });
  }
}
