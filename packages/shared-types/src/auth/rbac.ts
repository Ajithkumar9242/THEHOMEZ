import type { PermissionCode } from './permissions.js';
import type { UserType } from './user-type.js';

export interface IPermission {
  code: PermissionCode | string;
  name: string;
  module: string;
  description?: string;
}

export interface IRole {
  code: string;
  name: string;
  description?: string;
  userType: UserType;
  isSystemManaged: boolean;
  permissions: (PermissionCode | string)[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserPrincipal {
  id: string;
  userType: UserType;
  email?: string;
  phone?: string;
  roles: string[];
  permissions: (PermissionCode | string)[];
  partnerId?: string; // Set when userType === PARTNER
  customerId?: string; // Set when userType === CUSTOMER
}
