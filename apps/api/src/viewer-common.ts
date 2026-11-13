import { createHmac } from "node:crypto";
import type { Request } from "express";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../packages/database/src/database";
import { Principal, fail } from "./common";
import { AuthService } from "./services/auth.service";
import { configuration } from "./config";
export type ViewerRequest = Request & { requestId: string; actor?: Principal };
export function privateHash(value: string) {
  return createHmac("sha256", configuration().cursor)
    .update(value)
    .digest("hex");
}
export async function optionalActor(req: ViewerRequest, auth: AuthService) {
  if (!req.headers.authorization) return undefined;
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization);
  if (!token) fail("AUTHENTICATION_REQUIRED");
  return auth.authenticate(token[1], req.requestId);
}
export async function checkViewer(tx: Tx, actor: Principal) {
  const row = await one(
    tx,
    "SELECT u.id FROM movie.users u JOIN movie.auth_sessions s ON s.user_id=u.id WHERE u.id=$1::uuid AND s.id=$2::uuid AND u.status='ACTIVE' AND s.state='ACTIVE' AND s.auth_version=u.auth_version AND u.auth_version=$3::bigint AND s.absolute_expires_at>now() AND s.idle_expires_at>now() FOR SHARE OF u,s",
    [actor.id, actor.sid, actor.authVersion],
  );
  if (!row) fail("AUTH_SESSION_REVOKED");
  const staff = await one(
    tx,
    "SELECT 1 FROM movie.user_roles ur JOIN movie.roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid AND r.code<>'MEMBER' LIMIT 1",
    [actor.id],
  );
  if (
    configuration().mfaRequired &&
    staff &&
    !(await one(
      tx,
      "SELECT 1 FROM movie.auth_sessions s WHERE s.id=$1::uuid AND s.mfa_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM movie.mfa_factors f WHERE f.user_id=s.user_id AND f.verified_at IS NOT NULL AND f.disabled_at IS NULL)",
      [actor.sid],
    ))
  )
    fail("AUTH_MFA_REQUIRED");
}
export async function budget(
  db: Database,
  category: string,
  subject: string,
  limit: number,
  seconds: number,
  requestId: string,
) {
  const accepted = await db.$transaction(async (tx) => {
    const subjectHash = privateHash(category + ":" + subject);
    await query(
      tx,
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
      [category + subjectHash],
    );
    const row = await one(
      tx,
      "SELECT count(*)::int AS n FROM movie.security_events WHERE category=$1 AND subject_hash=$2 AND received_at>now()-make_interval(secs=>$3::int)",
      [category, subjectHash, seconds],
    );
    if (row!.n >= limit) return false;
    await query(
      tx,
      "INSERT INTO movie.security_events(category,outcome,subject_hash,request_id) VALUES ($1,'SUCCESS',$2,$3) RETURNING id",
      [category, subjectHash, requestId],
    );
    return true;
  });
  if (!accepted) fail("RATE_LIMITED");
}
export const assetReady = (a = "a") =>
  a +
  ".lifecycle_status='ACTIVE' AND " +
  a +
  ".processing_status='READY' AND " +
  a +
  ".backup_status='VERIFIED' AND EXISTS(SELECT 1 FROM movie.media_attempts ma JOIN movie.media_outputs mo ON mo.attempt_id=ma.id WHERE ma.id=" +
  a +
  ".current_attempt_id AND ma.asset_id=" +
  a +
  ".id AND ma.status='SUCCEEDED' AND mo.format='HLS' AND mo.status='READY' AND mo.config_hash=ma.config_hash AND mo.profile_version=ma.profile_version AND mo.manifest_ref IS NOT NULL AND mo.verified_at IS NOT NULL) AND EXISTS(SELECT 1 FROM movie.source_backups b WHERE b.asset_id=" +
  a +
  ".id AND b.status='VERIFIED' AND b.sha256 IS NOT NULL AND b.bytes=" +
  a +
  ".bytes AND b.source_manifest_ref IS NOT NULL AND b.verified_at IS NOT NULL " +
  (process.env.NODE_ENV === "production"
    ? "AND b.storage_provider='S3' AND b.object_version IS NOT NULL"
    : "") +
  ")";
export const publicEpisode = (e = "e", a = "a", t = "t") =>
  t +
  ".publication_status='PUBLISHED' AND " +
  e +
  ".publication_status='PUBLISHED' AND " +
  assetReady(a);
export const publicTitle = (t = "t") =>
  t +
  ".publication_status='PUBLISHED' AND EXISTS(SELECT 1 FROM movie.episodes ve JOIN movie.video_assets va ON va.id=ve.active_asset_id WHERE ve.title_id=" +
  t +
  ".id AND ve.publication_status='PUBLISHED' AND " +
  assetReady("va") +
  ")";
export const titleFields = (t = "t") =>
  [
    "id",
    "kind",
    "slug",
    "localized_title",
    "original_title",
    "synopsis",
    "release_year",
    "country_codes",
    "original_language",
    "age_rating",
    "poster_asset_ref",
    "backdrop_asset_ref",
    "trailer_asset_ref",
    "published_at",
  ]
    .map((f) => t + "." + f)
    .join(",");
