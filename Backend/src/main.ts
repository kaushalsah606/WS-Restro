import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';

/** Socket.IO adapter that applies the same CORS allow-list as the REST API. */
class CorsIoAdapter extends IoAdapter {
  constructor(app: NestExpressApplication, private readonly origins: string[]) {
    super(app);
  }
  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: { origin: this.origins, credentials: true } });
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Worker role: Kafka consumers + BullMQ processors only, no HTTP listener.
  if ((process.env.APP_ROLE ?? 'all') === 'worker') {
    const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
    ctx.enableShutdownHooks();
    logger.log('Worker started (consumers + queue processors)');
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  const config = app.get(AppConfig);
  const prefix = config.get('API_PREFIX');

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  app.enableCors({ origin: config.corsOrigins, credentials: true, exposedHeaders: ['X-Response-Case'] });
  app.setGlobalPrefix(prefix, { exclude: ['health', 'health/live'] });
  app.useWebSocketAdapter(new CorsIoAdapter(app, config.corsOrigins));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.enableShutdownHooks();

  if (!config.isProd || process.env.ENABLE_SWAGGER === 'true') {
    const doc = new DocumentBuilder()
      .setTitle('Harmony Hub POS API')
      .setDescription('Restaurant POS backend: orders, KOT, billing, tables, inventory, reservations, printing, reports, search.\n\nSocket.IO runs on the same origin (see README for events).')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc), { swaggerOptions: { persistAuthorization: true } });
  }

  await app.listen(config.get('PORT'), '0.0.0.0');
  logger.log(`API listening on :${config.get('PORT')}/${prefix}  (role=${config.role}, docs at /docs)`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error', e);
  process.exit(1);
});
