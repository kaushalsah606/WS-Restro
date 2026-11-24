import { Global, Inject, Injectable, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';

/**
 * Human-friendly, per-branch, per-day document numbers (ORD-20260101-0001).
 * Redis INCR gives gap-free atomic sequences; the counter is seeded from the database the first
 * time it is used each day so a Redis flush can never cause duplicate numbers.
 */
@Injectable()
export class SequenceService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private ymd(d = new Date()) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  async next(prefix: string, branchId: string, countToday: () => Promise<number>): Promise<string> {
    const day = this.ymd();
    const key = `seq:${prefix}:${branchId}:${day}`;
    if (!(await this.redis.exists(key))) {
      await this.redis.set(key, await countToday(), 'EX', 172_800, 'NX');
    }
    const n = await this.redis.incr(key);
    return `${prefix}-${day}-${String(n).padStart(4, '0')}`;
  }
}

@Global()
@Module({ providers: [SequenceService], exports: [SequenceService] })
export class SequenceModule {}
