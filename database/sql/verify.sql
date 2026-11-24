-- Real-server smoke checks. All fixture rows are rolled back.
BEGIN;
SET LOCAL search_path=movie,pg_catalog;
DO $$
DECLARE
    checks integer:=0;
    u1 uuid; u2 uuid; t1 uuid; t2 uuid; season1 uuid;
    e1 uuid; e2 uuid; a1 uuid; a2 uuid; operation1 uuid; attempt1 uuid;
    session1 uuid; auth1 uuid; token1 uuid; family1 uuid:=gen_random_uuid();
    suffix text:=replace(gen_random_uuid()::text,'-','');
    job1 uuid; changed_rows integer;
BEGIN
    ASSERT current_database()='pj_flim','Wrong database';
    ASSERT (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE')IN(47,50,52,54,55,58,59),'Expected baseline 47, recommendations 50 assistant 52 review 54 viewer-review 55 or view-statistics schema 58 or batches 59 tables';
    ASSERT (SELECT count(*) FROM roles)=5,'Expected 5 roles';
    ASSERT (SELECT count(*) FROM permissions)=CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='movie' AND table_name='viewer_reviews' AND column_name='moderation_status') THEN 19 ELSE 18 END,'Unexpected permissions count';
    ASSERT (SELECT count(*) FROM role_permissions)=CASE WHEN EXISTS(SELECT 1 FROM permissions WHERE code='reviews.moderate') THEN 46 ELSE 44 END,'Unexpected role-permission links';
    ASSERT EXISTS(SELECT 1 FROM policy_locks WHERE key='super_admin_roster'),'Missing roster lock';
    IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE')>=50 THEN
      ASSERT (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_name IN('recommendation_preferences','recommendation_feedback','recommendation_snapshots'))=3,'Incomplete recommendation migration';
      ASSERT NOT has_table_privilege('pj_flim_worker','movie.recommendation_snapshots','SELECT'),'Worker reads recommendation feed';
      ASSERT has_table_privilege('pj_flim_api','movie.recommendation_snapshots','INSERT'),'API cannot store recommendation feed';
      checks:=checks+3;
    END IF;
    IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE')>=52 THEN
      ASSERT (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_name IN('assistant_runs','assistant_run_steps'))=2,'Incomplete assistant migration';
      ASSERT NOT has_table_privilege('pj_flim_worker','movie.assistant_runs','SELECT'),'Media worker reads assistant questions';
      ASSERT has_table_privilege('pj_flim_api','movie.assistant_runs','INSERT'),'API cannot create assistant runs';
      checks:=checks+3;
    END IF;
    IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE')>=54 THEN
      ASSERT (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_name IN('review_sources','external_reviews'))=2,'Incomplete review migration';
      ASSERT NOT has_table_privilege('pj_flim_worker','movie.external_reviews','SELECT'),'Media worker reads cached reviews';
      ASSERT has_table_privilege('pj_flim_api','movie.external_reviews','INSERT'),'API cannot cache reviews';
      checks:=checks+3;
    END IF;
    IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE')>=55 THEN
      ASSERT to_regclass('movie.viewer_reviews') IS NOT NULL,'Missing viewer review table';
      ASSERT has_table_privilege('pj_flim_api','movie.viewer_reviews','INSERT'),'API cannot write viewer reviews';
      ASSERT NOT has_table_privilege('pj_flim_worker','movie.viewer_reviews','SELECT'),'Media worker reads viewer reviews';
      ASSERT NOT has_table_privilege('movie_auditor','movie.viewer_reviews','SELECT'),'Auditor reads viewer reviews';
      checks:=checks+4;
    END IF;
    IF to_regclass('movie.view_stats_policy') IS NOT NULL THEN
      ASSERT (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_name IN('view_stats_policy','view_session_facts','view_daily_viewers'))=3,'Incomplete view statistics migration';
      ASSERT has_table_privilege('pj_flim_api','movie.view_stats_policy','SELECT'),'API cannot read view measurement policy';
      ASSERT NOT has_table_privilege('pj_flim_api','movie.title_daily_stats','UPDATE'),'API can forge view counters';
      ASSERT NOT has_table_privilege('pj_flim_api','movie.view_daily_viewers','SELECT'),'API reads private viewer hashes';
      ASSERT NOT has_table_privilege('movie_auditor','movie.view_session_facts','SELECT'),'Auditor reads session facts';
      ASSERT has_table_privilege('pj_flim_worker','movie.view_daily_viewers','DELETE'),'Worker cannot prune daily deduplication';
      ASSERT to_regclass('movie.watch_events_session_sequence_idx') IS NOT NULL,'Missing sequence scan index';
      checks:=checks+7;
    END IF;
    IF EXISTS(SELECT 1 FROM permissions WHERE code='reviews.moderate') THEN
      ASSERT (SELECT count(*) FROM information_schema.columns WHERE table_schema='movie' AND table_name='viewer_reviews' AND column_name IN('moderation_status','moderation_reason','moderated_at','moderated_by'))=4,'Incomplete moderation metadata';
      ASSERT (SELECT array_agg(r.code ORDER BY r.code) FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE p.code='reviews.moderate')=ARRAY['ADMIN','SUPER_ADMIN']::text[],'Wrong moderation permission scope';
      ASSERT NOT EXISTS(SELECT 1 FROM viewer_reviews WHERE moderation_status='HIDDEN' AND (moderated_at IS NULL OR moderation_reason IS NULL)),'Hidden review lacks moderation evidence';
      ASSERT to_regclass('movie.viewer_reviews_moderation_created_idx') IS NOT NULL AND to_regclass('movie.viewer_reviews_admin_created_idx') IS NOT NULL,'Missing moderation indexes';
      checks:=checks+4;
    END IF;
    IF to_regclass('movie.catalog_batches') IS NOT NULL THEN
      ASSERT has_table_privilege('pj_flim_api','movie.catalog_batches','INSERT'),'API cannot create private batches';
      ASSERT NOT has_table_privilege('pj_flim_worker','movie.catalog_batches','SELECT'),'Worker reads private batches';
      ASSERT NOT has_table_privilege('movie_auditor','movie.catalog_batches','SELECT'),'Auditor reads private batches';
      ASSERT to_regclass('movie.catalog_batches_owner_created_idx') IS NOT NULL,'Missing batch owner index';
      checks:=checks+4;
    END IF;
    checks:=checks+6;
    ASSERT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('pj_flim_owner','pj_flim_api','pj_flim_worker') AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)),'Runtime privileges too broad';
    ASSERT NOT pg_has_role('pj_flim_api','pj_flim_owner','MEMBER'),'API inherits owner';
    ASSERT NOT pg_has_role('pj_flim_worker','movie_retention','MEMBER'),'Worker inherits retention';
    ASSERT NOT has_schema_privilege('pj_flim_api','movie','CREATE'),'API can create objects';
    ASSERT NOT has_table_privilege('pj_flim_api','movie.audit_logs','UPDATE'),'Audit UPDATE allowed';
    ASSERT NOT has_table_privilege('pj_flim_api','movie.audit_logs','DELETE'),'Audit DELETE allowed';
    ASSERT NOT has_table_privilege('pj_flim_api','movie.audit_logs','TRUNCATE'),'Audit TRUNCATE allowed';
    checks:=checks+7;
    INSERT INTO users(email_normalized,password_hash,display_name) VALUES ('verify-a-'||suffix||'@example.test','fixture-only','Verify A') RETURNING id INTO u1;
    INSERT INTO users(email_normalized,password_hash,display_name) VALUES ('verify-b-'||suffix||'@example.test','fixture-only','Verify B') RETURNING id INTO u2;
    BEGIN
        INSERT INTO users(email_normalized,password_hash,display_name) VALUES ('verify-a-'||suffix||'@example.test','fixture-only','Duplicate');
        RAISE EXCEPTION 'Expected email unique violation';
    EXCEPTION WHEN unique_violation THEN checks:=checks+1; END;
    BEGIN
        INSERT INTO users(email_normalized,password_hash,display_name) VALUES ('UPPER-'||suffix||'@example.test','fixture-only','Uppercase');
        RAISE EXCEPTION 'Expected normalized email check';
    EXCEPTION WHEN check_violation THEN checks:=checks+1; END;
    INSERT INTO titles(kind,slug,localized_title,normalized_title,created_by,updated_by) VALUES ('SERIES','verify-'||suffix,'Verify','verify',u1,u1) RETURNING id INTO t1;
    INSERT INTO titles(kind,slug,localized_title,normalized_title,created_by,updated_by) VALUES ('SERIES','verify-other-'||suffix,'Other','other',u1,u1) RETURNING id INTO t2;
    INSERT INTO seasons(title_id,number) VALUES (t1,1) RETURNING id INTO season1;
    INSERT INTO episodes(title_id,season_id,number,name) VALUES (t1,season1,1,'One') RETURNING id INTO e1;
    INSERT INTO episodes(title_id,season_id,number,name) VALUES (t1,season1,2,'Two') RETURNING id INTO e2;
    BEGIN
        INSERT INTO episodes(title_id,season_id,number,name) VALUES (t2,season1,3,'Wrong title');
        RAISE EXCEPTION 'Expected season/title FK';
    EXCEPTION WHEN foreign_key_violation THEN checks:=checks+1; END;
    BEGIN
        INSERT INTO episodes(title_id,season_id,number,name) VALUES (t1,season1,1,'Duplicate episode');
        RAISE EXCEPTION 'Expected unique episode number';
    EXCEPTION WHEN unique_violation THEN checks:=checks+1; END;
    INSERT INTO video_assets(episode_id,internal_version,public_id,delivery_type) VALUES (e1,1,'verify/'||suffix||'/one','authenticated') RETURNING id INTO a1;
    INSERT INTO video_assets(episode_id,internal_version,public_id,delivery_type) VALUES (e2,1,'verify/'||suffix||'/two','authenticated') RETURNING id INTO a2;
    BEGIN
        UPDATE episodes SET active_asset_id=a2 WHERE id=e1;
        RAISE EXCEPTION 'Expected active asset ownership FK';
    EXCEPTION WHEN foreign_key_violation THEN checks:=checks+1; END;
    BEGIN
        UPDATE video_assets SET duration_seconds='NaN'::numeric WHERE id=a1;
        RAISE EXCEPTION 'Expected finite duration';
    EXCEPTION WHEN check_violation THEN checks:=checks+1; END;
    BEGIN
        UPDATE video_assets SET processing_status='READY' WHERE id=a1;
        RAISE EXCEPTION 'Expected required READY metadata';
    EXCEPTION WHEN check_violation THEN checks:=checks+1; END;
    BEGIN
        INSERT INTO source_backups(asset_id,storage_provider,bucket,object_key,status) VALUES (a1,'S3','verify',suffix,'VERIFIED');
        RAISE EXCEPTION 'Expected backup checksum metadata';
    EXCEPTION WHEN check_violation THEN checks:=checks+1; END;
    INSERT INTO operations(owner_user_id,principal_scope,type) VALUES (u1,'verify:'||suffix,'MEDIA_PROCESS') RETURNING id INTO operation1;
    INSERT INTO media_attempts(asset_id,operation_id,profile_version,config_hash,status,attempt_no,callback_context_hash)
    VALUES (a1,operation1,'v1',suffix,'VERIFYING_OUTPUT',1,suffix||'-one') RETURNING id INTO attempt1;
    BEGIN
        INSERT INTO media_attempts(asset_id,operation_id,profile_version,config_hash,status,attempt_no,callback_context_hash)
        VALUES (a1,operation1,'v1',suffix,'RECONCILING',2,suffix||'-two');
        RAISE EXCEPTION 'Expected partial unique active attempt';
    EXCEPTION WHEN unique_violation THEN checks:=checks+1; END;
    BEGIN
        UPDATE video_assets SET current_attempt_id=attempt1 WHERE id=a2;
        RAISE EXCEPTION 'Expected current attempt ownership FK';
    EXCEPTION WHEN foreign_key_violation THEN checks:=checks+1; END;
    BEGIN
        INSERT INTO playback_sessions(episode_id,asset_id,asset_version,management_token_hash,telemetry_token_hash,expires_at,max_expires_at)
        VALUES (e1,a1,1,suffix||'-none-m',suffix||'-none-t',now()+interval '1 hour',now()+interval '4 hours');
        RAISE EXCEPTION 'Expected user XOR guest';
    EXCEPTION WHEN check_violation THEN checks:=checks+1; END;
    BEGIN
        INSERT INTO playback_sessions(user_id,guest_id_hash,episode_id,asset_id,asset_version,resume_generation,management_token_hash,telemetry_token_hash,expires_at,max_expires_at)
        VALUES (u1,'guest',e1,a1,1,1,suffix||'-both-m',suffix||'-both-t',now()+interval '1 hour',now()+interval '4 hours');
        RAISE EXCEPTION 'Expected one viewer identity';
    EXCEPTION WHEN check_violation THEN checks:=checks+1; END;
    BEGIN
        INSERT INTO playback_sessions(user_id,episode_id,asset_id,asset_version,resume_generation,management_token_hash,telemetry_token_hash,expires_at,max_expires_at)
        VALUES (u1,e1,a1,99,1,suffix||'-version-m',suffix||'-version-t',now()+interval '1 hour',now()+interval '4 hours');
        RAISE EXCEPTION 'Expected pinned asset version FK';
    EXCEPTION WHEN foreign_key_violation THEN checks:=checks+1; END;
    BEGIN
        INSERT INTO playback_sessions(user_id,episode_id,asset_id,asset_version,resume_generation,management_token_hash,telemetry_token_hash,expires_at,max_expires_at)
        VALUES (u1,e1,a1,1,1,suffix||'-same',suffix||'-same',now()+interval '1 hour',now()+interval '4 hours');
        RAISE EXCEPTION 'Expected separate playback proofs';
    EXCEPTION WHEN check_violation THEN checks:=checks+1; END;
    INSERT INTO playback_sessions(user_id,episode_id,asset_id,asset_version,resume_generation,management_token_hash,telemetry_token_hash,expires_at,max_expires_at)
    VALUES (u1,e1,a1,1,1,suffix||'-m',suffix||'-t',now()+interval '1 hour',now()+interval '4 hours') RETURNING id INTO session1;
    BEGIN
        INSERT INTO resume_heads(user_id,episode_id,generation,active_session_id) VALUES (u2,e1,1,session1);
        RAISE EXCEPTION 'Expected resume owner FK';
    EXCEPTION WHEN foreign_key_violation THEN checks:=checks+1; END;
    BEGIN
        INSERT INTO watch_progress(user_id,episode_id,session_id,asset_id,asset_version,resume_generation,last_sequence,position_seconds)
        VALUES (u2,e1,session1,a1,1,1,1,10);
        RAISE EXCEPTION 'Expected progress owner FK';
    EXCEPTION WHEN foreign_key_violation THEN checks:=checks+1; END;
    INSERT INTO auth_sessions(user_id,state,auth_version,idle_expires_at,absolute_expires_at)
    VALUES (u1,'ACTIVE',1,now()+interval '1 hour',now()+interval '1 day') RETURNING id INTO auth1;
    INSERT INTO refresh_tokens(session_id,family_id,generation,token_hash,expires_at)
    VALUES (auth1,family1,1,suffix||'-refresh-one',now()+interval '1 day') RETURNING id INTO token1;
    BEGIN
        INSERT INTO refresh_tokens(session_id,family_id,generation,token_hash,expires_at)
        VALUES (auth1,family1,2,suffix||'-refresh-two',now()+interval '1 day');
        RAISE EXCEPTION 'Expected one live refresh token per family';
    EXCEPTION WHEN unique_violation THEN checks:=checks+1; END;
    INSERT INTO idempotency_records(actor_scope,method,route_key,request_key_hash,request_fingerprint,expires_at)
    VALUES ('verify:'||suffix,'POST','/verify',suffix,'body',now()+interval '1 day');
    BEGIN
        INSERT INTO idempotency_records(actor_scope,method,route_key,request_key_hash,request_fingerprint,expires_at)
        VALUES ('verify:'||suffix,'POST','/verify',suffix,'different-body',now()+interval '1 day');
        RAISE EXCEPTION 'Expected idempotency scope uniqueness';
    EXCEPTION WHEN unique_violation THEN checks:=checks+1; END;
    INSERT INTO job_runs(handler,logical_key,lease_token) VALUES ('verify',suffix,2) RETURNING id INTO job1;
    UPDATE job_runs SET state='SUCCEEDED',completed_at=now() WHERE id=job1 AND lease_token=1;
    GET DIAGNOSTICS changed_rows=ROW_COUNT;
    ASSERT changed_rows=0,'Stale lease token committed'; checks:=checks+1;
    UPDATE job_runs SET state='SUCCEEDED',completed_at=now() WHERE id=job1 AND lease_token=2;
    GET DIAGNOSTICS changed_rows=ROW_COUNT;
    ASSERT changed_rows=1,'Current lease token rejected'; checks:=checks+1;
    RAISE NOTICE 'Database assertions passed: %; fixture rows will be rolled back.',checks;
END $$;
ROLLBACK;
SELECT json_build_object(
    'database',current_database(),'server',current_setting('server_version'),
    'tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE'),
    'roles',(SELECT count(*) FROM movie.roles),'permissions',(SELECT count(*) FROM movie.permissions),
    'rolePermissionLinks',(SELECT count(*) FROM movie.role_permissions)
);
