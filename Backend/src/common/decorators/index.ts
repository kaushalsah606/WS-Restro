import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AppRole } from '@prisma/client';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Marks a route as not requiring a JWT. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given roles (SUPER_ADMIN always passes). */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthRole {
  role: AppRole;
  branchId: string | null;
  restaurantId: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  roles: AuthRole[];
}

export const CurrentUser = createParamDecorator((field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  const user = req.user as AuthUser | undefined;
  return field ? user?.[field] : user;
});

// Role groups used across controllers
export const ADMINS: AppRole[] = ['SUPER_ADMIN', 'RESTAURANT_ADMIN'];
export const MANAGERS: AppRole[] = [...ADMINS, 'BRANCH_MANAGER'];
export const FLOOR_STAFF: AppRole[] = [...MANAGERS, 'CASHIER', 'WAITER'];
export const BILLING_STAFF: AppRole[] = [...MANAGERS, 'CASHIER'];
export const KITCHEN: AppRole[] = [...MANAGERS, 'KITCHEN_STAFF'];
export const ALL_STAFF: AppRole[] = [...FLOOR_STAFF, 'KITCHEN_STAFF'];
