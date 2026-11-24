import { ForbiddenException, Global, Injectable, Module, NotFoundException, BadRequestException } from '@nestjs/common';
import { AppRole } from '@prisma/client';
import { AuthUser } from '../decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/redis/redis.module';
import { num } from '../utils/money';

export interface BranchSettings {
  branchId: string;
  branchName: string;
  restaurantId: string;
  restaurantName: string;
  logo: string | null;
  currency: string;
  taxRate: number; // percent
  serviceChargeRate: number; // percent
  address: string | null;
  phone: string | null;
}

const GLOBAL_ROLES: AppRole[] = ['SUPER_ADMIN'];
const RESTAURANT_ROLES: AppRole[] = ['SUPER_ADMIN', 'RESTAURANT_ADMIN'];

/** Multi-branch authorization + shared per-branch settings (cached in Redis). */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getBranchSettings(branchId: string): Promise<BranchSettings> {
    const s = await this.cache.wrap<BranchSettings | null>(`branch:settings:${branchId}`, 300, async () => {
      const b = await this.prisma.branch.findUnique({ where: { id: branchId }, include: { restaurant: true } });
      if (!b) return null;
      return {
        branchId: b.id,
        branchName: b.name,
        restaurantId: b.restaurantId,
        restaurantName: b.restaurant.name,
        logo: b.restaurant.logo,
        currency: b.restaurant.currency,
        taxRate: num(b.restaurant.taxRate),
        serviceChargeRate: num(b.restaurant.serviceCharge),
        address: b.address ?? b.restaurant.address,
        phone: b.phone ?? b.restaurant.phone,
      };
    });
    if (!s) throw new NotFoundException('Branch not found');
    return s;
  }

  async invalidateBranchSettings(restaurantId?: string) {
    if (restaurantId) {
      const branches = await this.prisma.branch.findMany({ where: { restaurantId }, select: { id: true } });
      await this.cache.del(...branches.map((b) => `branch:settings:${b.id}`));
    } else {
      await this.cache.delByPrefix('branch:settings:');
    }
    await this.cache.del('branch:default');
  }

  async getDefaultBranchId(): Promise<string> {
    const id = await this.cache.wrap<string | null>('branch:default', 300, async () => {
      const b = await this.prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      return b?.id ?? null;
    });
    if (!id) throw new NotFoundException('No branch configured');
    return id;
  }

  hasAnyRole(user: AuthUser | undefined, roles: AppRole[]): boolean {
    return !!user?.roles.some((r) => roles.includes(r.role));
  }

  /** Can the user act on this branch? */
  async canAccessBranch(user: AuthUser, branchId: string): Promise<boolean> {
    if (user.roles.some((r) => GLOBAL_ROLES.includes(r.role))) return true;
    const settings = await this.getBranchSettings(branchId);
    return user.roles.some((r) => {
      if (RESTAURANT_ROLES.includes(r.role)) return !r.restaurantId || r.restaurantId === settings.restaurantId;
      return r.branchId === branchId || (r.branchId === null && (!r.restaurantId || r.restaurantId === settings.restaurantId));
    });
  }

  async assertBranchAccess(user: AuthUser, branchId: string): Promise<void> {
    if (!(await this.canAccessBranch(user, branchId))) throw new ForbiddenException('You do not have access to this branch');
  }

  /**
   * Resolve which branch a request operates on.
   * - explicit `requested` is validated against the user's roles
   * - otherwise the user's own branch, otherwise the system default branch
   * - anonymous callers (customer QR flow) must pass a branch id
   */
  async resolveBranchId(user: AuthUser | undefined, requested?: string | null): Promise<string> {
    if (requested) {
      if (user) await this.assertBranchAccess(user, requested);
      else await this.getBranchSettings(requested);
      return requested;
    }
    if (!user) throw new BadRequestException('branchId is required');
    const own = user.roles.find((r) => r.branchId)?.branchId;
    return own ?? (await this.getDefaultBranchId());
  }
}

@Global()
@Module({ providers: [AccessService], exports: [AccessService] })
export class AccessModule {}
