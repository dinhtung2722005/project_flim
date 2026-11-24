BEGIN;
SET LOCAL search_path=movie,pg_catalog;
CREATE TABLE movie.assistant_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES movie.users(id),
 auth_session_id uuid NOT NULL REFERENCES movie.auth_sessions(id),
 auth_version bigint NOT NULL CHECK(auth_version>0),
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')),
 message text NOT NULL CHECK(length(btrim(message)) BETWEEN 1 AND 2000),
 options jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(options)='object'),
 context_title_id uuid REFERENCES movie.titles(id) ON DELETE SET NULL,
 parent_run_id uuid REFERENCES movie.assistant_runs(id) ON DELETE SET NULL,
 context_depth smallint NOT NULL DEFAULT 0 CHECK(context_depth BETWEEN 0 AND 4),
 idempotency_key varchar(128) NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
 lease_id uuid,
 lease_until timestamptz,
 started_at timestamptz,
 deadline_at timestamptz NOT NULL DEFAULT (now()+interval '5 minutes'),
 attempt_count smallint NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 selection jsonb CHECK(selection IS NULL OR (jsonb_typeof(selection)='object' AND octet_length(selection::text)<=16384)),
 engine text CHECK(engine IN('CATALOG','OLLAMA')),
 error_code varchar(80),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'),
 UNIQUE(user_id,idempotency_key),
 UNIQUE(id,user_id),
 FOREIGN KEY(auth_session_id,user_id) REFERENCES movie.auth_sessions(id,user_id),
 FOREIGN KEY(parent_run_id,user_id) REFERENCES movie.assistant_runs(id,user_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days'),
 CHECK((status='RUNNING')=(lease_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(status<>'SUCCEEDED' OR selection IS NOT NULL)
);
CREATE INDEX assistant_runs_owner_idx ON movie.assistant_runs(user_id,created_at DESC,id);
CREATE INDEX assistant_runs_pending_idx ON movie.assistant_runs(deadline_at) WHERE status IN('QUEUED','RUNNING');
CREATE INDEX assistant_runs_expiry_idx ON movie.assistant_runs(expires_at);
CREATE TABLE movie.assistant_run_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES movie.assistant_runs(id) ON DELETE CASCADE,
 generation bigint NOT NULL CHECK(generation>0),
 call_id varchar(80) NOT NULL CHECK(call_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
 tool text NOT NULL CHECK(tool IN('search_catalog','get_title_details','get_published_episodes','search_help')),
 args_hash text NOT NULL CHECK(args_hash ~ '^[a-f0-9]{64}$'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,generation,call_id)
);
CREATE INDEX assistant_run_steps_run_idx ON movie.assistant_run_steps(run_id,generation,created_at);
REVOKE ALL ON movie.assistant_runs,movie.assistant_run_steps FROM PUBLIC,movie_worker,movie_auditor;
GRANT SELECT,INSERT,UPDATE,DELETE ON movie.assistant_runs,movie.assistant_run_steps TO movie_api;
COMMIT;
