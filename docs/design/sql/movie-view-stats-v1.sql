BEGIN;
CREATE TABLE movie.view_stats_policy (
 definition_version smallint PRIMARY KEY CHECK(definition_version=2),
 measurement_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 hash_key_id text CHECK(hash_key_id IS NULL OR hash_key_id ~ '^[a-f0-9]{64}$')
);
INSERT INTO movie.view_stats_policy(definition_version) VALUES(2);
CREATE TABLE movie.view_session_facts (
 session_id uuid PRIMARY KEY REFERENCES movie.playback_sessions(id) ON DELETE CASCADE,
 started boolean NOT NULL DEFAULT false,
 qualified boolean NOT NULL DEFAULT false,
 definition_version smallint NOT NULL DEFAULT 2 CHECK(definition_version=2),
 observed_events integer NOT NULL DEFAULT 0 CHECK(observed_events BETWEEN 0 AND 2001),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE movie.view_daily_viewers (
 title_id uuid NOT NULL REFERENCES movie.titles(id) ON DELETE RESTRICT,
 day date NOT NULL,
 viewer_key text NOT NULL CHECK(viewer_key ~ '^[a-f0-9]{64}$'),
 definition_version smallint NOT NULL DEFAULT 2 CHECK(definition_version=2),
 PRIMARY KEY(title_id,day,viewer_key,definition_version)
);
CREATE INDEX view_daily_viewers_retention_idx ON movie.view_daily_viewers(day);
REVOKE ALL ON movie.view_stats_policy,movie.view_session_facts,movie.view_daily_viewers FROM PUBLIC,movie_api,movie_worker,movie_auditor;
GRANT SELECT ON movie.view_stats_policy TO movie_api;
GRANT SELECT,INSERT,UPDATE ON movie.view_stats_policy,movie.view_session_facts TO movie_worker;
GRANT SELECT,INSERT,DELETE ON movie.view_daily_viewers TO movie_worker;
CREATE INDEX watch_events_session_sequence_idx ON movie.watch_events(session_id,sequence,id);
COMMIT;
