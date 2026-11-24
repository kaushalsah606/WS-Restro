import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ReportsModule } from '../reports/reports.module';
import { TablesModule } from '../tables/tables.module';
import { BillingController, PaymentsController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [OrdersModule, TablesModule, ReportsModule],
  controllers: [BillingController, PaymentsController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
