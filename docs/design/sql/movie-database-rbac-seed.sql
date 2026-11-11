-- v1.0. Run once after movie-database-schema.sql, as migration owner.
-- MEMBER self-service is enforced through ownership, not admin permissions.
BEGIN;
SET LOCAL search_path = movie, pg_catalog;
INSERT INTO roles (code, description) VALUES
('MEMBER', 'Personal library and own account'),
('EDITOR', 'Edit catalog and upload media'),
('ADMIN', 'Publish and operate content; suspend MEMBER targets'),
('SUPER_ADMIN', 'Manage roles and system settings with step-up'),
('AUDITOR', 'Read filtered reports and audit; export with step-up');

INSERT INTO permissions (code, description) VALUES
('catalog.read_drafts', 'Read unpublished catalog'),
('media.preview', 'Preview unpublished media'),
('catalog.write', 'Edit catalog metadata'),
('catalog.publish', 'Publish, unpublish and change active media'),
('media.upload', 'Create signed upload intents'),
('media.retry', 'Retry media processing'),
('media.delete', 'Delete media with step-up and lifecycle checks'),
('reports.read', 'Read reports through a role-filtered DTO'),
('users.read', 'Read users through a role-filtered DTO'),
('users.suspend', 'Suspend users subject to target-role policy'),
('rbac.read', 'Read role and permission assignments'),
('rbac.assign', 'Change assignments with step-up and roster lock'),
('mfa.reset_others', 'Reset staff MFA with step-up and recovery policy'),
('audit.read', 'Read audit logs'),
('audit.export', 'Export audit with step-up and scoped download'),
('metrics.read', 'Read operational metrics'),
('docs.read', 'Access protected OpenAPI documentation'),
('settings.write', 'Update allowlisted non-secret settings with step-up');

WITH matrix (permission_code, role_codes) AS (VALUES
('catalog.read_drafts', ARRAY['EDITOR', 'ADMIN', 'SUPER_ADMIN']),
('media.preview', ARRAY['EDITOR', 'ADMIN', 'SUPER_ADMIN']),
('catalog.write', ARRAY['EDITOR', 'ADMIN', 'SUPER_ADMIN']),
('catalog.publish', ARRAY['ADMIN', 'SUPER_ADMIN']),
('media.upload', ARRAY['EDITOR', 'ADMIN', 'SUPER_ADMIN']),
('media.retry', ARRAY['ADMIN', 'SUPER_ADMIN']),
('media.delete', ARRAY['ADMIN', 'SUPER_ADMIN']),
('reports.read', ARRAY['EDITOR', 'ADMIN', 'SUPER_ADMIN', 'AUDITOR']),
('users.read', ARRAY['ADMIN', 'SUPER_ADMIN']),
('users.suspend', ARRAY['ADMIN', 'SUPER_ADMIN']),
('rbac.read', ARRAY['ADMIN', 'SUPER_ADMIN', 'AUDITOR']),
('rbac.assign', ARRAY['SUPER_ADMIN']),
('mfa.reset_others', ARRAY['SUPER_ADMIN']),
('audit.read', ARRAY['ADMIN', 'SUPER_ADMIN', 'AUDITOR']),
('audit.export', ARRAY['SUPER_ADMIN', 'AUDITOR']),
('metrics.read', ARRAY['ADMIN', 'SUPER_ADMIN', 'AUDITOR']),
('docs.read', ARRAY['EDITOR', 'ADMIN', 'SUPER_ADMIN', 'AUDITOR']),
('settings.write', ARRAY['SUPER_ADMIN'])
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM matrix m
JOIN permissions p ON p.code = m.permission_code
JOIN roles r ON r.code = ANY(m.role_codes);
-- No default account or hard-coded password. Bootstrap staff outside public API.
COMMIT;
