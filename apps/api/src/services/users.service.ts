import { Injectable } from "@nestjs/common";
import {
  Database,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  Principal,
  assertStepUp,
  audit,
  checkMutation,
  fail,
  paginated,
  readCursor,
  requireMatch,
} from "../common";
import { UsersQueryDto, UserRolesDto, UserStatusDto } from "../dto/users.dto";
import { configuration } from "../config";
const userColumns =
  "id,email_normalized,display_name,status,email_verified_at,auth_version,created_at,updated_at";
@Injectable()
export class UsersService {
  constructor(private readonly db: Database) {}
  async list(dto: UsersQueryDto) {
    const filter = { q: dto.q ?? "", status: dto.status ?? "" },
      cursor = readCursor(dto.cursor, "users", filter);
    const rows = await query(
      this.db,
      "SELECT " +
        userColumns +
        " FROM movie.users WHERE ($1='' OR email_normalized ILIKE '%'||$1||'%' OR display_name ILIKE '%'||$1||'%') AND ($2='' OR status=$2) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5",
      [
        dto.q ?? "",
        dto.status ?? "",
        cursor?.[0] ?? null,
        cursor?.[1] ?? null,
        dto.limit + 1,
      ],
    );
    return paginated(rows, dto.limit, "users", filter);
  }
  async get(id: string): Promise<Record<string, any>> {
    const user = await one(
      this.db,
      "SELECT " + userColumns + " FROM movie.users WHERE id=$1::uuid",
      [id],
    );
    if (!user) fail("RESOURCE_NOT_FOUND");
    return { ...user, roles: await this.rolesOf(id) };
  }
  async rolesOf(id: string) {
    return (
      await query(
        this.db,
        "SELECT r.code FROM movie.user_roles ur JOIN movie.roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid ORDER BY r.code",
        [id],
      )
    ).map((row) => row.code as string);
  }
  async userRoles(id: string) {
    const user = await one(
      this.db,
      "SELECT id,auth_version FROM movie.users WHERE id=$1::uuid",
      [id],
    );
    if (!user) fail("RESOURCE_NOT_FOUND");
    return { ...user, roles: await this.rolesOf(id) };
  }
  async roles() {
    return query(
      this.db,
      "SELECT r.id,r.code,r.description,ARRAY(SELECT p.code FROM movie.role_permissions rp JOIN movie.permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id ORDER BY p.code) AS permissions FROM movie.roles r ORDER BY r.code",
    );
  }
  async permissions() {
    return this.db.permissions.findMany({
      select: { id: true, code: true, description: true },
      orderBy: { code: "asc" },
    });
  }
  async change(
    actor: Principal,
    id: string,
    body: UserRolesDto | UserStatusDto,
    match: string | undefined,
    kind: "roles" | "status",
  ) {
    return this.db.$transaction(
      async (tx) => {
        await query(
          tx,
          "SELECT key FROM movie.policy_locks WHERE key='super_admin_roster' FOR UPDATE",
        );
        await query(
          tx,
          "SELECT id FROM movie.users WHERE id IN ($1::uuid,$2::uuid) ORDER BY id FOR UPDATE",
          [actor.id, id],
        );
        await checkMutation(
          tx,
          actor,
          kind === "roles" ? "rbac.assign" : "users.suspend",
        );
        const user = await one(
          tx,
          "SELECT " + userColumns + " FROM movie.users WHERE id=$1::uuid",
          [id],
        );
        if (!user) fail("RESOURCE_NOT_FOUND");
        requireMatch(match, "user", id, user.auth_version);
        const roles = (
          await query(
            tx,
            "SELECT r.code FROM movie.user_roles ur JOIN movie.roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid ORDER BY r.code",
            [id],
          )
        ).map((r) => r.code as string);
        if (user.status === "DELETED") fail("RBAC_ROLE_NOT_ASSIGNABLE");
        const mfaRequired = configuration().mfaRequired;
        const targetStaff = roles.some((r) => r !== "MEMBER");
        if (kind === "roles" || targetStaff) assertStepUp(actor);
        if (
          kind === "status" &&
          !actor.roles.includes("SUPER_ADMIN") &&
          (roles.length !== 1 || roles[0] !== "MEMBER")
        )
          fail(
            "RBAC_ROLE_NOT_ASSIGNABLE",
            "ADMIN may change status of MEMBER accounts only.",
          );
        const nextRoles =
          kind === "roles" ? (body as UserRolesDto).roles : roles;
        const nextStatus =
          kind === "status" ? (body as UserStatusDto).status : user.status;
        const usable = await one(
          tx,
          "SELECT 1 FROM movie.mfa_factors WHERE user_id=$1::uuid AND verified_at IS NOT NULL AND disabled_at IS NULL LIMIT 1",
          [id],
        );
        if (
          mfaRequired &&
          kind === "roles" &&
          nextRoles.some((r) => r !== "MEMBER") &&
          !usable
        )
          fail("AUTH_MFA_ENROLLMENT_REQUIRED");
        if (
          roles.includes("SUPER_ADMIN") &&
          user.status === "ACTIVE" &&
          (!mfaRequired || usable) &&
          (nextStatus !== "ACTIVE" || !nextRoles.includes("SUPER_ADMIN"))
        ) {
          const remaining = await one(
            tx,
            "SELECT count(DISTINCT u.id) AS count FROM movie.users u JOIN movie.user_roles ur ON ur.user_id=u.id JOIN movie.roles r ON r.id=ur.role_id WHERE u.id<>$1::uuid AND u.status='ACTIVE' AND r.code='SUPER_ADMIN' AND (NOT $2::boolean OR EXISTS(SELECT 1 FROM movie.mfa_factors f WHERE f.user_id=u.id AND f.verified_at IS NOT NULL AND f.disabled_at IS NULL))",
            [id, mfaRequired],
          );
          if (Number(remaining!.count) === 0) fail("RBAC_LAST_SUPER_ADMIN");
        }
        if (
          nextStatus === user.status &&
          [...nextRoles].sort().join(",") === roles.join(",")
        )
          return { ...user, roles };
        if (kind === "roles") {
          await query(
            tx,
            "DELETE FROM movie.user_roles WHERE user_id=$1::uuid RETURNING user_id",
            [id],
          );
          for (const code of nextRoles) {
            const role = await one(
              tx,
              "SELECT id FROM movie.roles WHERE code=$1",
              [code],
            );
            if (!role) fail("RBAC_ROLE_NOT_ASSIGNABLE");
            await query(
              tx,
              "INSERT INTO movie.user_roles(user_id,role_id,granted_by) VALUES ($1::uuid,$2::uuid,$3::uuid) RETURNING user_id",
              [id, role.id, actor.id],
            );
          }
        }
        const updated = await one(
          tx,
          "UPDATE movie.users SET status=$2,auth_version=auth_version+1,updated_at=now() WHERE id=$1::uuid RETURNING " +
            userColumns,
          [id, nextStatus],
        );
        await query(
          tx,
          "UPDATE movie.auth_sessions SET state='REVOKED',revoked_at=now(),revoke_reason=$2 WHERE user_id=$1::uuid AND state IN ('ACTIVE','PENDING_MFA') RETURNING id",
          [id, "admin_" + kind + "_changed"],
        );
        await audit(
          tx,
          actor,
          kind === "roles" ? "rbac.roles.changed" : "users.status.changed",
          "user",
          id,
          {
            before: { status: user.status, roles },
            after: { status: nextStatus, roles: nextRoles },
          },
          body.reason,
        );
        return { ...updated, roles: [...nextRoles].sort() };
      },
      { timeout: 10000 },
    );
  }
}
