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
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AccessService } from '../../common/access/access.service';
import { ADMINS, AuthUser, CurrentUser, MANAGERS, Public, Roles } from '../../common/decorators';
import { startOfDay } from '../../common/utils/dates';
import { PrismaService } from '../../infra/prisma/prisma.service';

class CreateRestaurantDto {
  @ApiProperty() @IsString() @MaxLength(150) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() logo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @ApiPropertyOptional({ description: 'percent' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @ApiPropertyOptional({ description: 'percent' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) serviceCharge?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateRestaurantDto extends PartialType(CreateRestaurantDto) {}

class UpsertBranchDto {
  @ApiProperty() @IsString() @MaxLength(150) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{2}:\d{2}$/) openingTime?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{2}:\d{2}$/) closingTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() restaurantId?: string;
}

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  list(user: AuthUser) {
    const isSuper = user.roles.some((r) => r.role === 'SUPER_ADMIN');
    const ids = user.roles.map((r) => r.restaurantId).filter(Boolean) as string[];
    return this.prisma.restaurant.findMany({
      where: isSuper || ids.length === 0 ? {} : { id: { in: ids } },
      include: { branches: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string) {
    const r = await this.prisma.restaurant.findUnique({ where: { id }, include: { branches: true } });
    if (!r) throw new NotFoundException('Restaurant not found');
    return r;
  }

  create(dto: CreateRestaurantDto) {
    return this.prisma.restaurant.create({ data: dto });
  }

  async update(id: string, dto: UpdateRestaurantDto) {
    await this.get(id);
    const r = await this.prisma.restaurant.update({ where: { id }, data: dto });
    await this.access.invalidateBranchSettings(id);
    return r;
  }

  /** The single-restaurant frontend resolves its branch via this endpoint. */
  async defaultBranch() {
    const id = await this.access.getDefaultBranchId();
    return this.prisma.branch.findUniqueOrThrow({ where: { id }, include: { restaurant: true } });
  }

  async stats(user: AuthUser) {
    const branchId = await this.access.resolveBranchId(user);
    const today = startOfDay();
    const [restaurants, branches, tables, staff, todayBills] = await Promise.all([
      this.prisma.restaurant.count(),
      this.prisma.branch.count(),
      this.prisma.restaurantTable.count({ where: { branchId, isActive: true } }),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.bill.aggregate({
        where: { branchId, status: 'completed', generatedAt: { gte: today } },
        _sum: { total: true },
        _count: true,
      }),
    ]);
    return { restaurants, branches, tables, staff, todayRevenue: todayBills._sum.total ?? 0, todayBills: todayBills._count };
  }

  listBranches(restaurantId?: string) {
    return this.prisma.branch.findMany({ where: restaurantId ? { restaurantId } : {}, orderBy: { createdAt: 'asc' } });
  }

  async createBranch(dto: UpsertBranchDto) {
    const restaurantId = dto.restaurantId ?? (await this.prisma.restaurant.findFirst({ orderBy: { createdAt: 'asc' } }))?.id;
    if (!restaurantId) throw new NotFoundException('No restaurant exists yet');
    const { restaurantId: _r, ...rest } = dto;
    const b = await this.prisma.branch.create({ data: { ...rest, restaurantId } });
    await this.access.invalidateBranchSettings(restaurantId);
    return b;
  }

  async updateBranch(id: string, dto: Partial<UpsertBranchDto>) {
    const { restaurantId: _r, ...rest } = dto;
    const b = await this.prisma.branch.update({ where: { id }, data: rest });
    await this.access.invalidateBranchSettings(b.restaurantId);
    return b;
  }

  async deleteBranch(id: string) {
    const b = await this.prisma.branch.update({ where: { id }, data: { isActive: false } });
    await this.access.invalidateBranchSettings(b.restaurantId);
    return { id, deactivated: true };
  }
}

@ApiTags('restaurants')
@ApiBearerAuth()
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly svc: RestaurantsService) {}

  @Public()
  @Get('default-branch')
  defaultBranch() {
    return this.svc.defaultBranch();
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.svc.stats(user);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Roles(...ADMINS)
  @Post()
  create(@Body() dto: CreateRestaurantDto) {
    return this.svc.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  @Roles(...ADMINS)
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRestaurantDto) {
    return this.svc.update(id, dto);
  }
}

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly svc: RestaurantsService) {}

  @Get()
  list() {
    return this.svc.listBranches();
  }

  @Roles(...ADMINS)
  @Post()
  create(@Body() dto: UpsertBranchDto) {
    return this.svc.createBranch(dto);
  }

  @Roles(...MANAGERS)
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertBranchDto) {
    return this.svc.updateBranch(id, dto);
  }

  @Roles(...ADMINS)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteBranch(id);
  }
}

@Module({ controllers: [RestaurantsController, BranchesController], providers: [RestaurantsService], exports: [RestaurantsService] })
export class RestaurantsModule {}
