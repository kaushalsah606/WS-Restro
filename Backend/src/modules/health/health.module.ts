import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import Redis from 'ioredis';
import { Public } from '../../common/decorators';
import { EventBus } from '../../infra/events/event-bus.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';
import { OpenSearchService } from '../../infra/search/opensearch.service';

type Check = 'up' | 'down' | 'disabled';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly bus: EventBus,
    private readonly os: OpenSearchService,
  ) {}

  /** Liveness: process is up. */
  @Get('live')
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  /** Readiness: hard dependencies (PostgreSQL, Redis) must be up; Kafka/OpenSearch are reported but degrade gracefully. */
  @Get()
  async ready() {
    const checks: Record<string, Check> = {
      postgres: await this.prisma.$queryRaw`SELECT 1`.then(() => 'up' as const).catch(() => 'down' as const),
      redis: await this.redis.ping().then(() => 'up' as const).catch(() => 'down' as const),
      kafka: this.bus.kafkaEnabled ? (this.bus.connected ? 'up' : 'down') : 'disabled',
      opensearch: this.os.enabled ? ((await this.os.ping()) ? 'up' : 'down') : 'disabled',
    };
    const healthy = checks.postgres === 'up' && checks.redis === 'up';
    const body = { status: healthy ? (Object.values(checks).includes('down') ? 'degraded' : 'ok') : 'down', checks, timestamp: new Date().toISOString() };
    if (!healthy) throw new ServiceUnavailableException(body);
    return body;
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
