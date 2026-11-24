import {
  BadRequestException,
  Body,
  ConflictException,
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, RestaurantTable, TableStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
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
import { AuthUser, CurrentUser, FLOOR_STAFF, MANAGERS, Public, Roles } from '../../common/decorators';
import { AppConfig } from '../../config/app-config.service';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';

// ───────────────────────── DTOs ─────────────────────────

export class CreateTableDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @Transform(({ obj }) => String(obj.tableNumber ?? obj.number ?? '')) @IsString() @MaxLength(20) tableNumber: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) floor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) area?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() positionX?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() positionY?: number;
}

export class UpdateTableDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ obj }) => (obj.tableNumber ?? obj.number) !== undefined ? String(obj.tableNumber ?? obj.number) : undefined) @IsString() @MaxLength(20) tableNumber?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) floor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) area?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() positionX?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() positionY?: number;
}

export class TableStatusDto {
  @ApiProperty({ enum: TableStatus }) @IsEnum(TableStatus) status: TableStatus;
}

export class MergeTablesDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) tableIds: string[];
}

export class ShiftTableDto {
  @ApiProperty() @IsUUID() toTableId: string;
}

export class TableQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: TableStatus }) @IsOptional() @IsEnum(TableStatus) status?: TableStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() floor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() area?: string;
}

class LayoutEntry {
  @IsUUID() id: string;
  @IsOptional() @Type(() => Number) @IsNumber() positionX?: number;
  @IsOptional() @Type(() => Number) @IsNumber() positionY?: number;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @IsString() area?: string;
}

export class LayoutDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty({ type: [LayoutEntry] }) @IsArray() @ValidateNested({ each: true }) @Type(() => LayoutEntry) tables: LayoutEntry[];
}

// ───────────────────────── Service ─────────────────────────

const ACTIVE_ORDER_STATUSES = ['pending', 'preparing', 'ready'] as const;

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
    private readonly config: AppConfig,
  ) {}

  orderUrl(branchId: string, tableId: string) {
    return `${this.config.get('FRONTEND_URL')}/order?branch=${branchId}&table=${tableId}`;
  }

  /** Table snapshot shaped for the UI (adds mergedWith + a slim currentOrder). */
  async present(t: RestaurantTable & { mergedTables?: { id: string }[] }) {
    const order = t.currentOrderId
      ? await this.prisma.order.findUnique({
          where: { id: t.currentOrderId },
          select: { id: true, orderNumber: true, status: true, total: true, createdAt: true, _count: { select: { items: true } } },
        })
      : null;
    const merged = t.mergedTables ?? (await this.prisma.restaurantTable.findMany({ where: { mergedIntoId: t.id }, select: { id: true } }));
    const { mergedTables: _m, ...rest } = t as any;
    return { ...rest, mergedWith: merged.map((m) => m.id), currentOrder: order };
  }

  async snapshot(id: string) {
    const t = await this.prisma.restaurantTable.findUnique({ where: { id }, include: { mergedTables: { select: { id: true } } } });
    if (!t) throw new NotFoundException('Table not found');
    return this.present(t);
  }

  /** Publish table events; call after the DB write has committed. */
  async publishChange(tableId: string, previousStatus?: TableStatus, actorId?: string) {
    const table = await this.snapshot(tableId);
    if (previousStatus && previousStatus !== table.status) {
      await this.bus.publish(EVENT.TABLE_STATUS_CHANGED, table.branchId, { table, previousStatus }, actorId);
    } else {
      await this.bus.publish(EVENT.TABLE_UPDATED, table.branchId, table, actorId);
    }
    return table;
  }

  async list(user: AuthUser | undefined, q: TableQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const where: Prisma.RestaurantTableWhereInput = { branchId, isActive: true };
    if (q.status) where.status = q.status;
    if (q.floor) where.floor = q.floor;
    if (q.area) where.area = q.area;
    const tables = await this.prisma.restaurantTable.findMany({
      where,
      include: { mergedTables: { select: { id: true } } },
      orderBy: [{ floor: 'asc' }, { tableNumber: 'asc' }],
    });
    const orderIds = tables.map((t) => t.currentOrderId).filter(Boolean) as string[];
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNumber: true, status: true, total: true, createdAt: true, _count: { select: { items: true } } },
        })
      : [];
    const byId = new Map(orders.map((o) => [o.id, o]));
    return tables.map(({ mergedTables, ...t }) => ({
      ...t,
      mergedWith: mergedTables.map((m) => m.id),
      currentOrder: t.currentOrderId ? (byId.get(t.currentOrderId) ?? null) : null,
    }));
  }

  async get(id: string, user?: AuthUser) {
    const t = await this.snapshot(id);
    if (user) await this.access.assertBranchAccess(user, t.branchId);
    return t;
  }

  async create(user: AuthUser, dto: CreateTableDto) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    const exists = await this.prisma.restaurantTable.findUnique({ where: { branchId_tableNumber: { branchId, tableNumber: dto.tableNumber } } });
    if (exists && exists.isActive) throw new ConflictException(`Table ${dto.tableNumber} already exists`);

    const data = {
      capacity: dto.capacity ?? 4,
      floor: dto.floor ?? 'Ground',
      area: dto.area ?? 'Main Hall',
      positionX: dto.positionX,
      positionY: dto.positionY,
      isActive: true,
      status: 'available' as const,
    };
    // Re-activate a previously soft-deleted table with the same number
    const table = exists
      ? await this.prisma.restaurantTable.update({ where: { id: exists.id }, data })
      : await this.prisma.restaurantTable.create({ data: { ...data, branchId, tableNumber: dto.tableNumber } });
    await this.prisma.restaurantTable.update({ where: { id: table.id }, data: { qrCode: this.orderUrl(branchId, table.id) } });
    return this.publishChange(table.id, undefined, user.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateTableDto) {
    const t = await this.get(id, user);
    if (dto.tableNumber && dto.tableNumber !== t.tableNumber) {
      const dup = await this.prisma.restaurantTable.findFirst({ where: { branchId: t.branchId, tableNumber: dto.tableNumber, isActive: true, NOT: { id } } });
      if (dup) throw new ConflictException(`Table ${dto.tableNumber} already exists`);
    }
    await this.prisma.restaurantTable.update({ where: { id }, data: dto });
    return this.publishChange(id, undefined, user.id);
  }

  async remove(user: AuthUser, id: string) {
    const t = await this.get(id, user);
    if (t.currentOrderId || t.status === 'occupied') throw new ConflictException('Cannot delete a table with an active order');
    // soft delete keeps historical orders/reservations intact; free the unique table number
    await this.prisma.restaurantTable.update({ where: { id }, data: { isActive: false, tableNumber: `${t.tableNumber}__deleted_${Date.now()}` } });
    await this.bus.publish(EVENT.TABLE_DELETED, t.branchId, { id, branchId: t.branchId }, user.id);
    return { id, deleted: true };
  }

  async setStatus(user: AuthUser, id: string, status: TableStatus) {
    const t = await this.get(id, user);
    if (status === 'available' && t.currentOrderId) {
      const active = await this.prisma.order.findFirst({ where: { id: t.currentOrderId, status: { in: [...ACTIVE_ORDER_STATUSES] } }, select: { id: true } });
      if (active) throw new ConflictException('Table has an active order. Settle or cancel it first.');
    }
    await this.prisma.restaurantTable.update({
      where: { id },
      data: { status, ...(status === 'available' ? { currentOrderId: null } : {}) },
    });
    return this.publishChange(id, t.status, user.id);
  }

  async merge(user: AuthUser, primaryId: string, tableIds: string[]) {
    const primary = await this.get(primaryId, user);
    const others = [...new Set(tableIds)].filter((x) => x !== primaryId);
    if (!others.length) throw new BadRequestException('Select at least one other table to merge');
    if (primary.mergedIntoId) throw new ConflictException('Primary table is already merged into another table');

    const tables = await this.prisma.restaurantTable.findMany({ where: { id: { in: others }, branchId: primary.branchId, isActive: true } });
    if (tables.length !== others.length) throw new NotFoundException('One or more tables were not found in this branch');
    const bad = tables.find((t) => t.status !== 'available' || t.mergedIntoId);
    if (bad) throw new ConflictException(`Table ${bad.tableNumber} is not available to merge`);

    await this.prisma.$transaction([
      this.prisma.restaurantTable.updateMany({
        where: { id: { in: others } },
        data: { mergedIntoId: primaryId, status: 'occupied', currentOrderId: primary.currentOrderId },
      }),
      ...(primary.status === 'available' ? [this.prisma.restaurantTable.update({ where: { id: primaryId }, data: { status: 'occupied' } })] : []),
    ]);
    for (const t of tables) await this.publishChange(t.id, 'available', user.id);
    const result = await this.publishChange(primaryId, primary.status, user.id);
    const combinedCapacity = tables.reduce((s, t) => s + t.capacity, primary.capacity);
    return { ...result, combinedCapacity };
  }

  async unmerge(user: AuthUser, tableId: string) {
    const t = await this.get(tableId, user);
    // Unmerging a secondary table detaches only that one; unmerging the primary releases the group.
    const targets = t.mergedIntoId ? [t.id] : t.mergedWith;
    if (!targets.length) throw new BadRequestException('This table is not part of a merged group');
    const primaryId = t.mergedIntoId ?? t.id;

    await this.prisma.restaurantTable.updateMany({
      where: { id: { in: targets } },
      data: { mergedIntoId: null, status: 'available', currentOrderId: null },
    });
    if (!t.mergedIntoId) {
      // primary keeps its own state unless it has no order
      if (!t.currentOrderId) await this.prisma.restaurantTable.update({ where: { id: t.id }, data: { status: 'available' } });
    }
    for (const id of targets) await this.publishChange(id, 'occupied', user.id);
    return this.publishChange(primaryId, undefined, user.id);
  }

  /** Move an in-progress order from one table to another empty table. */
  async shift(user: AuthUser, fromId: string, toId: string) {
    if (fromId === toId) throw new BadRequestException('Source and destination tables are the same');
    const from = await this.get(fromId, user);
    const to = await this.get(toId, user);
    if (from.branchId !== to.branchId) throw new BadRequestException('Tables belong to different branches');
    if (!from.currentOrderId) throw new BadRequestException('Source table has no active order to shift');
    if (to.status !== 'available' || to.mergedIntoId) throw new ConflictException(`Table ${to.tableNumber} is not available`);

    await this.prisma.$transaction([
      this.prisma.restaurantTable.update({ where: { id: toId }, data: { status: 'occupied', currentOrderId: from.currentOrderId } }),
      this.prisma.restaurantTable.update({ where: { id: fromId }, data: { status: 'available', currentOrderId: null } }),
      this.prisma.order.update({ where: { id: from.currentOrderId }, data: { tableId: toId } }),
      // keep any merged children pointing at the order's new home
      this.prisma.restaurantTable.updateMany({ where: { mergedIntoId: fromId }, data: { mergedIntoId: toId } }),
    ]);

    const orderId = from.currentOrderId;
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, table: { select: { id: true, tableNumber: true, floor: true, area: true } }, waiter: { select: { id: true, fullName: true } } },
    });
    await this.bus.publish(EVENT.ORDER_UPDATED, order.branchId, order, user.id);
    await this.publishChange(fromId, from.status, user.id);
    return this.publishChange(toId, 'available', user.id);
  }

  async saveLayout(user: AuthUser, dto: LayoutDto) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    const ids = dto.tables.map((t) => t.id);
    const count = await this.prisma.restaurantTable.count({ where: { id: { in: ids }, branchId } });
    if (count !== ids.length) throw new NotFoundException('One or more tables were not found in this branch');
    await this.prisma.$transaction(
      dto.tables.map(({ id, ...data }) => this.prisma.restaurantTable.update({ where: { id }, data })),
    );
    for (const id of ids) await this.publishChange(id, undefined, user.id);
    return this.list(user, { branchId });
  }

  async qr(id: string) {
    const t = await this.prisma.restaurantTable.findUnique({ where: { id }, select: { id: true, branchId: true, tableNumber: true } });
    if (!t) throw new NotFoundException('Table not found');
    return { tableId: t.id, tableNumber: t.tableNumber, url: this.orderUrl(t.branchId, t.id) };
  }
}

/** Anonymous (QR customer) view of a table: no order details. */
function publicTable(t: any) {
  const { currentOrder: _o, qrCode: _q, ...rest } = t;
  return rest;
}

// ───────────────────────── Controller ─────────────────────────

@ApiTags('tables')
@ApiBearerAuth()
@Controller('tables')
export class TablesController {
  constructor(private readonly svc: TablesService) {}

  @Public() // read-only floor info; branch is required when anonymous
  @Get()
  async list(@CurrentUser() user: AuthUser | undefined, @Query() q: TableQueryDto) {
    const tables = await this.svc.list(user, q);
    return user ? tables : tables.map(publicTable);
  }

  @Roles(...MANAGERS)
  @Patch('layout')
  layout(@CurrentUser() user: AuthUser, @Body() dto: LayoutDto) {
    return this.svc.saveLayout(user, dto);
  }

  @Public()
  @Get(':id')
  async get(@CurrentUser() user: AuthUser | undefined, @Param('id', ParseUUIDPipe) id: string) {
    const t = await this.svc.get(id, user);
    return user ? t : publicTable(t);
  }

  @Get(':id/qr')
  qr(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.qr(id);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTableDto) {
    return this.svc.create(user, dto);
  }

  @Roles(...MANAGERS)
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto) {
    return this.svc.update(user, id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user, id);
  }

  @Roles(...FLOOR_STAFF)
  @Patch(':id/status')
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TableStatusDto) {
    return this.svc.setStatus(user, id, dto.status);
  }

  @Roles(...FLOOR_STAFF)
  @Post(':id/merge')
  merge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MergeTablesDto) {
    return this.svc.merge(user, id, dto.tableIds);
  }

  @Roles(...FLOOR_STAFF)
  @Post(':id/unmerge')
  unmerge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unmerge(user, id);
  }

  @Roles(...FLOOR_STAFF)
  @Post(':id/shift')
  shift(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShiftTableDto) {
    return this.svc.shift(user, id, dto.toTableId);
  }
}

@Module({ controllers: [TablesController], providers: [TablesService], exports: [TablesService] })
export class TablesModule {}
