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
    ASSERT (SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE')=47,'Expected 47 tables';
    ASSERT (SELECT count(*) FROM roles)=5,'Expected 5 roles';
    ASSERT (SELECT count(*) FROM permissions)=18,'Expected 18 permissions';
    ASSERT (SELECT count(*) FROM role_permissions)=44,'Expected 44 role-permission links';
    ASSERT EXISTS(SELECT 1 FROM policy_locks WHERE key='super_admin_roster'),'Missing roster lock';
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
