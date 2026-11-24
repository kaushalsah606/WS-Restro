import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  ConflictException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InventoryItem, InventoryTxType, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AccessService } from '../../common/access/access.service';
import { AuthUser, CurrentUser, MANAGERS, ALL_STAFF, Roles } from '../../common/decorators';
import { num, round2 } from '../../common/utils/money';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';

class CreateInventoryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) currentStock?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minStockLevel?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxStockLevel?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costPerUnit?: number;
}

class UpdateInventoryDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minStockLevel?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxStockLevel?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costPerUnit?: number;
}

class StockUpdateDto {
  @ApiProperty({ enum: InventoryTxType }) @IsEnum(InventoryTxType) type: InventoryTxType;
  @ApiProperty({ description: 'Positive magnitude. For "adjustment" a negative value reduces stock.' }) @Type(() => Number) @IsNumber() quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class InventoryQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() lowStock?: boolean;
}

class TxQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
  ) {}

  private async load(user: AuthUser, id: string) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Inventory item not found');
    await this.access.assertBranchAccess(user, item.branchId);
    return item;
  }

  async list(user: AuthUser, q: InventoryQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const where: Prisma.InventoryItemWhereInput = { branchId };
    if (q.category) where.category = q.category;
    if (q.search) where.name = { contains: q.search, mode: 'insensitive' };
    const items = await this.prisma.inventoryItem.findMany({ where, orderBy: { name: 'asc' } });
    return q.lowStock ? items.filter((i) => this.isLow(i)) : items;
  }

  isLow(i: Pick<InventoryItem, 'currentStock' | 'minStockLevel'>) {
    return num(i.currentStock) <= num(i.minStockLevel);
  }

  get(user: AuthUser, id: string) {
    return this.load(user, id);
  }

  async create(user: AuthUser, dto: CreateInventoryDto) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    const { branchId: _b, currentStock, ...rest } = dto;
    const item = await this.prisma.inventoryItem.create({
      data: {
        ...rest,
        branchId,
        currentStock: currentStock ?? 0,
        lastRestockedAt: currentStock ? new Date() : null,
        ...(currentStock ? { transactions: { create: { transactionType: 'purchase', quantity: currentStock, stockAfter: currentStock, notes: 'Opening stock', createdById: user.id } } } : {}),
      },
    });
    await this.bus.publish(EVENT.INVENTORY_UPDATED, branchId, item, user.id);
    return item;
  }

  async update(user: AuthUser, id: string, dto: UpdateInventoryDto) {
    await this.load(user, id);
    const item = await this.prisma.inventoryItem.update({ where: { id }, data: dto });
    await this.bus.publish(EVENT.INVENTORY_UPDATED, item.branchId, item, user.id);
    await this.checkLow(item, undefined);
    return item;
  }

  async remove(user: AuthUser, id: string) {
    const item = await this.load(user, id);
    await this.prisma.inventoryItem.delete({ where: { id } });
    await this.bus.publish(EVENT.INVENTORY_DELETED, item.branchId, { id, branchId: item.branchId }, user.id);
    return { id, deleted: true };
  }

  /** Signed stock delta for a transaction type. */
  private delta(type: InventoryTxType, quantity: number) {
    switch (type) {
      case 'purchase':
        return Math.abs(quantity);
      case 'usage':
      case 'wastage':
        return -Math.abs(quantity);
      case 'adjustment':
        return quantity;
    }
  }

  async updateStock(user: AuthUser, id: string, dto: StockUpdateDto) {
    const existing = await this.load(user, id);
    if (!dto.quantity) throw new BadRequestException('Quantity must be non-zero');
    const delta = this.delta(dto.type, dto.quantity);

    const item = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: { currentStock: { increment: delta }, ...(dto.type === 'purchase' ? { lastRestockedAt: new Date() } : {}) },
      });
      if (num(updated.currentStock) < 0) throw new ConflictException(`Not enough stock. Only ${num(existing.currentStock)} ${existing.unit} available.`);
      await tx.inventoryTransaction.create({
        data: { inventoryId: id, transactionType: dto.type, quantity: dto.quantity, stockAfter: updated.currentStock, notes: dto.notes, createdById: user.id },
      });
      return updated;
    });
    await this.bus.publish(EVENT.INVENTORY_UPDATED, item.branchId, item, user.id);
    await this.checkLow(item, num(existing.currentStock));
    return item;
  }

  async transactions(user: AuthUser, id: string, q: TxQueryDto) {
    await this.load(user, id);
    return this.prisma.inventoryTransaction.findMany({ where: { inventoryId: id }, orderBy: { createdAt: 'desc' }, take: q.limit ?? 20 });
  }

  /** Emit a low-stock event when stock crosses to/below the minimum (or is already below on edit). */
  async checkLow(item: InventoryItem, previousStock?: number) {
    if (!this.isLow(item)) return;
    if (previousStock !== undefined && previousStock <= num(item.minStockLevel)) return; // already low earlier
    await this.bus.publish(EVENT.INVENTORY_LOW_STOCK, item.branchId, item);
  }

  // ───────────────────────── automatic usage (called by the BullMQ worker) ─────────────────────────

  /**
   * Deduct recipe ingredients for the items on a KOT. Idempotent per (ingredient, KOT) thanks to the
   * unique index on inventory_transactions — safe under Kafka's at-least-once delivery and job retries.
   */
  async deductForKot(kotId: string): Promise<number> {
    const kot = await this.prisma.kot.findUnique({ where: { id: kotId }, include: { items: { where: { status: { not: 'cancelled' } } } } });
    if (!kot || kot.items.length === 0) return 0;

    const recipes = await this.prisma.recipeIngredient.findMany({ where: { menuItemId: { in: kot.items.map((i) => i.menuItemId) } } });
    if (recipes.length === 0) return 0;

    const need = new Map<string, number>();
    for (const item of kot.items) {
      for (const r of recipes.filter((x) => x.menuItemId === item.menuItemId)) {
        need.set(r.inventoryId, (need.get(r.inventoryId) ?? 0) + num(r.quantity) * item.quantity);
      }
    }

    let applied = 0;
    for (const [inventoryId, qty] of need) {
      try {
        const { item, before } = await this.prisma.$transaction(async (tx) => {
          const prev = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inventoryId } });
          const after = Math.max(0, round2(num(prev.currentStock) - qty));
          // unique(inventoryId, type, referenceId) makes this throw P2002 on replays
          await tx.inventoryTransaction.create({
            data: { inventoryId, transactionType: 'usage', quantity: qty, stockAfter: after, referenceId: kotId, notes: `Auto-deducted for KOT ${kot.kotNumber}` },
          });
          const updated = await tx.inventoryItem.update({ where: { id: inventoryId }, data: { currentStock: after } });
          return { item: updated, before: num(prev.currentStock) };
        });
        applied++;
        await this.bus.publish(EVENT.INVENTORY_UPDATED, item.branchId, item);
        await this.checkLow(item, before);
      } catch (e) {
        if ((e as any)?.code === 'P2002') continue; // already processed
        throw e;
      }
    }
    return applied;
  }

  /** Put stock back when an order is cancelled before cooking started. */
  async restoreForOrder(orderId: string): Promise<number> {
    const kots = await this.prisma.kot.findMany({ where: { orderId }, select: { id: true } });
    const usage = await this.prisma.inventoryTransaction.findMany({
      where: { transactionType: 'usage', referenceId: { in: kots.map((k) => k.id) } },
    });
    let restored = 0;
    for (const u of usage) {
      const refKey = `restore:${u.referenceId}`;
      try {
        await this.prisma.$transaction(async (tx) => {
          const inv = await tx.inventoryItem.update({ where: { id: u.inventoryId }, data: { currentStock: { increment: u.quantity } } });
          await tx.inventoryTransaction.create({
            data: { inventoryId: u.inventoryId, transactionType: 'adjustment', quantity: u.quantity, stockAfter: inv.currentStock, referenceId: refKey, notes: 'Order cancelled – stock restored' },
          });
        });
        restored++;
      } catch (e) {
        if ((e as any)?.code !== 'P2002') throw e;
      }
    }
    return restored;
  }

  async lowStock(branchId: string) {
    const items = await this.prisma.inventoryItem.findMany({ where: { branchId } });
    return items.filter((i) => this.isLow(i));
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Roles(...ALL_STAFF)
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: InventoryQueryDto) {
    return this.svc.list(user, q);
  }

  @Roles(...ALL_STAFF)
  @Get('low-stock')
  low(@CurrentUser() user: AuthUser, @Query() q: InventoryQueryDto) {
    return this.svc.list(user, { ...q, lowStock: true });
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInventoryDto) {
    return this.svc.create(user, dto);
  }

  @Roles(...MANAGERS)
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInventoryDto) {
    return this.svc.update(user, id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user, id);
  }

  @Roles(...MANAGERS, 'KITCHEN_STAFF')
  @Post(':id/stock')
  stock(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StockUpdateDto) {
    return this.svc.updateStock(user, id, dto);
  }

  @Roles(...ALL_STAFF)
  @Get(':id/transactions')
  transactions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: TxQueryDto) {
    return this.svc.transactions(user, id, q);
  }
}

@Module({ controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
