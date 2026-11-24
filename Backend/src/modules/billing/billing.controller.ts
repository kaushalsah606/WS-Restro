import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, BILLING_STAFF, CurrentUser, MANAGERS, Roles } from '../../common/decorators';
import { ReportQueryDto, ReportsService } from '../reports/reports.module';
import { BillingService } from './billing.service';
import {
  AddPaymentDto,
  BillQueryDto,
  CheckoutDto,
  DiscountDto,
  MergeBillDto,
  PartialBillDto,
  PaymentQueryDto,
  RefundDto,
  SplitBillDto,
} from './dto/billing.dto';

@ApiTags('billing')
@ApiBearerAuth()
@Roles(...BILLING_STAFF)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly svc: BillingService,
    private readonly reports: ReportsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: BillQueryDto) {
    return this.svc.list(user, q);
  }

  // Static segments first so they are not captured by ':id'
  @Get('reports')
  report(@CurrentUser() user: AuthUser, @Query() q: ReportQueryDto) {
    return this.reports.composite(user, q);
  }

  @Get('payments')
  payments(@CurrentUser() user: AuthUser, @Query() q: PaymentQueryDto) {
    return this.svc.listPayments(user, q);
  }

  @Post('partial')
  partial(@CurrentUser() user: AuthUser, @Body() dto: PartialBillDto) {
    return this.svc.partial(user, dto);
  }

  @Post('merge')
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergeBillDto) {
    return this.svc.merge(user, dto);
  }

  @Post('orders/:orderId/generate')
  generate(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.svc.generate(user, orderId);
  }

  @Post('orders/:orderId/checkout')
  checkout(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: CheckoutDto) {
    return this.svc.checkout(user, orderId, dto);
  }

  @Post('orders/:orderId/split')
  split(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: SplitBillDto) {
    return this.svc.split(user, orderId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id);
  }

  @Post(':id/payments')
  addPayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPaymentDto) {
    return this.svc.addPayment(user, id, dto);
  }

  @Post(':id/discount')
  discount(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DiscountDto) {
    return this.svc.applyDiscount(user, id, dto);
  }

  @Roles(...MANAGERS)
  @Post(':id/refund')
  refund(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto) {
    return this.svc.refund(user, id, dto.reason);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelOpenBill(user, id);
  }
}

/** Convenience alias used by the reports screen: GET /payments */
@ApiTags('billing')
@ApiBearerAuth()
@Roles(...BILLING_STAFF)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: BillingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: PaymentQueryDto) {
    return this.svc.listPayments(user, q);
  }
}
