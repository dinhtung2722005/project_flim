-- v1.0. Deployment template for a dedicated movie database.
-- DBA must first provision these NOLOGIN group roles and separate login roles:
-- movie_api, movie_worker, movie_auditor, movie_retention.
-- Login roles must not own tables, be superusers, or inherit other groups.
-- Schema/tables remain owned by a separate migration owner.
-- This script deliberately does not create global roles or passwords.
BEGIN;
GRANT USAGE ON SCHEMA movie TO movie_api, movie_worker, movie_auditor, movie_retention;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA movie TO movie_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA movie TO movie_api, movie_worker;
REVOKE INSERT, UPDATE, DELETE ON movie.roles, movie.permissions, movie.role_permissions,
    movie.policy_locks, movie.title_daily_stats FROM movie_api;
-- SELECT ... FOR UPDATE needs UPDATE privilege. No runtime policy-lock insert/delete.
GRANT UPDATE (key) ON movie.policy_locks TO movie_api;
REVOKE UPDATE, DELETE ON movie.audit_logs, movie.security_events FROM movie_api;

GRANT SELECT (id, email_normalized, status, auth_version) ON movie.users TO movie_worker;
GRANT SELECT ON movie.roles, movie.permissions, movie.role_permissions, movie.user_roles,
    movie.titles, movie.title_aliases, movie.seasons, movie.episodes, movie.genres,
    movie.title_genres, movie.people, movie.credits, movie.homepage_banners,
    movie.system_settings, movie.upload_intents, movie.video_assets,
    movie.media_attempts, movie.media_outputs, movie.source_backups,
    movie.subtitle_tracks, movie.playback_sessions, movie.playback_event_batches,
    movie.watch_events, movie.resume_heads, movie.watch_progress, movie.operations,
    movie.outbox_events, movie.inbox_events, movie.job_runs, movie.scheduled_jobs,
    movie.title_daily_stats, movie.audit_exports TO movie_worker;
GRANT INSERT, UPDATE ON movie.video_assets, movie.media_attempts, movie.media_outputs,
    movie.source_backups, movie.subtitle_tracks, movie.playback_event_batches,
    movie.watch_progress, movie.operations, movie.outbox_events, movie.inbox_events,
    movie.job_runs, movie.scheduled_jobs, movie.title_daily_stats, movie.audit_exports TO movie_worker;
-- Narrow SELECT columns on audit for export: no identity credential tables.
GRANT SELECT, INSERT ON movie.audit_logs, movie.security_events TO movie_worker;

GRANT SELECT ON movie.audit_logs, movie.security_events, movie.audit_exports,
    movie.title_daily_stats TO movie_auditor;
-- Retention must archive/verify first; no runtime login inherits this role.
GRANT SELECT, DELETE ON movie.audit_logs, movie.security_events, movie.watch_events,
    movie.playback_event_batches, movie.outbox_events, movie.inbox_events,
    movie.idempotency_records, movie.auth_replay_receipts,
    movie.password_reset_tokens, movie.email_verification_tokens,
    movie.mfa_recovery_codes, movie.mfa_challenges, movie.refresh_tokens,
    movie.auth_sessions, movie.job_runs, movie.scheduled_jobs,
    movie.operations, movie.audit_exports, movie.title_daily_stats TO movie_retention;
-- Credential receipt cleanup preserves replay metadata until its longer TTL.
GRANT UPDATE (encrypted_result, encryption_key_id) ON movie.auth_replay_receipts TO movie_retention;
-- Re-run/review grants in the same deployment after every new table migration.
-- Never grant TRUNCATE, schema CREATE, ownership or membership in the owner role.
COMMIT;
