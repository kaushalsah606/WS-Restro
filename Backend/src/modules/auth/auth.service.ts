import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppRole, Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AppConfig } from '../../config/app-config.service';
import { AccessService } from '../../common/access/access.service';
import { AuthUser, MANAGERS } from '../../common/decorators';
import { JwtPayload } from '../../common/guards/jwt-auth.guard';
import { paginated } from '../../common/interceptors/response.interceptor';
import { pageArgs } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import {
  AssignRoleDto,
  CreateUserDto,
  ListUsersDto,
  RegisterDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './dto/auth.dto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  RESTAURANT_ADMIN: 'Restaurant Admin',
  BRANCH_MANAGER: 'Branch Manager',
  CASHIER: 'Cashier',
  WAITER: 'Waiter',
  KITCHEN_STAFF: 'Kitchen Staff',
  CUSTOMER: 'Customer',
};

// Roles anyone may pick on the public sign-up form (when public registration is on)
const SELF_SERVICE_ROLES: AppRole[] = ['CASHIER', 'WAITER', 'KITCHEN_STAFF', 'CUSTOMER'];

export const publicUser = (u: User) => {
  const { passwordHash: _ph, ...rest } = u;
  return rest;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly bus: EventBus,
  ) {}

  // ───────────────────────── tokens ─────────────────────────

  private async signAccess(user: User, roles: AuthUser['roles']): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, roles };
    return this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL'),
    });
  }

  private async loadRoles(userId: string) {
    return this.prisma.userRole.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  private async issueTokens(user: User, meta?: { userAgent?: string; ip?: string }) {
    const roles = await this.loadRoles(user.id);
    const authRoles = roles.map((r) => ({ role: r.role, branchId: r.branchId, restaurantId: r.restaurantId }));
    const accessToken = await this.signAccess(user, authRoles);

    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.config.get('JWT_REFRESH_TTL_DAYS') * 86_400_000),
        userAgent: meta?.userAgent?.slice(0, 250),
        ip: meta?.ip,
      },
    });
    return { accessToken, refreshToken, roles };
  }

  // ───────────────────────── public auth ─────────────────────────

  async register(dto: RegisterDto, meta?: { userAgent?: string; ip?: string }, actor?: AuthUser) {
    const userCount = await this.prisma.user.count();
    const isBootstrap = userCount === 0;

    if (!isBootstrap && !actor && !this.config.get('ALLOW_PUBLIC_REGISTRATION')) {
      throw new ForbiddenException('Public registration is disabled. Ask an administrator to create your account.');
    }

    const requested = dto.role ?? 'WAITER';
    let role: AppRole = requested;
    if (isBootstrap) role = 'SUPER_ADMIN';
    else if (!actor && !SELF_SERVICE_ROLES.includes(requested)) {
      throw new ForbiddenException(`The ${ROLE_LABELS[requested]} role cannot be self-assigned`);
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    let branchId: string | null = null;
    if (role !== 'SUPER_ADMIN' && role !== 'RESTAURANT_ADMIN') {
      // Anonymous sign-ups land in the requested (or default) branch
      branchId = actor ? await this.access.resolveBranchId(actor, dto.branchId) : (dto.branchId ?? (await this.access.getDefaultBranchId()));
      if (actor) await this.assertCanGrant(actor, role, branchId);
    }
    const restaurantId = branchId ? (await this.access.getBranchSettings(branchId)).restaurantId : null;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, this.config.get('BCRYPT_ROUNDS')),
        fullName: dto.fullName,
        phone: dto.phone,
        roles: { create: { role, branchId, restaurantId } },
      },
    });
    this.logger.log(`Registered ${user.email} as ${role}${isBootstrap ? ' (bootstrap admin)' : ''}`);

    const tokens = await this.issueTokens(user, meta);
    return { user: publicUser(user), ...tokens };
  }

  async login(email: string, password: string, meta?: { userAgent?: string; ip?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    // constant-ish time: always run a hash compare
    const ok = await bcrypt.compare(password, user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    if (!user.isActive) throw new ForbiddenException('This account has been deactivated');

    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.issueTokens(updated, meta);
    return { user: publicUser(updated), ...tokens };
  }

  /**
   * Exchange a refresh token for a new access token and a NEW refresh token (rotation).
   * The presented token is revoked atomically, so it can be used exactly once.
   */
  async refresh(refreshToken: string, meta?: { userAgent?: string; ip?: string }) {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) throw new UnauthorizedException('Invalid refresh token');
    if (!record.user.isActive) throw new ForbiddenException('This account has been deactivated');

    const newToken = randomBytes(48).toString('base64url');
    const claimed = await this.prisma.$transaction(async (tx) => {
      const res = await tx.refreshToken.updateMany({ where: { id: record.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (res.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          userId: record.userId,
          tokenHash: sha256(newToken),
          // keep the original session lifetime: rotation must not extend it indefinitely
          expiresAt: record.expiresAt,
          userAgent: (meta?.userAgent ?? record.userAgent)?.slice(0, 250),
          ip: meta?.ip ?? record.ip,
        },
      });
      return true;
    });
    if (!claimed) throw new UnauthorizedException('Invalid refresh token');

    const roles = await this.loadRoles(record.userId);
    const accessToken = await this.signAccess(
      record.user,
      roles.map((r) => ({ role: r.role, branchId: r.branchId, restaurantId: r.restaurantId })),
    );
    return { accessToken, refreshToken: newToken };
  }

  async logout(userId: string, refreshToken?: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, ...(refreshToken ? { tokenHash: sha256(refreshToken) } : {}) },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }

  // ───────────────────────── profile ─────────────────────────

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!user) throw new NotFoundException('User not found');
    const { roles, ...rest } = user;
    return { user: publicUser(rest as User), roles };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.prisma.user.update({ where: { id: userId }, data: dto });
    return this.profile(userId);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(newPassword, this.config.get('BCRYPT_ROUNDS')) },
      }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { changed: true };
  }

  // ───────────────────────── staff management ─────────────────────────

  /** Seeded demo logins (see prisma/seed.ts). Only revealed when DEMO_MODE=true. */
  demoAccounts() {
    if (!this.config.get('DEMO_MODE')) return [];
    return [
      { role: 'SUPER_ADMIN', label: 'Super Admin', email: this.config.get('SEED_ADMIN_EMAIL') ?? 'admin@harmonyhub.com', password: this.config.get('SEED_ADMIN_PASSWORD') ?? 'Admin@12345' },
      { role: 'RESTAURANT_ADMIN', label: 'Owner', email: 'owner@harmonyhub.com', password: 'Owner@123' },
      { role: 'BRANCH_MANAGER', label: 'Manager', email: 'manager@harmonyhub.com', password: 'Manager@123' },
      { role: 'CASHIER', label: 'Cashier', email: 'cashier@harmonyhub.com', password: 'Cashier@123' },
      { role: 'WAITER', label: 'Waiter', email: 'waiter@harmonyhub.com', password: 'Waiter@123' },
      { role: 'KITCHEN_STAFF', label: 'Kitchen', email: 'kitchen@harmonyhub.com', password: 'Kitchen@123' },
    ];
  }

  roleCatalog() {
    return (Object.keys(ROLE_LABELS) as AppRole[]).map((role) => ({ role, label: ROLE_LABELS[role] }));
  }

  /** Who is allowed to grant which role. */
  private async assertCanGrant(actor: AuthUser, role: AppRole, branchId: string | null) {
    const isSuper = actor.roles.some((r) => r.role === 'SUPER_ADMIN');
    if (isSuper) return;
    const isRestAdmin = actor.roles.some((r) => r.role === 'RESTAURANT_ADMIN');
    if (role === 'SUPER_ADMIN') throw new ForbiddenException('Only a super admin can grant SUPER_ADMIN');
    if (role === 'RESTAURANT_ADMIN' && !isRestAdmin) throw new ForbiddenException('Only an admin can grant RESTAURANT_ADMIN');
    if (isRestAdmin) return;
    // branch managers: floor roles inside their own branch only
    if (['RESTAURANT_ADMIN', 'BRANCH_MANAGER'].includes(role)) throw new ForbiddenException('Insufficient privileges to grant this role');
    if (!branchId) throw new ForbiddenException('A branch is required for this role');
    await this.access.assertBranchAccess(actor, branchId);
  }

  async listUsers(actor: AuthUser, q: ListUsersDto) {
    const where: Prisma.UserWhereInput = {};
    if (q.isActive !== undefined) where.isActive = q.isActive;
    if (q.search) {
      where.OR = [
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search } },
      ];
    }
    const isGlobal = actor.roles.some((r) => ['SUPER_ADMIN', 'RESTAURANT_ADMIN'].includes(r.role));
    const branchIds = isGlobal ? (q.branchId ? [q.branchId] : null) : [await this.access.resolveBranchId(actor, q.branchId)];
    const roleFilter: Prisma.UserRoleWhereInput = {};
    if (q.role) roleFilter.role = q.role;
    if (branchIds) roleFilter.branchId = { in: branchIds };
    if (Object.keys(roleFilter).length) where.roles = { some: roleFilter };

    const { page, limit, skip, take } = pageArgs(q);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, include: { roles: true }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(
      items.map(({ passwordHash: _p, ...u }) => u),
      page,
      limit,
      total,
    );
  }

  async createUser(actor: AuthUser, dto: CreateUserDto) {
    const isGlobalRole = dto.role === 'SUPER_ADMIN' || dto.role === 'RESTAURANT_ADMIN';
    const branchId = isGlobalRole ? null : await this.access.resolveBranchId(actor, dto.branchId);
    await this.assertCanGrant(actor, dto.role, branchId);

    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw new ConflictException('A user with this email already exists');
    const restaurantId = branchId ? (await this.access.getBranchSettings(branchId)).restaurantId : null;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, this.config.get('BCRYPT_ROUNDS')),
        fullName: dto.fullName,
        phone: dto.phone,
        roles: { create: { role: dto.role, branchId, restaurantId } },
      },
      include: { roles: true },
    });
    await this.bus.publish(EVENT.USER_UPDATED, branchId, { id: user.id, action: 'created' }, actor.id);
    const { passwordHash: _p, ...rest } = user;
    return rest;
  }

  private async getManageableUser(actor: AuthUser, id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { roles: true } });
    if (!user) throw new NotFoundException('User not found');
    const isSuper = actor.roles.some((r) => r.role === 'SUPER_ADMIN');
    if (!isSuper) {
      if (user.roles.some((r) => r.role === 'SUPER_ADMIN')) throw new ForbiddenException('Cannot modify a super admin');
      const isAdmin = actor.roles.some((r) => r.role === 'RESTAURANT_ADMIN');
      if (!isAdmin) {
        // branch managers: only users with a role in a branch they can access
        const ok = await Promise.all(user.roles.filter((r) => r.branchId).map((r) => this.access.canAccessBranch(actor, r.branchId!)));
        if (!ok.some(Boolean) && user.id !== actor.id) throw new ForbiddenException('You cannot manage this user');
      }
    }
    return user;
  }

  async updateUser(actor: AuthUser, id: string, dto: UpdateUserDto) {
    await this.getManageableUser(actor, id);
    if (id === actor.id && dto.isActive === false) throw new BadRequestException('You cannot deactivate your own account');
    const { password, ...rest } = dto;
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, this.config.get('BCRYPT_ROUNDS')) } : {}) },
      include: { roles: true },
    });
    if (dto.isActive === false) {
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const { passwordHash: _p, ...out } = user;
    return out;
  }

  /** Soft delete: deactivate, drop roles and revoke sessions (matches the staff screen behaviour). */
  async deactivateUser(actor: AuthUser, id: string) {
    if (id === actor.id) throw new BadRequestException('You cannot delete your own account');
    await this.getManageableUser(actor, id);
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.user.update({ where: { id }, data: { isActive: false } }),
      this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { id, deactivated: true };
  }

  async assignRole(actor: AuthUser, userId: string, dto: AssignRoleDto) {
    await this.getManageableUser(actor, userId);
    const isGlobalRole = dto.role === 'SUPER_ADMIN' || dto.role === 'RESTAURANT_ADMIN';
    const branchId = isGlobalRole ? null : await this.access.resolveBranchId(actor, dto.branchId);
    await this.assertCanGrant(actor, dto.role, branchId);

    const dup = await this.prisma.userRole.findFirst({ where: { userId, role: dto.role, branchId } });
    if (dup) throw new ConflictException('This user already has this role');
    const restaurantId = branchId ? (await this.access.getBranchSettings(branchId)).restaurantId : null;
    return this.prisma.userRole.create({ data: { userId, role: dto.role, branchId, restaurantId } });
  }

  async removeRole(actor: AuthUser, userId: string, roleId: string) {
    await this.getManageableUser(actor, userId);
    const role = await this.prisma.userRole.findFirst({ where: { id: roleId, userId } });
    if (!role) throw new NotFoundException('Role assignment not found');
    await this.assertCanGrant(actor, role.role, role.branchId);
    await this.prisma.userRole.delete({ where: { id: roleId } });
    return { id: roleId, removed: true };
  }

  static managerRoles = MANAGERS;
}
