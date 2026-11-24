BEGIN;
CREATE TABLE movie.catalog_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES movie.users(id) ON DELETE CASCADE,
 owner_session_id uuid REFERENCES movie.auth_sessions(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN('PUBLISH','UNPUBLISH','ADD_GENRES','REPLACE_GENRES')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 genre_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(genre_ids)<=30),
 state text NOT NULL DEFAULT 'PREVIEW' CHECK(state IN('PREVIEW','RUNNING','COMPLETED')),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 started_at timestamptz,
 finished_at timestamptz,
 CHECK((state='PREVIEW' AND started_at IS NULL AND finished_at IS NULL) OR (state='RUNNING' AND started_at IS NOT NULL AND finished_at IS NULL) OR (state='COMPLETED' AND started_at IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE INDEX catalog_batches_owner_created_idx ON movie.catalog_batches(owner_user_id,created_at DESC,id DESC);
REVOKE ALL ON movie.catalog_batches FROM PUBLIC,movie_api,movie_worker,movie_auditor;
GRANT SELECT,INSERT,UPDATE,DELETE ON movie.catalog_batches TO movie_api;
COMMIT;
