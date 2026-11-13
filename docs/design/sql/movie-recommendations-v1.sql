-- Additive recommendation MVP migration. Run as pj_flim_owner after baseline schema/grants.
-- Intentionally no playback event log, impression tracking or collaborative training.
BEGIN;
CREATE TABLE movie.recommendation_preferences (
 user_id uuid PRIMARY KEY REFERENCES movie.users(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT false,
 hide_completed boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE movie.recommendation_feedback (
 user_id uuid NOT NULL REFERENCES movie.users(id) ON DELETE RESTRICT,
 title_id uuid NOT NULL REFERENCES movie.titles(id) ON DELETE RESTRICT,
 kind text NOT NULL DEFAULT 'NOT_INTERESTED' CHECK (kind='NOT_INTERESTED'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,title_id)
);
CREATE INDEX recommendation_feedback_title_idx ON movie.recommendation_feedback(title_id);
CREATE TABLE movie.recommendation_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES movie.users(id) ON DELETE RESTRICT,
 preference_version bigint NOT NULL CHECK (preference_version > 0),
 model_version text NOT NULL,
 surface text NOT NULL CHECK (surface='home'),
 personalized boolean NOT NULL,
 candidate_truncated boolean NOT NULL,
 items jsonb NOT NULL CHECK (jsonb_typeof(items)='array' AND jsonb_array_length(items)<=100),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '10 minutes'),
 CHECK (expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE INDEX recommendation_snapshots_owner_idx ON movie.recommendation_snapshots(user_id,created_at DESC,id);
CREATE INDEX recommendation_snapshots_expiry_idx ON movie.recommendation_snapshots(expires_at);
GRANT SELECT,INSERT,UPDATE,DELETE ON movie.recommendation_preferences,movie.recommendation_feedback,movie.recommendation_snapshots TO movie_api;
GRANT SELECT,DELETE ON movie.recommendation_snapshots TO movie_retention;
COMMIT;
