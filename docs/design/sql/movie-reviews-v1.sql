BEGIN;
CREATE TABLE movie.review_sources (
 title_id uuid PRIMARY KEY REFERENCES movie.titles(id) ON DELETE CASCADE,
 provider text NOT NULL DEFAULT 'TMDB' CHECK(provider='TMDB'),
 external_kind text NOT NULL CHECK(external_kind IN('movie','tv')),
 external_id bigint NOT NULL CHECK(external_id BETWEEN 1 AND 2147483647),
 source_url text NOT NULL CHECK(source_url ~ '^https://www[.]themoviedb[.]org/(movie|tv)/[1-9][0-9]*$'),
 title_version bigint NOT NULL CHECK(title_version>0),
 generation uuid NOT NULL DEFAULT gen_random_uuid(),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 verified_by uuid NOT NULL REFERENCES movie.users(id),
 verified_at timestamptz NOT NULL DEFAULT now(),
 refreshed_at timestamptz,
 expires_at timestamptz,
 last_attempt_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 last_error text CHECK(last_error IS NULL OR last_error ~ '^REVIEW_[A-Z_]+$'),
 UNIQUE(title_id,provider),
 CHECK((lease_id IS NULL)=(lease_until IS NULL)),
 CHECK((refreshed_at IS NULL)=(expires_at IS NULL)),
 CHECK(expires_at IS NULL OR expires_at>refreshed_at)
);
CREATE TABLE movie.external_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title_id uuid NOT NULL REFERENCES movie.review_sources(title_id) ON DELETE CASCADE,
 external_id text NOT NULL CHECK(external_id ~ '^[a-f0-9]{24}$'),
 author varchar(200) NOT NULL CHECK(length(author)>0),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 12000),
 rating numeric(3,1) CHECK(rating BETWEEN 0 AND 10),
 language varchar(10) NOT NULL CHECK(language IN('vi-VN','en-US')),
 source_url text NOT NULL CHECK(source_url ~ '^https://www[.]themoviedb[.]org/review/[a-f0-9]{24}$'),
 source_created_at timestamptz,
 source_updated_at timestamptz,
 fetched_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(title_id,external_id)
);
CREATE INDEX external_reviews_title_idx ON movie.external_reviews(title_id,fetched_at DESC,id DESC);
REVOKE ALL ON movie.review_sources,movie.external_reviews FROM PUBLIC,movie_worker,movie_auditor;
GRANT SELECT,INSERT,UPDATE,DELETE ON movie.review_sources,movie.external_reviews TO movie_api;
COMMIT;
