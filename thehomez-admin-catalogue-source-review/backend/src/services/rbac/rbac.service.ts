import {
  SYSTEM_ROLE_SEEDS,
  STANDARD_PARTNER_ROLE_PERMISSIONS,
  type UserType,
  type PermissionCode,
  type IUserPrincipal,
} from '@thehomez/shared-types';
import { RoleModel, type IRoleDocument } from '../../models/role.model.js';
import type { IUserDocument } from '../../models/user.model.js';
import { logger } from '../../logger/logger.js';

export class RbacService {
  /**
   * Idempotently seeds default system role templates from SYSTEM_ROLE_SEEDS into the database.
   *
   * Crucial Rule:
   * Seed roles are initial editable templates. If a role already exists in the database,
   * its existing permissions and configurations are PRESERVED and NEVER overwritten.
   */
  public async seedDefaultRoles(): Promise<{ insertedCount: number; existingCount: number }> {
    let insertedCount = 0;
    let existingCount = 0;

    for (const [key, seed] of Object.entries(SYSTEM_ROLE_SEEDS)) {
      try {
        const result = await RoleModel.findOneAndUpdate(
          { code: seed.code },
          {
            $setOnInsert: {
              code: seed.code,
              name: seed.name,
              description: seed.description,
              userType: seed.userType,
              isSystemManaged: seed.isSystemManaged,
              permissions: seed.permissions,
            },
          },
          { upsert: true, new: false },
        );

        if (result) {
          existingCount++;
        } else {
          insertedCount++;
          logger.info(
            { roleCode: seed.code, key },
            'Default system role template initialized in database',
          );
        }
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 11000) {
          existingCount++;
        } else {
          throw err;
        }
      }
    }

    return { insertedCount, existingCount };
  }

  /**
   * Idempotently provisions the standard partner role (PARTNER_OPERATOR)
   * configured with STANDARD_PARTNER_ROLE_PERMISSIONS and scoped to UserType.PARTNER.
   *
   * Crucial Rule:
   * Uses $setOnInsert so existing partner role configurations and custom permissions
   * are preserved and never overwritten if the role already exists.
   */
  public async provisionStandardPartnerRole(): Promise<IRoleDocument> {
    const seed = SYSTEM_ROLE_SEEDS.PARTNER_OPERATOR;
    return (await RoleModel.findOneAndUpdate(
      { code: seed.code },
      {
        $setOnInsert: {
          code: seed.code,
          name: seed.name,
          description: seed.description,
          userType: seed.userType,
          isSystemManaged: seed.isSystemManaged,
          permissions: [...STANDARD_PARTNER_ROLE_PERMISSIONS],
        },
      },
      { upsert: true, new: true },
    )) as IRoleDocument;
  }

  /**
   * Resolves a role document by its unique uppercase code.
   */
  public async getRoleByCode(code: string): Promise<IRoleDocument | null> {
    if (!code || typeof code !== 'string') {
      return null;
    }
    return RoleModel.findOne({ code: code.trim().toUpperCase() });
  }

  /**
   * Aggregates the effective permissions granted by a list of role codes from the database.
   */
  public async getEffectivePermissions(roleCodes: string[]): Promise<PermissionCode[]> {
    if (!roleCodes || roleCodes.length === 0) {
      return [];
    }

    const cleanCodes = roleCodes.map((c) => c.trim().toUpperCase());
    const roles = await RoleModel.find({ code: { $in: cleanCodes } });

    const permissionSet = new Set<string>();
    for (const role of roles) {
      for (const perm of role.permissions) {
        permissionSet.add(perm);
      }
    }

    return Array.from(permissionSet) as PermissionCode[];
  }

  /**
   * Verifies that the assigned roles are compatible with the target UserType identity.
   */
  public async validateRolesForUserType(
    roleCodes: string[],
    userType: UserType,
  ): Promise<{ valid: boolean; incompatibleRoles: string[] }> {
    if (!roleCodes || roleCodes.length === 0) {
      return { valid: true, incompatibleRoles: [] };
    }

    const cleanCodes = roleCodes.map((c) => c.trim().toUpperCase());
    const roles = await RoleModel.find({ code: { $in: cleanCodes } });

    const incompatibleRoles: string[] = [];
    for (const role of roles) {
      if (role.userType !== userType) {
        incompatibleRoles.push(role.code);
      }
    }

    return {
      valid: incompatibleRoles.length === 0,
      incompatibleRoles,
    };
  }

  /**
   * Constructs the strongly typed IUserPrincipal for an authenticated user document,
   * dynamically querying current permissions from the database.
   */
  public async resolveUserPrincipal(user: IUserDocument): Promise<IUserPrincipal> {
    const permissions = await this.getEffectivePermissions(user.roles || []);

    return {
      id: user._id.toString(),
      userType: user.userType,
      email: user.email,
      phone: user.phone,
      roles: user.roles || [],
      permissions,
      partnerId: user.partnerId?.toString(),
      customerId: user.customerId?.toString(),
    };
  }
}
