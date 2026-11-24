BEGIN;
ALTER TABLE movie.viewer_reviews
 ADD COLUMN moderation_status text NOT NULL DEFAULT 'VISIBLE' CHECK(moderation_status IN('VISIBLE','HIDDEN')),
 ADD COLUMN moderation_reason text CHECK(moderation_reason IS NULL OR length(btrim(moderation_reason)) BETWEEN 3 AND 500),
 ADD COLUMN moderated_at timestamptz,
 ADD COLUMN moderated_by uuid REFERENCES movie.users(id) ON DELETE SET NULL,
 ADD CONSTRAINT viewer_reviews_moderation_metadata CHECK((moderation_reason IS NULL)=(moderated_at IS NULL) AND (moderation_status<>'HIDDEN' OR moderated_at IS NOT NULL));
CREATE INDEX viewer_reviews_moderation_created_idx ON movie.viewer_reviews(moderation_status,created_at DESC,id DESC);
CREATE INDEX viewer_reviews_admin_created_idx ON movie.viewer_reviews(created_at DESC,id DESC);
INSERT INTO movie.permissions(code,description) VALUES('reviews.moderate','Read, hide and restore viewer reviews with an audited reason');
INSERT INTO movie.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM movie.roles r CROSS JOIN movie.permissions p WHERE r.code IN('ADMIN','SUPER_ADMIN') AND p.code='reviews.moderate';
COMMIT;
