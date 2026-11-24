BEGIN;
CREATE TABLE movie.viewer_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title_id uuid NOT NULL REFERENCES movie.titles(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES movie.users(id) ON DELETE CASCADE,
 rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 10),
 content text NOT NULL DEFAULT '' CHECK(length(content)<=2000),
 contains_spoilers boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,title_id)
);
CREATE INDEX viewer_reviews_title_created_idx ON movie.viewer_reviews(title_id,created_at DESC,id DESC);
REVOKE ALL ON movie.viewer_reviews FROM PUBLIC,movie_worker,movie_auditor;
GRANT SELECT,INSERT,UPDATE,DELETE ON movie.viewer_reviews TO movie_api;
COMMIT;
