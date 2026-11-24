import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env';

/** Typed accessor over the validated environment. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }

  get isProd() {
    return this.get('NODE_ENV') === 'production';
  }
  get role() {
    return this.get('APP_ROLE');
  }
  /** Runs HTTP / Socket.IO */
  get servesHttp() {
    return this.role !== 'worker';
  }
  /** Runs background consumers that do not need sockets (search, audit, workflows) */
  get runsWorkers() {
    return this.role !== 'api';
  }
  /** Runs the consumer that fans events out to Socket.IO */
  get runsRealtime() {
    return this.role !== 'worker';
  }
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  get kafkaBrokers(): string[] {
    return this.get('KAFKA_BROKERS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

@Global()
@Module({
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
