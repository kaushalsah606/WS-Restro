import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Controller, Get, Injectable, Logger, Module, OnModuleInit, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Job, Queue } from 'bullmq';
import { ADMINS, ALL_STAFF, AuthUser, CurrentUser, Public, Roles } from '../../common/decorators';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBus } from '../../infra/events/event-bus.service';
import { DomainEvent, EVENT } from '../../infra/events/event-types';
import { JOBS, QUEUES } from '../../infra/queue/queue.constants';
import { OpenSearchService } from '../../infra/search/opensearch.service';
import { menuDoc, orderDoc, reservationDoc } from './search.docs';
import { SearchKind, SearchService } from './search.service';

/** Kafka consumer group "search-indexer": keeps OpenSearch in sync with every domain change. */
@Injectable()
export class SearchIndexer implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly os: OpenSearchService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (!this.config.runsWorkers || !this.os.enabled) return;
    this.bus.subscribe('search-indexer', (e) => this.handle(e));
  }

  private async handle(e: DomainEvent) {
    const d = e.data;
    switch (e.type) {
      case EVENT.MENU_UPDATED:
        if (d?.id && d?.price !== undefined) await this.os.indexDoc('menu', d.id, menuDoc(d));
        break;
      case EVENT.MENU_AVAILABILITY_CHANGED:
        if (d?.item) await this.os.indexDoc('menu', d.item.id, menuDoc(d.item));
        break;
      case EVENT.MENU_DELETED:
        await this.os.deleteDoc('menu', d.id);
        break;
      case EVENT.ORDER_CREATED:
      case EVENT.ORDER_UPDATED:
        await this.os.indexDoc('orders', d.id, orderDoc(d));
        break;
      case EVENT.ORDER_ITEMS_ADDED:
      case EVENT.ORDER_STATUS_CHANGED:
        await this.os.indexDoc('orders', d.order.id, orderDoc(d.order));
        break;
      case EVENT.RESERVATION_CREATED:
      case EVENT.RESERVATION_UPDATED:
        await this.os.indexDoc('reservations', d.id, reservationDoc(d));
        break;
      default:
        break;
    }
  }
}

/**
 * On boot, if OpenSearch is behind PostgreSQL (fresh cluster, restored backup, seeded data),
 * queue a full reindex so search works without manual steps.
 */
@Injectable()
export class SearchBackfill implements OnModuleInit {
  private readonly logger = new Logger(SearchBackfill.name);
  constructor(
    private readonly os: OpenSearchService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.SEARCH) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    if (this.config.runsWorkers && this.os.enabled) void this.run();
  }

  private async run() {
    for (let i = 0; i < 60 && !this.os.isReady; i++) await new Promise((r) => setTimeout(r, 2000));
    if (!this.os.isReady) return;
    try {
      const [menuDb, menuOs, ordersDb, ordersOs, resDb, resOs] = await Promise.all([
        this.prisma.menuItem.count(),
        this.os.count('menu'),
        this.prisma.order.count(),
        this.os.count('orders'),
        this.prisma.reservation.count(),
        this.os.count('reservations'),
      ]);
      if (menuDb !== menuOs || ordersDb !== ordersOs || resDb !== resOs) {
        this.logger.log(`Search index out of date (menu ${menuOs}/${menuDb}, orders ${ordersOs}/${ordersDb}); queueing reindex`);
        await this.queue.add(JOBS.SEARCH_REINDEX, { kind: 'all' }, { jobId: 'search-backfill', removeOnComplete: true });
      }
    } catch (e) {
      this.logger.warn(`Search backfill check failed: ${(e as Error).message}`);
    }
  }
}

/** BullMQ job: full reindex from PostgreSQL (after restoring a backup, or first boot with existing data). */
@Processor(QUEUES.SEARCH)
export class ReindexProcessor extends WorkerHost {
  constructor(private readonly search: SearchService) {
    super();
  }
  async process(job: Job<{ kind: SearchKind | 'all'; branchId?: string }>) {
    return this.search.reindex(job.data.kind, job.data.branchId);
  }
}

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(
    private readonly svc: SearchService,
    @InjectQueue(QUEUES.SEARCH) private readonly queue: Queue,
  ) {}

  @Public()
  @Get('menu')
  menu(@CurrentUser() user: AuthUser | undefined, @Query() q: any) {
    return this.svc.menu(user, { q: String(q.q ?? ''), branchId: q.branchId, categoryId: q.categoryId, isVeg: q.isVeg === undefined ? undefined : q.isVeg === 'true', limit: Number(q.limit) || undefined });
  }

  @Roles(...ALL_STAFF)
  @Get('orders')
  orders(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.orders(user, { q: String(q.q ?? ''), branchId: q.branchId, status: q.status, limit: Number(q.limit) || undefined });
  }

  @Roles(...ALL_STAFF)
  @Get('reservations')
  reservations(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.reservations(user, { q: String(q.q ?? ''), branchId: q.branchId, limit: Number(q.limit) || undefined });
  }

  @Roles(...ALL_STAFF)
  @Get()
  global(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.svc.global(user, { q: String(q.q ?? ''), branchId: q.branchId, limit: Number(q.limit) || undefined });
  }

  @Roles(...ADMINS)
  @Post('reindex')
  async reindex(@Query('kind') kind: SearchKind | 'all' = 'all', @Query('branchId') branchId?: string) {
    const job = await this.queue.add(JOBS.SEARCH_REINDEX, { kind, branchId }, { removeOnComplete: true });
    return { queued: true, jobId: job.id };
  }
}

@Module({
  controllers: [SearchController],
  providers: [SearchService, SearchIndexer, SearchBackfill, ReindexProcessor],
  exports: [SearchService],
})
export class SearchModule {}
