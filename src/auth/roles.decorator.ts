import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Rôles réels présents dans users.role et recopiés dans le JWT (payload.permissions)
export const SUPER_ADMIN = 'super_admin';
export const STORE_OWNER = 'store_owner';
export const STAFF = 'staff';
export const CUSTOMER = 'customer';
export const SUPER_PICKUPPOINT = 'super_pickuppoint';
export const SPONSOR = 'sponsor'; // espace sponsor (compte créé sur invitation de l'admin)

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export function hasRole(user: any, ...roles: string[]): boolean {
  const permissions: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
  return roles.some((r) => permissions.includes(r));
}
