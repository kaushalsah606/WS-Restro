import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessModule } from './common/access/access.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { CamelCaseBodyMiddleware } from './common/middleware/camel-case-body.middleware';
import { SequenceModule } from './common/sequence/sequence.service';
import { AppConfigModule } from './config/app-config.service';
import { validateEnv } from './config/env';
import { EventsModule } from './infra/events/events.module';
import { PrismaModule } from './infra/prisma/prisma.service';
import { QueueModule } from './infra/queue/queue.module';
import { RedisModule } from './infra/redis/redis.module';
import { SearchInfraModule } from './infra/search/search-infra.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { CustomerModule } from './modules/customer/customer.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MenuModule } from './modules/menu/menu.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PrintersModule } from './modules/printers/printers.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { SearchModule } from './modules/search/search.module';
import { TablesModule } from './modules/tables/tables.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    AppConfigModule,

    // infrastructure
    PrismaModule,
    RedisModule,
    EventsModule,
    QueueModule,
    SearchInfraModule,
    AccessModule,
    SequenceModule,

    // domain
    AuthModule,
    RestaurantsModule,
    TablesModule,
    MenuModule,
    OrdersModule,
    BillingModule,
    ReportsModule,
    InventoryModule,
    ReservationsModule,
    PrintersModule,
    NotificationsModule,
    SearchModule,
    CustomerModule,
    RealtimeModule,
    WorkflowsModule,
    HealthModule,
  ],
  providers: [
    // order matters: authenticate -> authorize
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CamelCaseBodyMiddleware).forRoutes('*');
  }
}
