import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AccessService } from '../../common/access/access.service';
import { AuthUser, CurrentUser, KITCHEN, MANAGERS, Public, Roles } from '../../common/decorators';
import { MENU_ITEM_INCLUDE } from '../../common/includes';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/redis/redis.module';

const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// ───────────────────────── DTOs ─────────────────────────

class CategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsString() @MaxLength(100) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() image?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateCategoryDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class VariantDto {
  @IsString() @MaxLength(80) name: string;
  @Type(() => Number) @IsNumber() priceModifier: number;
}
class AddonDto {
  @IsString() @MaxLength(80) name: string;
  @Type(() => Number) @IsNumber() @Min(0) price: number;
}

class MenuItemDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty() @IsString() @MaxLength(150) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) price: number;
  @ApiPropertyOptional() @IsOptional() @IsString() image?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isVeg?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAvailable?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(600) preparationTime?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @ApiPropertyOptional({ type: [VariantDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantDto) variants?: VariantDto[];
  @ApiPropertyOptional({ type: [AddonDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AddonDto) addons?: AddonDto[];
}

class UpdateMenuItemDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(150) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsBoolean() isVeg?: boolean;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(600) preparationTime?: number;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantDto) variants?: VariantDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AddonDto) addons?: AddonDto[];
}

class AvailabilityDto {
  @ApiProperty() @IsBoolean() isAvailable: boolean;
}

class IngredientDto {
  @IsUUID() inventoryId: string;
  @Type(() => Number) @IsNumber() @Min(0) quantity: number;
}
class RecipeDto {
  @ApiProperty({ type: [IngredientDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => IngredientDto) ingredients: IngredientDto[];
}

export class CategoryQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @Transform(bool) @IsBoolean() includeInactive?: boolean;
}

export class MenuQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Transform(bool) @IsBoolean() isAvailable?: boolean;
  @IsOptional() @Transform(bool) @IsBoolean() isVeg?: boolean;
  @IsOptional() @IsString() search?: string;
}

// ───────────────────────── Service ─────────────────────────

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly cache: CacheService,
    private readonly bus: EventBus,
  ) {}

  private invalidate(branchId: string) {
    return this.cache.delByPrefix(`menu:${branchId}`);
  }

  // ── categories
  async categories(user: AuthUser | undefined, q: CategoryQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const includeInactive = !!q.includeInactive && !!user;
    return this.cache.wrap(`menu:${branchId}:categories:${includeInactive}`, 120, () =>
      this.prisma.category.findMany({
        where: { branchId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  async createCategory(user: AuthUser, dto: CategoryDto) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    const { branchId: _b, ...data } = dto;
    const c = await this.prisma.category.create({ data: { ...data, branchId } });
    await this.invalidate(branchId);
    return c;
  }

  async updateCategory(user: AuthUser, id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');
    await this.access.assertBranchAccess(user, existing.branchId);
    const c = await this.prisma.category.update({ where: { id }, data: dto });
    await this.invalidate(existing.branchId);
    await this.bus.publish(EVENT.MENU_UPDATED, existing.branchId, { id, category: c, type: 'category' }, user.id);
    return c;
  }

  async deleteCategory(user: AuthUser, id: string) {
    const existing = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { menuItems: true } } } });
    if (!existing) throw new NotFoundException('Category not found');
    await this.access.assertBranchAccess(user, existing.branchId);
    if (existing._count.menuItems > 0) {
      // keep history: hide instead of deleting a category that still owns items
      await this.prisma.category.update({ where: { id }, data: { isActive: false } });
      await this.invalidate(existing.branchId);
      return { id, deleted: false, deactivated: true };
    }
    await this.prisma.category.delete({ where: { id } });
    await this.invalidate(existing.branchId);
    return { id, deleted: true };
  }

  // ── items
  async items(user: AuthUser | undefined, q: MenuQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const where: Prisma.MenuItemWhereInput = { branchId };
    if (q.categoryId) where.categoryId = q.categoryId;
    // anonymous customers only ever see available items
    if (q.isAvailable !== undefined) where.isAvailable = q.isAvailable;
    else if (!user) where.isAvailable = true;
    if (q.isVeg !== undefined) where.isVeg = q.isVeg;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }];

    const key = `menu:${branchId}:items:${JSON.stringify({ ...where, branchId: undefined })}`;
    return this.cache.wrap(key, 60, () =>
      this.prisma.menuItem.findMany({ where, include: MENU_ITEM_INCLUDE, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    );
  }

  /** Whole menu grouped by category (single call for the QR ordering screen). */
  async fullMenu(user: AuthUser | undefined, branchId?: string) {
    const id = await this.access.resolveBranchId(user, branchId);
    return this.cache.wrap(`menu:${id}:full`, 60, () =>
      this.prisma.category.findMany({
        where: { branchId: id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { menuItems: { where: { isAvailable: true }, include: { variants: true, addons: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
      }),
    );
  }

  async getItem(id: string) {
    const item = await this.prisma.menuItem.findUnique({ where: { id }, include: { ...MENU_ITEM_INCLUDE, ingredients: true } });
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async createItem(user: AuthUser, dto: MenuItemDto) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    await this.assertCategory(dto.categoryId, branchId);
    const { branchId: _b, variants, addons, ...rest } = dto;
    const item = await this.prisma.menuItem.create({
      data: {
        ...rest,
        branchId,
        variants: variants?.length ? { create: variants } : undefined,
        addons: addons?.length ? { create: addons } : undefined,
      },
      include: MENU_ITEM_INCLUDE,
    });
    await this.invalidate(branchId);
    await this.bus.publish(EVENT.MENU_UPDATED, branchId, item, user.id);
    return item;
  }

  private async assertCategory(categoryId: string, branchId: string) {
    const c = await this.prisma.category.findFirst({ where: { id: categoryId, branchId } });
    if (!c) throw new BadRequestException('Category does not exist in this branch');
  }

  async updateItem(user: AuthUser, id: string, dto: UpdateMenuItemDto) {
    const existing = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Menu item not found');
    await this.access.assertBranchAccess(user, existing.branchId);
    if (dto.categoryId) await this.assertCategory(dto.categoryId, existing.branchId);

    const { variants, addons, ...rest } = dto;
    const item = await this.prisma.$transaction(async (tx) => {
      if (variants) await tx.menuVariant.deleteMany({ where: { menuItemId: id } });
      if (addons) await tx.menuAddon.deleteMany({ where: { menuItemId: id } });
      return tx.menuItem.update({
        where: { id },
        data: {
          ...rest,
          ...(variants ? { variants: { create: variants } } : {}),
          ...(addons ? { addons: { create: addons } } : {}),
        },
        include: MENU_ITEM_INCLUDE,
      });
    });
    await this.invalidate(existing.branchId);
    await this.bus.publish(EVENT.MENU_UPDATED, existing.branchId, item, user.id);
    if (dto.isAvailable !== undefined && dto.isAvailable !== existing.isAvailable) {
      await this.bus.publish(EVENT.MENU_AVAILABILITY_CHANGED, existing.branchId, { id, isAvailable: item.isAvailable, item }, user.id);
    }
    return item;
  }

  async setAvailability(user: AuthUser, id: string, isAvailable: boolean) {
    const existing = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Menu item not found');
    await this.access.assertBranchAccess(user, existing.branchId);
    const item = await this.prisma.menuItem.update({ where: { id }, data: { isAvailable }, include: MENU_ITEM_INCLUDE });
    await this.invalidate(existing.branchId);
    await this.bus.publish(EVENT.MENU_AVAILABILITY_CHANGED, existing.branchId, { id, isAvailable, item }, user.id);
    await this.bus.publish(EVENT.MENU_UPDATED, existing.branchId, item, user.id);
    return item;
  }

  async deleteItem(user: AuthUser, id: string) {
    const existing = await this.prisma.menuItem.findUnique({ where: { id }, include: { _count: { select: { orderItems: true } } } });
    if (!existing) throw new NotFoundException('Menu item not found');
    await this.access.assertBranchAccess(user, existing.branchId);
    if (existing._count.orderItems > 0) {
      const item = await this.prisma.menuItem.update({ where: { id }, data: { isAvailable: false }, include: MENU_ITEM_INCLUDE });
      await this.invalidate(existing.branchId);
      await this.bus.publish(EVENT.MENU_UPDATED, existing.branchId, item, user.id);
      return { id, deleted: false, deactivated: true };
    }
    await this.prisma.menuItem.delete({ where: { id } });
    await this.invalidate(existing.branchId);
    await this.bus.publish(EVENT.MENU_DELETED, existing.branchId, { id, branchId: existing.branchId }, user.id);
    return { id, deleted: true };
  }

  // ── recipes (ingredient -> stock auto-deduction)
  async getRecipe(id: string) {
    return this.prisma.recipeIngredient.findMany({ where: { menuItemId: id }, include: { inventory: { select: { id: true, name: true, unit: true } } } });
  }

  async setRecipe(user: AuthUser, id: string, dto: RecipeDto) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Menu item not found');
    await this.access.assertBranchAccess(user, item.branchId);
    const invIds = dto.ingredients.map((i) => i.inventoryId);
    const found = await this.prisma.inventoryItem.count({ where: { id: { in: invIds }, branchId: item.branchId } });
    if (found !== new Set(invIds).size) throw new BadRequestException('Unknown inventory item in recipe');
    await this.prisma.$transaction([
      this.prisma.recipeIngredient.deleteMany({ where: { menuItemId: id } }),
      this.prisma.recipeIngredient.createMany({ data: dto.ingredients.map((i) => ({ menuItemId: id, inventoryId: i.inventoryId, quantity: i.quantity })), skipDuplicates: true }),
    ]);
    return this.getRecipe(id);
  }
}

// ───────────────────────── Controller ─────────────────────────

@ApiTags('menu')
@ApiBearerAuth()
@Controller('menu')
export class MenuController {
  constructor(private readonly svc: MenuService) {}

  @Public()
  @Get()
  full(@CurrentUser() user: AuthUser | undefined, @Query('branchId') branchId?: string) {
    return this.svc.fullMenu(user, branchId);
  }

  @Public()
  @Get('categories')
  categories(@CurrentUser() user: AuthUser | undefined, @Query() q: CategoryQueryDto) {
    return this.svc.categories(user, q);
  }

  @Roles(...MANAGERS)
  @Post('categories')
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CategoryDto) {
    return this.svc.createCategory(user, dto);
  }

  @Roles(...MANAGERS)
  @Put('categories/:id')
  updateCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.updateCategory(user, id, dto);
  }

  @Roles(...MANAGERS)
  @Delete('categories/:id')
  deleteCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteCategory(user, id);
  }

  @Public()
  @Get('items')
  items(@CurrentUser() user: AuthUser | undefined, @Query() q: MenuQueryDto) {
    return this.svc.items(user, q);
  }

  @Public()
  @Get('items/:id')
  item(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getItem(id);
  }

  @Roles(...MANAGERS)
  @Post('items')
  createItem(@CurrentUser() user: AuthUser, @Body() dto: MenuItemDto) {
    return this.svc.createItem(user, dto);
  }

  @Roles(...MANAGERS)
  @Put('items/:id')
  updateItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMenuItemDto) {
    return this.svc.updateItem(user, id, dto);
  }

  // kitchen staff can mark dishes sold-out
  @Roles(...KITCHEN)
  @Patch('items/:id/availability')
  availability(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AvailabilityDto) {
    return this.svc.setAvailability(user, id, dto.isAvailable);
  }

  @Roles(...MANAGERS)
  @Delete('items/:id')
  deleteItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteItem(user, id);
  }

  @Roles(...MANAGERS)
  @Get('items/:id/recipe')
  recipe(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getRecipe(id);
  }

  @Roles(...MANAGERS)
  @Put('items/:id/recipe')
  setRecipe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecipeDto) {
    return this.svc.setRecipe(user, id, dto);
  }
}

@Module({ controllers: [MenuController], providers: [MenuService], exports: [MenuService] })
export class MenuModule {}
