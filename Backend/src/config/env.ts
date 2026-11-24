import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  API_PREFIX: z.string().default('api/v1'),
  APP_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  CORS_ORIGINS: z.string().default('http://localhost:8080,http://localhost:3000'),
  ALLOW_PUBLIC_REGISTRATION: bool(true),
  // exposes GET /auth/demo-accounts so the login page can offer one-click demo sign-in (never enable in production)
  DEMO_MODE: bool(false),
  FRONTEND_URL: z.string().default('http://localhost:8080'),
  THROTTLE_LIMIT: z.coerce.number().default(600),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  KAFKA_ENABLED: bool(true),
  KAFKA_BROKERS: z.string().default('localhost:29092'),
  KAFKA_CLIENT_ID: z.string().default('ws-pos'),
  KAFKA_TOPIC_PREFIX: z.string().default('pos'),

  OPENSEARCH_ENABLED: bool(true),
  OPENSEARCH_NODE: z.string().default('http://localhost:9200'),
  OPENSEARCH_USERNAME: z.string().optional().default(''),
  OPENSEARCH_PASSWORD: z.string().optional().default(''),
  OPENSEARCH_INDEX_PREFIX: z.string().default('pos'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(7),
  BCRYPT_ROUNDS: z.coerce.number().default(10),

  // seed credentials (also echoed by /auth/demo-accounts when DEMO_MODE=true)
  SEED_ADMIN_EMAIL: z.string().default('admin@harmonyhub.com'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@12345'),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
