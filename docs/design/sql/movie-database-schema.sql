-- Movie platform database design v1.0. Target: PostgreSQL 18.
-- Standalone bootstrap for a NEW movie database; not a DocPrep migration.
-- Run once as schema owner. Runtime connections MUST use a different role.
-- No media bytes, credentials in plaintext, signed URLs or HLS segments here.
BEGIN;
CREATE SCHEMA movie;
SET LOCAL search_path = movie, pg_catalog;

-- 1. Identity and authorization
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_normalized varchar(254) NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name varchar(100) NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
    email_verified_at timestamptz,
    auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (email_normalized = lower(btrim(email_normalized))),
    CHECK (length(email_normalized) > 3),
    CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL))
);
CREATE TABLE roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (code IN ('MEMBER', 'EDITOR', 'ADMIN', 'SUPER_ADMIN', 'AUDITOR')),
    description text NOT NULL
);
CREATE TABLE permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(80) NOT NULL UNIQUE,
    description text NOT NULL
);
CREATE TABLE user_roles (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    granted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles(role_id, user_id);
CREATE INDEX user_roles_grantor_idx ON user_roles(granted_by) WHERE granted_by IS NOT NULL;
CREATE TABLE role_permissions (
    role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_idx ON role_permissions(permission_id, role_id);
CREATE TABLE policy_locks (
    key varchar(100) PRIMARY KEY,
    description text NOT NULL
);
INSERT INTO policy_locks (key, description)
VALUES ('super_admin_roster', 'Lock before changing super-admin role, status or MFA');

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    state text NOT NULL CHECK (state IN ('PENDING_MFA', 'ACTIVE', 'REVOKED', 'EXPIRED')),
    auth_version bigint NOT NULL CHECK (auth_version > 0),
    mfa_verified_at timestamptz,
    step_up_at timestamptz,
    device_label varchar(200),
    ip_hash text,
    user_agent_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    idle_expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoke_reason varchar(80),
    UNIQUE (id, user_id),
    CHECK (idle_expires_at <= absolute_expires_at),
    CHECK (absolute_expires_at > created_at),
    CHECK ((state = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id, created_at DESC);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(absolute_expires_at) WHERE state IN ('ACTIVE', 'PENDING_MFA');
CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
    family_id uuid NOT NULL,
    generation bigint NOT NULL CHECK (generation > 0),
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    replaced_by_id uuid,
    UNIQUE (family_id, generation),
    UNIQUE (id, family_id, session_id),
    FOREIGN KEY (replaced_by_id, family_id, session_id)
        REFERENCES refresh_tokens(id, family_id, session_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (expires_at > created_at),
    CHECK (replaced_by_id IS NULL OR (consumed_at IS NOT NULL AND replaced_by_id <> id))
);
CREATE UNIQUE INDEX refresh_tokens_live_family_idx ON refresh_tokens(family_id) WHERE consumed_at IS NULL;
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens(session_id, created_at DESC);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens(expires_at);
CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX password_reset_expiry_idx ON password_reset_tokens(expires_at);
CREATE TABLE email_verification_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    email_normalized varchar(254) NOT NULL,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK (email_normalized = lower(btrim(email_normalized)))
);
CREATE INDEX email_verification_user_idx ON email_verification_tokens(user_id, created_at DESC);
CREATE INDEX email_verification_expiry_idx ON email_verification_tokens(expires_at);
CREATE TABLE mfa_factors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    kind text NOT NULL DEFAULT 'TOTP' CHECK (kind = 'TOTP'),
    encrypted_secret bytea NOT NULL,
    encryption_key_id varchar(100) NOT NULL,
    verified_at timestamptz,
    last_accepted_step bigint CHECK (last_accepted_step >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX mfa_factors_enabled_idx ON mfa_factors(user_id, kind) WHERE disabled_at IS NULL;
CREATE TABLE mfa_challenges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    session_id uuid,
    factor_id uuid,
    purpose text NOT NULL CHECK (purpose IN ('LOGIN', 'STEP_UP', 'ENROLLMENT')),
    challenge_hash text NOT NULL UNIQUE,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    FOREIGN KEY (factor_id, user_id) REFERENCES mfa_factors(id, user_id),
    FOREIGN KEY (session_id, user_id) REFERENCES auth_sessions(id, user_id),
    CHECK (expires_at > created_at),
    CHECK (attempt_count <= max_attempts)
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges(user_id, created_at DESC);
CREATE INDEX mfa_challenges_session_idx ON mfa_challenges(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX mfa_challenges_factor_idx ON mfa_challenges(factor_id) WHERE factor_id IS NOT NULL;
CREATE INDEX mfa_challenges_expiry_idx ON mfa_challenges(expires_at);
CREATE TABLE mfa_recovery_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factor_id uuid NOT NULL REFERENCES mfa_factors(id) ON DELETE RESTRICT,
    code_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz
);
CREATE INDEX mfa_recovery_factor_idx ON mfa_recovery_codes(factor_id);
CREATE TABLE auth_replay_receipts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
    family_id uuid,
    challenge_id uuid REFERENCES mfa_challenges(id) ON DELETE RESTRICT,
    context_key varchar(180) NOT NULL,
    request_key_hash text NOT NULL,
    proof_fingerprint text NOT NULL,
    input_refresh_token_id uuid,
    output_refresh_token_id uuid,
    encrypted_result bytea,
    encryption_key_id varchar(100),
    created_at timestamptz NOT NULL DEFAULT now(),
    credential_expires_at timestamptz NOT NULL,
    metadata_expires_at timestamptz NOT NULL,
    UNIQUE (context_key, request_key_hash),
    FOREIGN KEY (input_refresh_token_id, family_id, session_id) REFERENCES refresh_tokens(id, family_id, session_id),
    FOREIGN KEY (output_refresh_token_id, family_id, session_id) REFERENCES refresh_tokens(id, family_id, session_id),
    CHECK (family_id IS NOT NULL OR challenge_id IS NOT NULL),
    CHECK (input_refresh_token_id IS NULL OR family_id IS NOT NULL),
    CHECK (output_refresh_token_id IS NULL OR family_id IS NOT NULL),
    CHECK (credential_expires_at > created_at AND metadata_expires_at >= credential_expires_at),
    CHECK ((encrypted_result IS NULL) = (encryption_key_id IS NULL))
);
CREATE INDEX auth_receipts_session_idx ON auth_replay_receipts(session_id, created_at DESC);
CREATE INDEX auth_receipts_challenge_idx ON auth_replay_receipts(challenge_id) WHERE challenge_id IS NOT NULL;
CREATE INDEX auth_receipts_input_idx ON auth_replay_receipts(input_refresh_token_id) WHERE input_refresh_token_id IS NOT NULL;
CREATE INDEX auth_receipts_output_idx ON auth_replay_receipts(output_refresh_token_id) WHERE output_refresh_token_id IS NOT NULL;
CREATE INDEX auth_receipts_credentials_idx ON auth_replay_receipts(credential_expires_at) WHERE encrypted_result IS NOT NULL;
CREATE INDEX auth_receipts_metadata_idx ON auth_replay_receipts(metadata_expires_at);

-- 2. Catalog
CREATE TABLE titles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('MOVIE', 'SERIES')),
    slug varchar(200) NOT NULL UNIQUE,
    localized_title varchar(300) NOT NULL,
    original_title varchar(300),
    normalized_title text NOT NULL,
    synopsis text NOT NULL DEFAULT '',
    release_year smallint CHECK (release_year BETWEEN 1888 AND 2200),
    country_codes text[] NOT NULL DEFAULT '{}',
    original_language varchar(35),
    age_rating varchar(20),
    publication_status text NOT NULL DEFAULT 'DRAFT' CHECK (publication_status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')),
    poster_asset_ref text,
    backdrop_asset_ref text,
    trailer_asset_ref text,
    published_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CHECK (publication_status <> 'PUBLISHED' OR published_at IS NOT NULL),
    CHECK (length(btrim(localized_title)) > 0)
);
CREATE INDEX titles_public_new_idx ON titles(published_at DESC, id DESC) WHERE publication_status = 'PUBLISHED';
CREATE INDEX titles_public_filter_idx ON titles(kind, release_year DESC, id) WHERE publication_status = 'PUBLISHED';
CREATE INDEX titles_search_idx ON titles USING gin(to_tsvector('simple'::regconfig, normalized_title));
CREATE INDEX titles_country_idx ON titles USING gin(country_codes);
CREATE INDEX titles_created_by_idx ON titles(created_by);
CREATE INDEX titles_updated_by_idx ON titles(updated_by);
CREATE TABLE title_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title_id uuid NOT NULL REFERENCES titles(id) ON DELETE RESTRICT,
    alias varchar(300) NOT NULL,
    normalized_alias text NOT NULL,
    language varchar(35),
    UNIQUE (title_id, normalized_alias)
);
CREATE INDEX title_aliases_search_idx ON title_aliases USING gin(to_tsvector('simple'::regconfig, normalized_alias));
CREATE TABLE seasons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title_id uuid NOT NULL REFERENCES titles(id) ON DELETE RESTRICT,
    number integer NOT NULL CHECK (number >= 0),
    name varchar(200),
    is_technical boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (title_id, number),
    UNIQUE (id, title_id),
    CHECK ((is_technical AND number = 0) OR (NOT is_technical AND number >= 1))
);
CREATE UNIQUE INDEX seasons_technical_idx ON seasons(title_id) WHERE is_technical;
CREATE TABLE episodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title_id uuid NOT NULL,
    season_id uuid NOT NULL,
    number integer NOT NULL CHECK (number >= 1),
    name varchar(300) NOT NULL,
    synopsis text NOT NULL DEFAULT '',
    publication_status text NOT NULL DEFAULT 'DRAFT' CHECK (publication_status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')),
    active_asset_id uuid,
    intro_start_seconds numeric(12,3),
    intro_end_seconds numeric(12,3),
    credits_start_seconds numeric(12,3),
    published_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (season_id, number),
    UNIQUE (id, title_id),
    FOREIGN KEY (season_id, title_id) REFERENCES seasons(id, title_id) ON DELETE RESTRICT,
    CHECK (publication_status <> 'PUBLISHED' OR (published_at IS NOT NULL AND active_asset_id IS NOT NULL)),
    CHECK ((intro_start_seconds IS NULL AND intro_end_seconds IS NULL) OR
        (intro_start_seconds IS NOT NULL AND intro_end_seconds IS NOT NULL AND
         intro_start_seconds >= 0 AND intro_end_seconds > intro_start_seconds AND intro_end_seconds < 1000000000)),
    CHECK (credits_start_seconds IS NULL OR (credits_start_seconds >= 0 AND credits_start_seconds < 1000000000))
);
CREATE INDEX episodes_title_idx ON episodes(title_id, publication_status, id);
CREATE INDEX episodes_active_asset_idx ON episodes(active_asset_id) WHERE active_asset_id IS NOT NULL;
CREATE TABLE genres (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug varchar(100) NOT NULL UNIQUE,
    name varchar(100) NOT NULL
);
CREATE TABLE title_genres (
    title_id uuid NOT NULL REFERENCES titles(id) ON DELETE RESTRICT,
    genre_id uuid NOT NULL REFERENCES genres(id) ON DELETE RESTRICT,
    PRIMARY KEY (title_id, genre_id)
);
CREATE INDEX title_genres_genre_idx ON title_genres(genre_id, title_id);
CREATE TABLE people (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(200) NOT NULL,
    normalized_name text NOT NULL,
    biography text NOT NULL DEFAULT '',
    photo_asset_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_search_idx ON people USING gin(to_tsvector('simple'::regconfig, normalized_name));
CREATE TABLE credits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title_id uuid NOT NULL REFERENCES titles(id) ON DELETE RESTRICT,
    person_id uuid NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('ACTOR', 'DIRECTOR', 'WRITER', 'PRODUCER')),
    character_name varchar(200) NOT NULL DEFAULT '',
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    UNIQUE (title_id, person_id, role, character_name)
);
CREATE INDEX credits_person_idx ON credits(person_id, role, title_id);
CREATE INDEX credits_display_idx ON credits(title_id, sort_order, id);

-- 3. Durable operations. Created before media to resolve dependencies.
CREATE TABLE operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    principal_scope varchar(180) NOT NULL,
    type varchar(80) NOT NULL,
    resource_type varchar(80),
    resource_id uuid,
    status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    result_ref jsonb,
    error_code varchar(100),
    error_message varchar(500),
    error_retryable boolean,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((status IN ('SUCCEEDED', 'FAILED')) = (completed_at IS NOT NULL)),
    CHECK (status <> 'FAILED' OR error_code IS NOT NULL),
    CHECK (result_ref IS NULL OR jsonb_typeof(result_ref) = 'object')
);
CREATE INDEX operations_owner_idx ON operations(owner_user_id, created_at DESC, id DESC);
CREATE INDEX operations_status_idx ON operations(status, created_at);

-- 4. Media: metadata and stable provider references, never delivery credentials.
CREATE TABLE upload_intents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE RESTRICT,
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_public_id text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'REJECTED')),
    expected_policy jsonb NOT NULL CHECK (jsonb_typeof(expected_policy) = 'object'),
    verified_asset_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    verified_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK (status <> 'VERIFIED' OR (verified_asset_id IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX upload_intents_episode_idx ON upload_intents(episode_id, created_at DESC);
CREATE INDEX upload_intents_owner_idx ON upload_intents(owner_user_id, created_at DESC);
CREATE INDEX upload_intents_expiry_idx ON upload_intents(expires_at) WHERE status = 'PENDING';
CREATE TABLE video_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE RESTRICT,
    provider text NOT NULL DEFAULT 'CLOUDINARY' CHECK (provider = 'CLOUDINARY'),
    provider_asset_id text,
    public_id text NOT NULL,
    resource_type text NOT NULL DEFAULT 'video' CHECK (resource_type = 'video'),
    delivery_type text NOT NULL CHECK (delivery_type IN ('upload', 'authenticated', 'private')),
    provider_version text,
    internal_version integer NOT NULL CHECK (internal_version >= 1),
    processing_status text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (processing_status IN ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED')),
    lifecycle_status text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE', 'DELETING', 'DELETED')),
    backup_status text NOT NULL DEFAULT 'PENDING' CHECK (backup_status IN ('PENDING', 'RUNNING', 'VERIFIED', 'FAILED')),
    duration_seconds numeric(12,3) CHECK (duration_seconds > 0 AND duration_seconds < 1000000000),
    width integer CHECK (width > 0),
    height integer CHECK (height > 0),
    bytes bigint CHECK (bytes > 0),
    source_format varchar(20),
    current_attempt_id uuid,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (episode_id, internal_version),
    UNIQUE (provider, public_id),
    UNIQUE (provider, provider_asset_id),
    UNIQUE (id, episode_id),
    UNIQUE (id, episode_id, internal_version),
    CHECK (processing_status <> 'READY' OR (duration_seconds IS NOT NULL AND provider_version IS NOT NULL AND provider_asset_id IS NOT NULL)),
    CHECK ((lifecycle_status = 'DELETED') = (deleted_at IS NOT NULL))
);
ALTER TABLE episodes ADD CONSTRAINT episodes_active_asset_fk
    FOREIGN KEY (active_asset_id, id) REFERENCES video_assets(id, episode_id) ON DELETE RESTRICT;
ALTER TABLE upload_intents ADD CONSTRAINT upload_intents_asset_fk
    FOREIGN KEY (verified_asset_id, episode_id) REFERENCES video_assets(id, episode_id) ON DELETE RESTRICT;
CREATE INDEX upload_intents_asset_idx ON upload_intents(verified_asset_id) WHERE verified_asset_id IS NOT NULL;
CREATE INDEX video_assets_work_idx ON video_assets(processing_status, updated_at) WHERE lifecycle_status = 'ACTIVE';
CREATE INDEX video_assets_backup_idx ON video_assets(backup_status, updated_at) WHERE lifecycle_status = 'ACTIVE';
CREATE TABLE media_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES video_assets(id) ON DELETE RESTRICT,
    operation_id uuid NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
    profile_version varchar(80) NOT NULL,
    config_hash text NOT NULL,
    status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'VERIFYING_OUTPUT', 'RECONCILING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    attempt_no integer NOT NULL CHECK (attempt_no >= 1),
    provider_batch_ref text,
    callback_context_hash text NOT NULL UNIQUE,
    error_code varchar(100),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (asset_id, config_hash, attempt_no),
    UNIQUE (id, asset_id),
    CHECK ((status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX media_attempts_active_idx ON media_attempts(asset_id, config_hash)
    WHERE status IN ('QUEUED', 'RUNNING', 'WAITING_PROVIDER', 'VERIFYING_OUTPUT', 'RECONCILING');
CREATE INDEX media_attempts_operation_idx ON media_attempts(operation_id);
CREATE INDEX media_attempts_reconcile_idx ON media_attempts(status, updated_at);
ALTER TABLE video_assets ADD CONSTRAINT video_assets_current_attempt_fk
    FOREIGN KEY (current_attempt_id, id) REFERENCES media_attempts(id, asset_id) ON DELETE RESTRICT;
CREATE INDEX video_assets_attempt_idx ON video_assets(current_attempt_id) WHERE current_attempt_id IS NOT NULL;
CREATE TABLE media_outputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid NOT NULL REFERENCES media_attempts(id) ON DELETE RESTRICT,
    format text NOT NULL CHECK (format IN ('HLS', 'DASH', 'MP4')),
    profile_version varchar(80) NOT NULL,
    config_hash text NOT NULL,
    status text NOT NULL CHECK (status IN ('PENDING', 'READY', 'FAILED')),
    manifest_ref text,
    rendition_summary jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rendition_summary) = 'array'),
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, format, config_hash),
    CHECK (status <> 'READY' OR (manifest_ref IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE TABLE source_backups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES video_assets(id) ON DELETE RESTRICT,
    storage_provider varchar(50) NOT NULL,
    bucket text NOT NULL,
    object_key text NOT NULL,
    object_version text,
    source_manifest_ref text,
    sha256 varchar(64) CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    bytes bigint CHECK (bytes > 0),
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'VERIFIED', 'FAILED')),
    verified_at timestamptz,
    retain_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (asset_id, storage_provider),
    UNIQUE (storage_provider, bucket, object_key),
    CHECK (status <> 'VERIFIED' OR (sha256 IS NOT NULL AND bytes IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX source_backups_status_idx ON source_backups(status, updated_at);
CREATE TABLE subtitle_tracks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES video_assets(id) ON DELETE RESTRICT,
    language varchar(35) NOT NULL,
    label varchar(100) NOT NULL,
    kind text NOT NULL DEFAULT 'SUBTITLES' CHECK (kind IN ('SUBTITLES', 'CAPTIONS', 'FORCED')),
    format text NOT NULL DEFAULT 'WEBVTT' CHECK (format = 'WEBVTT'),
    storage_ref text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY', 'FAILED')),
    offset_seconds numeric(9,3) NOT NULL DEFAULT 0 CHECK (offset_seconds BETWEEN -86400 AND 86400),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (asset_id, language, kind)
);

-- 5. Playback and personal library
CREATE TABLE playback_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    guest_id_hash text,
    episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE RESTRICT,
    asset_id uuid NOT NULL,
    asset_version integer NOT NULL CHECK (asset_version >= 1),
    mode text NOT NULL DEFAULT 'PUBLIC' CHECK (mode IN ('PUBLIC', 'PREVIEW')),
    management_token_hash text NOT NULL UNIQUE,
    telemetry_token_hash text NOT NULL UNIQUE,
    delivery_generation bigint NOT NULL DEFAULT 1 CHECK (delivery_generation > 0),
    resume_generation bigint CHECK (resume_generation > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    max_expires_at timestamptz NOT NULL,
    closed_at timestamptz,
    revoked_at timestamptz,
    UNIQUE (id, user_id, episode_id),
    UNIQUE (id, user_id, episode_id, resume_generation),
    UNIQUE (id, user_id, episode_id, asset_id, asset_version, resume_generation),
    FOREIGN KEY (asset_id, episode_id, asset_version) REFERENCES video_assets(id, episode_id, internal_version),
    CHECK ((user_id IS NOT NULL) <> (guest_id_hash IS NOT NULL)),
    CHECK (expires_at > created_at AND max_expires_at >= expires_at),
    CHECK ((user_id IS NOT NULL AND mode = 'PUBLIC') = (resume_generation IS NOT NULL)),
    CHECK (mode <> 'PREVIEW' OR user_id IS NOT NULL),
    CHECK (management_token_hash <> telemetry_token_hash)
);
CREATE INDEX playback_sessions_user_idx ON playback_sessions(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX playback_sessions_episode_idx ON playback_sessions(episode_id, created_at DESC);
CREATE INDEX playback_sessions_asset_idx ON playback_sessions(asset_id, expires_at);
CREATE INDEX playback_sessions_expiry_idx ON playback_sessions(expires_at);
CREATE TABLE resume_heads (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE RESTRICT,
    generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
    active_session_id uuid,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, episode_id),
    FOREIGN KEY (active_session_id, user_id, episode_id, generation)
        REFERENCES playback_sessions(id, user_id, episode_id, resume_generation),
    CHECK ((generation = 0) = (active_session_id IS NULL))
);
CREATE INDEX resume_heads_episode_idx ON resume_heads(episode_id);
CREATE INDEX resume_heads_session_idx ON resume_heads(active_session_id) WHERE active_session_id IS NOT NULL;
CREATE TABLE watch_progress (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE RESTRICT,
    session_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    asset_version integer NOT NULL,
    resume_generation bigint NOT NULL CHECK (resume_generation > 0),
    last_sequence bigint NOT NULL CHECK (last_sequence >= 0),
    position_seconds numeric(12,3) NOT NULL CHECK (position_seconds >= 0 AND position_seconds < 1000000000),
    watched_intervals jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(watched_intervals) = 'array'),
    watched_seconds numeric(12,3) NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0 AND watched_seconds < 1000000000),
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, episode_id),
    FOREIGN KEY (session_id, user_id, episode_id, asset_id, asset_version, resume_generation)
        REFERENCES playback_sessions(id, user_id, episode_id, asset_id, asset_version, resume_generation)
);
CREATE INDEX watch_progress_recent_idx ON watch_progress(user_id, updated_at DESC, episode_id);
CREATE INDEX watch_progress_episode_idx ON watch_progress(episode_id);
CREATE INDEX watch_progress_session_idx ON watch_progress(session_id);
CREATE INDEX watch_progress_asset_idx ON watch_progress(asset_id);
CREATE TABLE playback_event_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES playback_sessions(id) ON DELETE RESTRICT,
    client_batch_id uuid NOT NULL,
    payload_fingerprint text NOT NULL,
    event_count smallint NOT NULL CHECK (event_count BETWEEN 1 AND 50),
    payload_bytes integer NOT NULL CHECK (payload_bytes BETWEEN 1 AND 65536),
    status text NOT NULL DEFAULT 'ACCEPTED' CHECK (status IN ('ACCEPTED', 'PROCESSED', 'FAILED')),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    UNIQUE (session_id, client_batch_id),
    CHECK ((status = 'PROCESSED') = (processed_at IS NOT NULL))
);
CREATE INDEX playback_batches_pending_idx ON playback_event_batches(received_at) WHERE status = 'ACCEPTED';
CREATE TABLE watch_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES playback_sessions(id) ON DELETE RESTRICT,
    client_event_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence >= 0),
    type varchar(50) NOT NULL,
    elapsed_ms bigint NOT NULL CHECK (elapsed_ms >= 0 AND elapsed_ms <= 604800000),
    position_seconds numeric(12,3) CHECK (position_seconds >= 0 AND position_seconds < 1000000000),
    schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
    payload_fingerprint text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, client_event_id)
);
CREATE INDEX watch_events_session_time_idx ON watch_events(session_id, elapsed_ms, id);
CREATE INDEX watch_events_retention_idx ON watch_events(received_at);
CREATE TABLE watchlist (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title_id uuid NOT NULL REFERENCES titles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, title_id)
);
CREATE INDEX watchlist_recent_idx ON watchlist(user_id, created_at DESC, title_id);
CREATE INDEX watchlist_title_idx ON watchlist(title_id);
CREATE TABLE content_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    playback_session_id uuid REFERENCES playback_sessions(id) ON DELETE RESTRICT,
    title_id uuid NOT NULL REFERENCES titles(id) ON DELETE RESTRICT,
    episode_id uuid,
    category text NOT NULL CHECK (category IN ('PLAYBACK', 'SUBTITLE', 'METADATA', 'OTHER')),
    message varchar(2000) NOT NULL,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
    handled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    resolution_note varchar(2000),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (episode_id, title_id) REFERENCES episodes(id, title_id),
    CHECK (reporter_user_id IS NOT NULL OR playback_session_id IS NOT NULL)
);
CREATE INDEX content_reports_triage_idx ON content_reports(status, created_at, id);
CREATE INDEX content_reports_title_idx ON content_reports(title_id, created_at DESC);
CREATE INDEX content_reports_episode_idx ON content_reports(episode_id) WHERE episode_id IS NOT NULL;
CREATE INDEX content_reports_reporter_idx ON content_reports(reporter_user_id) WHERE reporter_user_id IS NOT NULL;
CREATE INDEX content_reports_session_idx ON content_reports(playback_session_id) WHERE playback_session_id IS NOT NULL;
CREATE INDEX content_reports_handler_idx ON content_reports(handled_by) WHERE handled_by IS NOT NULL;

-- 6. Reliability, audit and security
CREATE TABLE idempotency_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_scope varchar(180) NOT NULL,
    method varchar(10) NOT NULL,
    route_key varchar(500) NOT NULL,
    request_key_hash text NOT NULL,
    request_fingerprint text NOT NULL,
    state text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
    resource_type varchar(80),
    resource_id uuid,
    operation_id uuid REFERENCES operations(id) ON DELETE RESTRICT,
    auth_receipt_id uuid REFERENCES auth_replay_receipts(id) ON DELETE RESTRICT,
    response_status smallint CHECK (response_status BETWEEN 200 AND 599),
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    UNIQUE (actor_scope, method, route_key, request_key_hash),
    CHECK (expires_at > created_at),
    CHECK (state <> 'COMPLETED' OR response_status IS NOT NULL),
    CHECK (auth_receipt_id IS NULL OR response_body IS NULL)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_records(expires_at);
CREATE INDEX idempotency_operation_idx ON idempotency_records(operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX idempotency_receipt_idx ON idempotency_records(auth_receipt_id) WHERE auth_receipt_id IS NOT NULL;
CREATE TABLE outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type varchar(100) NOT NULL,
    schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    aggregate_type varchar(80) NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    operation_id uuid REFERENCES operations(id) ON DELETE RESTRICT,
    initiating_actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    correlation_id varchar(100),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_owner varchar(150),
    lease_until timestamptz,
    lease_token bigint NOT NULL DEFAULT 0 CHECK (lease_token >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);
CREATE INDEX outbox_dispatch_idx ON outbox_events(next_attempt_at, created_at, id) WHERE published_at IS NULL;
CREATE INDEX outbox_retention_idx ON outbox_events(published_at) WHERE published_at IS NOT NULL;
CREATE INDEX outbox_operation_idx ON outbox_events(operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX outbox_actor_idx ON outbox_events(initiating_actor_id) WHERE initiating_actor_id IS NOT NULL;
CREATE TABLE inbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source varchar(80) NOT NULL,
    dedup_key text NOT NULL,
    payload_fingerprint text NOT NULL,
    verified_payload jsonb NOT NULL CHECK (jsonb_typeof(verified_payload) = 'object'),
    status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED', 'REJECTED')),
    attempt_id uuid REFERENCES media_attempts(id) ON DELETE RESTRICT,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    error_code varchar(100),
    UNIQUE (source, dedup_key),
    CHECK (status <> 'PROCESSED' OR processed_at IS NOT NULL)
);
CREATE INDEX inbox_pending_idx ON inbox_events(received_at, id) WHERE status = 'RECEIVED';
CREATE INDEX inbox_attempt_idx ON inbox_events(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX inbox_retention_idx ON inbox_events(received_at);
CREATE TABLE job_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    handler varchar(100) NOT NULL,
    logical_key varchar(300) NOT NULL,
    operation_id uuid REFERENCES operations(id) ON DELETE RESTRICT,
    state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_owner varchar(150),
    lease_until timestamptz,
    lease_token bigint NOT NULL DEFAULT 0 CHECK (lease_token >= 0),
    last_error_code varchar(100),
    checkpoint jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(checkpoint) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (handler, logical_key),
    CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
    CHECK ((state IN ('SUCCEEDED', 'FAILED')) = (completed_at IS NOT NULL))
);
CREATE INDEX job_runs_due_idx ON job_runs(next_attempt_at, lease_until, id) WHERE state IN ('PENDING', 'RUNNING', 'WAITING');
CREATE INDEX job_runs_operation_idx ON job_runs(operation_id) WHERE operation_id IS NOT NULL;
CREATE TABLE scheduled_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    logical_key varchar(300) NOT NULL UNIQUE,
    kind varchar(100) NOT NULL,
    due_at timestamptz NOT NULL,
    payload_ref jsonb NOT NULL CHECK (jsonb_typeof(payload_ref) = 'object'),
    state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'DISPATCHED', 'CANCELLED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    dispatched_at timestamptz,
    CHECK ((state = 'DISPATCHED') = (dispatched_at IS NOT NULL))
);
CREATE INDEX scheduled_jobs_due_idx ON scheduled_jobs(due_at, id) WHERE state = 'PENDING';
CREATE TABLE audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    initiator_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    actor_kind text NOT NULL CHECK (actor_kind IN ('USER', 'SYSTEM')),
    actor_role_codes_snapshot text[] NOT NULL DEFAULT '{}',
    operation_id uuid REFERENCES operations(id) ON DELETE RESTRICT,
    action varchar(100) NOT NULL,
    resource_type varchar(80) NOT NULL,
    resource_id text NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILED', 'DENIED')),
    safe_diff jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(safe_diff) = 'object'),
    reason varchar(500),
    error_code varchar(100),
    request_id varchar(100),
    trace_id varchar(100),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CHECK (actor_kind <> 'USER' OR actor_user_id IS NOT NULL)
);
CREATE INDEX audit_logs_time_idx ON audit_logs(occurred_at DESC, id DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_initiator_idx ON audit_logs(initiator_user_id, occurred_at DESC) WHERE initiator_user_id IS NOT NULL;
CREATE INDEX audit_logs_resource_idx ON audit_logs(resource_type, resource_id, occurred_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs(action, occurred_at DESC);
CREATE INDEX audit_logs_operation_idx ON audit_logs(operation_id) WHERE operation_id IS NOT NULL;
CREATE TABLE security_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category varchar(100) NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILED', 'DENIED')),
    user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    subject_hash text,
    ip_hash text,
    safe_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(safe_metadata) = 'object'),
    request_id varchar(100),
    trace_id varchar(100),
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_time_idx ON security_events(received_at DESC, id DESC);
CREATE INDEX security_events_user_idx ON security_events(user_id, received_at DESC);
CREATE INDEX security_events_category_idx ON security_events(category, received_at DESC);
CREATE TABLE audit_exports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    operation_id uuid NOT NULL UNIQUE REFERENCES operations(id) ON DELETE RESTRICT,
    scope_filter jsonb NOT NULL CHECK (jsonb_typeof(scope_filter) = 'object'),
    status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED')),
    private_object_ref text,
    checksum_sha256 varchar(64) CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz,
    expires_at timestamptz,
    CHECK (status <> 'READY' OR (private_object_ref IS NOT NULL AND ready_at IS NOT NULL AND expires_at > ready_at))
);
CREATE INDEX audit_exports_requester_idx ON audit_exports(requester_user_id, created_at DESC);
CREATE INDEX audit_exports_expiry_idx ON audit_exports(expires_at) WHERE status = 'READY';

-- 7. Homepage, settings and compact aggregate statistics
CREATE TABLE homepage_banners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title_id uuid NOT NULL REFERENCES titles(id) ON DELETE RESTRICT,
    image_asset_ref text NOT NULL,
    headline varchar(300),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    enabled boolean NOT NULL DEFAULT false,
    starts_at timestamptz,
    ends_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX homepage_banners_display_idx ON homepage_banners(sort_order, id) WHERE enabled;
CREATE INDEX homepage_banners_title_idx ON homepage_banners(title_id);
CREATE INDEX homepage_banners_editor_idx ON homepage_banners(updated_by);
CREATE TABLE system_settings (
    key varchar(100) PRIMARY KEY,
    value jsonb NOT NULL,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(value) = 'object')
);
CREATE INDEX system_settings_editor_idx ON system_settings(updated_by);
CREATE TABLE title_daily_stats (
    title_id uuid NOT NULL REFERENCES titles(id) ON DELETE RESTRICT,
    day date NOT NULL,
    definition_version smallint NOT NULL DEFAULT 1 CHECK (definition_version > 0),
    qualified_views bigint NOT NULL DEFAULT 0 CHECK (qualified_views >= 0),
    playback_starts bigint NOT NULL DEFAULT 0 CHECK (playback_starts >= 0),
    playback_failures bigint NOT NULL DEFAULT 0 CHECK (playback_failures >= 0),
    watched_seconds numeric(20,3) NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0 AND watched_seconds < 100000000000000000),
    finalized boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (title_id, day, definition_version)
);
CREATE INDEX title_daily_stats_day_idx ON title_daily_stats(day DESC, qualified_views DESC, title_id);

-- Application services update updated_at and version explicitly in the same write.
-- Cross-table state transitions and fencing are described in the design document.
-- Do not grant runtime roles ownership, schema CREATE, TRUNCATE or audit mutation.
REVOKE ALL ON SCHEMA movie FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA movie FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA movie FROM PUBLIC;
COMMIT;
