import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { AppConfig } from '../../config/app-config.service';
import { decimalsToNumbers } from '../../common/utils/case';

export const REDIS = Symbol('REDIS_CLIENT');

/** Parse REDIS_URL into ioredis options (shared with BullMQ, which needs maxRetriesPerRequest=null). */
export function redisOptions(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

/** JSON cache + counters on top of ioredis. */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS) public readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (e) {
      this.logger.warn(`cache get failed (${key}): ${(e as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(decimalsToNumbers(value)), 'EX', ttlSeconds);
    } catch (e) {
      this.logger.warn(`cache set failed (${key}): ${(e as Error).message}`);
    }
  }

  /** Read-through cache. */
  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const fresh = await loader();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys).catch(() => undefined);
  }

  /** Delete every key beginning with prefix (SCAN based, safe for production). */
  async delByPrefix(prefix: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch (e) {
      this.logger.warn(`cache delByPrefix failed (${prefix}): ${(e as Error).message}`);
    }
  }

  /** Atomic counter that expires, used for daily order/bill/KOT sequences. */
  async nextSequence(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSeconds);
    return n;
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const client = new Redis({ ...redisOptions(config.get('REDIS_URL')), lazyConnect: false, maxRetriesPerRequest: 3 });
        client.on('error', (e) => new Logger('Redis').error(e.message));
        client.on('ready', () => new Logger('Redis').log('Redis connected'));
        return client;
      },
    },
    CacheService,
  ],
  exports: [REDIS, CacheService],
})
export class RedisModule {}
