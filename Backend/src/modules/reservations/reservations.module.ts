import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
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
import { Prisma, ReservationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AccessService } from '../../common/access/access.service';
import { AuthUser, CurrentUser, FLOOR_STAFF, Roles, ALL_STAFF } from '../../common/decorators';
import { hhmmToMinutes } from '../../common/utils/dates';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TablesModule, TablesService } from '../tables/tables.module';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BLOCKING: ReservationStatus[] = ['pending', 'confirmed', 'seated'];
const INCLUDE = { table: { select: { id: true, tableNumber: true, capacity: true } } } satisfies Prisma.ReservationInclude;

class CreateReservationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiProperty() @IsString() @MaxLength(120) customerName: string;
  @ApiProperty() @IsString() @MaxLength(32) customerPhone: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() customerEmail?: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(200) partySize: number;
  @ApiProperty({ example: '2026-01-31' }) @Matches(DATE_RE) reservationDate: string;
  @ApiProperty({ example: '19:30' }) @Matches(TIME_RE) reservationTime: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(600) durationMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) specialRequests?: string;
  @ApiPropertyOptional({ enum: ReservationStatus }) @IsOptional() @IsEnum(ReservationStatus) status?: ReservationStatus;
}

class UpdateReservationDto {
  @IsOptional() @IsUUID() tableId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) customerName?: string;
  @IsOptional() @IsString() @MaxLength(32) customerPhone?: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) partySize?: number;
  @IsOptional() @Matches(DATE_RE) reservationDate?: string;
  @IsOptional() @Matches(TIME_RE) reservationTime?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(600) durationMinutes?: number;
  @IsOptional() @IsString() @MaxLength(500) specialRequests?: string;
}

class ReservationStatusDto {
  @ApiProperty({ enum: ReservationStatus }) @IsEnum(ReservationStatus) status: ReservationStatus;
}

class ReservationQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @Matches(DATE_RE) date?: string;
  @IsOptional() @Matches(DATE_RE) from?: string;
  @IsOptional() @Matches(DATE_RE) to?: string;
  @IsOptional() @IsEnum(ReservationStatus) status?: ReservationStatus;
  @IsOptional() @IsUUID() tableId?: string;
  @IsOptional() @IsString() search?: string;
}

class AvailabilityQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @Matches(DATE_RE) date: string;
  @Matches(TIME_RE) time: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) partySize?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(15) durationMinutes?: number;
}

const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
    private readonly tables: TablesService,
  ) {}

  private async load(user: AuthUser, id: string) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: INCLUDE });
    if (!r) throw new NotFoundException('Reservation not found');
    await this.access.assertBranchAccess(user, r.branchId);
    return r;
  }

  async list(user: AuthUser, q: ReservationQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const where: Prisma.ReservationWhereInput = { branchId };
    if (q.date) where.reservationDate = toDate(q.date);
    else if (q.from || q.to) where.reservationDate = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) };
    if (q.status) where.status = q.status;
    if (q.tableId) where.tableId = q.tableId;
    if (q.search) where.OR = [{ customerName: { contains: q.search, mode: 'insensitive' } }, { customerPhone: { contains: q.search } }];
    return this.prisma.reservation.findMany({ where, include: INCLUDE, orderBy: [{ reservationDate: 'asc' }, { reservationTime: 'asc' }] });
  }

  get(user: AuthUser, id: string) {
    return this.load(user, id);
  }

  /** Does the table already have a blocking reservation overlapping this window? */
  private async hasConflict(tableId: string, date: Date, time: string, duration: number, excludeId?: string) {
    const start = hhmmToMinutes(time);
    const others = await this.prisma.reservation.findMany({
      where: { tableId, reservationDate: date, status: { in: BLOCKING }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    return others.find((o) => {
      const s = hhmmToMinutes(o.reservationTime);
      return start < s + o.durationMinutes && s < start + duration;
    });
  }

  async create(user: AuthUser, dto: CreateReservationDto) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    const date = toDate(dto.reservationDate);
    const duration = dto.durationMinutes ?? 90;

    if (dto.tableId) {
      const table = await this.prisma.restaurantTable.findFirst({ where: { id: dto.tableId, branchId, isActive: true } });
      if (!table) throw new NotFoundException('Table not found');
      if (dto.partySize > table.capacity) throw new BadRequestException(`Table ${table.tableNumber} seats only ${table.capacity}`);
      const clash = await this.hasConflict(dto.tableId, date, dto.reservationTime, duration);
      if (clash) throw new ConflictException(`Table ${table.tableNumber} is already reserved at ${clash.reservationTime}`);
    }
    const { branchId: _b, reservationDate: _d, ...rest } = dto;
    const r = await this.prisma.reservation.create({
      data: { ...rest, branchId, reservationDate: date, durationMinutes: duration, status: dto.status ?? 'confirmed' },
      include: INCLUDE,
    });
    await this.bus.publish(EVENT.RESERVATION_CREATED, branchId, r, user.id);
    return r;
  }

  async update(user: AuthUser, id: string, dto: UpdateReservationDto) {
    const existing = await this.load(user, id);
    if (['completed', 'cancelled', 'no_show'].includes(existing.status)) throw new ConflictException(`A ${existing.status} reservation cannot be edited`);
    const tableId = dto.tableId === undefined ? existing.tableId : dto.tableId;
    const date = dto.reservationDate ? toDate(dto.reservationDate) : existing.reservationDate;
    const time = dto.reservationTime ?? existing.reservationTime;
    const duration = dto.durationMinutes ?? existing.durationMinutes;
    const party = dto.partySize ?? existing.partySize;

    if (tableId) {
      const table = await this.prisma.restaurantTable.findFirst({ where: { id: tableId, branchId: existing.branchId, isActive: true } });
      if (!table) throw new NotFoundException('Table not found');
      if (party > table.capacity) throw new BadRequestException(`Table ${table.tableNumber} seats only ${table.capacity}`);
      if (await this.hasConflict(tableId, date, time, duration, id)) throw new ConflictException(`Table ${table.tableNumber} is already reserved for that time`);
    }
    const { reservationDate: _d, tableId: _t, ...rest } = dto;
    const r = await this.prisma.reservation.update({ where: { id }, data: { ...rest, tableId, reservationDate: date }, include: INCLUDE });
    await this.bus.publish(EVENT.RESERVATION_UPDATED, r.branchId, r, user.id);
    return r;
  }

  async setStatus(user: AuthUser, id: string, status: ReservationStatus) {
    const existing = await this.load(user, id);
    const r = await this.prisma.reservation.update({ where: { id }, data: { status }, include: INCLUDE });
    await this.syncTable(r, status, user.id);
    await this.bus.publish(EVENT.RESERVATION_UPDATED, r.branchId, r, user.id);
    return { ...r, previousStatus: existing.status };
  }

  /** Keep the floor plan in step with the reservation lifecycle. */
  private async syncTable(r: { tableId: string | null; id: string }, status: ReservationStatus, actorId?: string) {
    if (!r.tableId) return;
    const table = await this.prisma.restaurantTable.findUnique({ where: { id: r.tableId } });
    if (!table) return;
    if (status === 'seated' && ['available', 'reserved'].includes(table.status)) {
      await this.prisma.restaurantTable.update({ where: { id: table.id }, data: { status: 'occupied' } });
      await this.tables.publishChange(table.id, table.status, actorId);
    } else if (['cancelled', 'no_show', 'completed'].includes(status) && table.status === 'reserved' && !table.currentOrderId) {
      await this.prisma.restaurantTable.update({ where: { id: table.id }, data: { status: 'available' } });
      await this.tables.publishChange(table.id, 'reserved', actorId);
    }
  }

  async cancel(user: AuthUser, id: string) {
    return this.setStatus(user, id, 'cancelled');
  }

  async availability(user: AuthUser, q: AvailabilityQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const date = toDate(q.date);
    const duration = q.durationMinutes ?? 90;
    const tables = await this.prisma.restaurantTable.findMany({
      where: { branchId, isActive: true, mergedIntoId: null, ...(q.partySize ? { capacity: { gte: q.partySize } } : {}) },
      orderBy: { tableNumber: 'asc' },
    });
    const free = [];
    for (const t of tables) if (!(await this.hasConflict(t.id, date, q.time, duration))) free.push(t);
    return free;
  }

  // ───────────────────────── scheduled sweep (BullMQ) ─────────────────────────

  /**
   * Every minute: (1) put tables on hold 30 min before a confirmed reservation,
   * (2) mark parties that are 30+ min late as no-shows and release their table.
   */
  async sweep(now = new Date()): Promise<{ held: number; noShows: number }> {
    // Reservation date/time are wall-clock values in the server's timezone (set TZ in the container).
    const pad = (x: number) => String(x).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const candidates = await this.prisma.reservation.findMany({
      where: { reservationDate: toDate(today), status: { in: ['pending', 'confirmed'] } },
      include: INCLUDE,
    });
    let held = 0;
    let noShows = 0;

    for (const r of candidates) {
      const start = hhmmToMinutes(r.reservationTime);
      if (nowMin >= start + 30) {
        const updated = await this.prisma.reservation.update({ where: { id: r.id }, data: { status: 'no_show' }, include: INCLUDE });
        await this.syncTable(updated, 'no_show');
        await this.bus.publish(EVENT.RESERVATION_UPDATED, updated.branchId, updated);
        noShows++;
      } else if (r.tableId && r.status === 'confirmed' && nowMin >= start - 30) {
        const t = await this.prisma.restaurantTable.findUnique({ where: { id: r.tableId } });
        if (t && t.status === 'available') {
          await this.prisma.restaurantTable.update({ where: { id: t.id }, data: { status: 'reserved' } });
          await this.tables.publishChange(t.id, 'available');
          held++;
        }
      }
    }
    if (held || noShows) this.logger.log(`Reservation sweep: held=${held} noShows=${noShows}`);
    return { held, noShows };
  }
}

@ApiTags('reservations')
@ApiBearerAuth()
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly svc: ReservationsService) {}

  @Roles(...ALL_STAFF)
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ReservationQueryDto) {
    return this.svc.list(user, q);
  }

  @Roles(...ALL_STAFF)
  @Get('availability')
  availability(@CurrentUser() user: AuthUser, @Query() q: AvailabilityQueryDto) {
    return this.svc.availability(user, q);
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id);
  }

  @Roles(...FLOOR_STAFF)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.svc.create(user, dto);
  }

  @Roles(...FLOOR_STAFF)
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReservationDto) {
    return this.svc.update(user, id, dto);
  }

  @Roles(...FLOOR_STAFF)
  @Patch(':id/status')
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReservationStatusDto) {
    return this.svc.setStatus(user, id, dto.status);
  }

  @Roles(...FLOOR_STAFF)
  @Delete(':id')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(user, id);
  }
}

@Module({ imports: [TablesModule], controllers: [ReservationsController], providers: [ReservationsService], exports: [ReservationsService] })
export class ReservationsModule {}
