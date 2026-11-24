import { Module } from '@nestjs/common';
import { TablesModule } from '../tables/tables.module';
import { KitchenController, OrdersController, TableOrderOpsController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [TablesModule],
  controllers: [OrdersController, TableOrderOpsController, KitchenController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
