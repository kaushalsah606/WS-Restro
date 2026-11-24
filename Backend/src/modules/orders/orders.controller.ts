import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, FLOOR_STAFF, KITCHEN, ALL_STAFF, Roles } from '../../common/decorators';
import {
  AddItemsDto,
  CreateOrderDto,
  KotQueryDto,
  KotStatusDto,
  OrderQueryDto,
  SplitTableDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
  UpdateOrderStatusDto,
} from './dto/orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}

  @Roles(...ALL_STAFF)
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: OrderQueryDto) {
    return this.svc.list(user, q);
  }

  // Declared before ':id' so "items" is not parsed as an id
  @Roles(...ALL_STAFF)
  @Get('items')
  items(@CurrentUser() user: AuthUser, @Query() q: { branchId?: string; startDate?: string; endDate?: string }) {
    return this.svc.itemsReport(user, q);
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id);
  }

  @Roles(...FLOOR_STAFF)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.svc.create(user, dto);
  }

  @Roles(...FLOOR_STAFF)
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.svc.update(user, id, dto);
  }

  @Roles(...ALL_STAFF)
  @Patch(':id/status')
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.svc.updateStatus(user, id, dto.status, dto.reason);
  }

  @Roles(...FLOOR_STAFF)
  @Post(':id/items')
  addItems(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddItemsDto) {
    return this.svc.addItems(user, id, dto);
  }

  @Roles(...ALL_STAFF)
  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateOrderItemDto,
  ) {
    return this.svc.updateItem(user, id, itemId, dto);
  }

  @Roles(...FLOOR_STAFF)
  @Delete(':id/items/:itemId')
  deleteItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.svc.deleteItem(user, id, itemId);
  }

  @Roles(...ALL_STAFF)
  @Post(':id/kot/reprint')
  reprint(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { kotId?: string }) {
    return this.svc.reprintKot(user, id, body?.kotId);
  }
}

/** Table-scoped order operations (kept under /tables to match the UI's mental model). */
@ApiTags('tables')
@ApiBearerAuth()
@Controller('tables')
export class TableOrderOpsController {
  constructor(private readonly svc: OrdersService) {}

  @Roles(...FLOOR_STAFF)
  @Post(':id/split')
  split(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SplitTableDto) {
    return this.svc.splitToTable(user, id, dto);
  }
}

@ApiTags('kitchen')
@ApiBearerAuth()
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly svc: OrdersService) {}

  @Roles(...KITCHEN, 'WAITER', 'CASHIER')
  @Get('kots')
  kots(@CurrentUser() user: AuthUser, @Query() q: KotQueryDto) {
    return this.svc.listKots(user, q);
  }

  @Roles(...KITCHEN)
  @Patch('kots/:id/status')
  kotStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: KotStatusDto) {
    return this.svc.setKotStatus(user, id, dto.status);
  }
}
