BEGIN;
DO $$
BEGIN
    IF current_database() <> 'pj_flim' OR current_user <> 'pj_flim_owner' THEN
        RAISE EXCEPTION 'Unexpected database or owner';
    END IF;
END $$;
REVOKE ALL ON DATABASE pj_flim FROM PUBLIC;
GRANT CONNECT ON DATABASE pj_flim TO movie_api, movie_worker, movie_auditor, movie_retention;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DATABASE pj_flim SET timezone TO 'UTC';
ALTER DATABASE pj_flim SET search_path TO movie, pg_catalog;
COMMIT;
