import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AccessService } from '../../common/access/access.service';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OrderItemInputDto } from '../orders/dto/orders.dto';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { MenuModule, MenuService } from '../menu/menu.module';

class CustomerOrderDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsUUID() tableId: string;
  @ApiPropertyOptional({ description: 'Anonymous browser session id, lets the guest re-find their order' })
  @IsOptional() @IsString() @MaxLength(100) sessionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiProperty({ type: [OrderItemInputDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items: OrderItemInputDto[];
}

class CustomerAddItemsDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ type: [OrderItemInputDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items: OrderItemInputDto[];
}

/** Guest-safe projection: no waiter, no internal ids beyond what the QR page needs. */
function guestOrder(o: any) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    createdAt: o.createdAt,
    subtotal: o.subtotal,
    tax: o.tax,
    serviceCharge: o.serviceCharge,
    discount: o.discount,
    total: o.total,
    tableId: o.tableId,
    branchId: o.branchId,
    items: (o.items ?? []).map((i: any) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.total,
      status: i.status,
      notes: i.notes,
      variantName: i.variantName,
    })),
  };
}

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly orders: OrdersService,
    private readonly menu: MenuService,
  ) {}

  async restaurantInfo(branchId: string) {
    const s = await this.access.getBranchSettings(branchId);
    return { branchId: s.branchId, branchName: s.branchName, restaurantName: s.restaurantName, name: s.restaurantName, logo: s.logo, currency: s.currency, taxRate: s.taxRate, serviceChargeRate: s.serviceChargeRate };
  }

  async table(tableId: string) {
    const t = await this.prisma.restaurantTable.findFirst({ where: { id: tableId, isActive: true }, select: { id: true, branchId: true, tableNumber: true, currentOrderId: true, status: true, floor: true, area: true } });
    if (!t) throw new NotFoundException('Table not found');
    return t;
  }

  async order(orderId: string) {
    return guestOrder(await this.orders.snapshot(orderId));
  }

  async place(dto: CustomerOrderDto) {
    const o = await this.orders.create(undefined, { branchId: dto.branchId, tableId: dto.tableId, notes: dto.notes, customerName: dto.customerName, customerPhone: dto.customerPhone, items: dto.items }, { customerSessionId: dto.sessionId });
    return guestOrder(o);
  }

  async add(orderId: string, dto: CustomerAddItemsDto) {
    return guestOrder(await this.orders.addItems(undefined, orderId, { items: dto.items }, { branchId: dto.branchId }));
  }

  menuFor(branchId: string) {
    return this.menu.fullMenu(undefined, branchId);
  }
}

/** Unauthenticated endpoints used by the QR-code ordering page (/order?branch=&table=). */
@ApiTags('customer')
@Public()
@Controller('public')
export class CustomerController {
  constructor(private readonly svc: CustomerService) {}

  @Get('branches/:branchId')
  branch(@Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.svc.restaurantInfo(branchId);
  }

  @Get('tables/:tableId')
  table(@Param('tableId', ParseUUIDPipe) tableId: string) {
    return this.svc.table(tableId);
  }

  @Get('menu')
  menu(@Query('branchId', ParseUUIDPipe) branchId: string) {
    return this.svc.menuFor(branchId);
  }

  @Get('orders/:id')
  order(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.order(id);
  }

  @Post('orders')
  place(@Body() dto: CustomerOrderDto) {
    return this.svc.place(dto);
  }

  @Post('orders/:id/items')
  add(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerAddItemsDto) {
    return this.svc.add(id, dto);
  }
}

@Module({ imports: [OrdersModule, MenuModule], controllers: [CustomerController], providers: [CustomerService] })
export class CustomerModule {}
