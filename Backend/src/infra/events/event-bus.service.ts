import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Consumer, Kafka, KafkaMessage, logLevel, Partitioners, Producer } from 'kafkajs';
import { AppConfig } from '../../config/app-config.service';
import { DomainEvent, EventType, TOPIC_SUFFIXES, topicSuffixFor } from './event-types';

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

interface Subscription {
  group: string;
  handler: EventHandler;
}

/**
 * Event streaming / message broker facade.
 *
 *  - KAFKA_ENABLED=true  : events go through Apache Kafka. Each consumer *group* receives every
 *                          event once (scaled horizontally by partitions). Failures are retried and
 *                          then parked in `<prefix>.dlq`.
 *  - KAFKA_ENABLED=false : events are dispatched in-process so the stack runs without a broker.
 */
@Injectable()
export class EventBus implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EventBus.name);
  private readonly subs: Subscription[] = [];
  private kafka?: Kafka;
  private producer?: Producer;
  private consumers: Consumer[] = [];
  private started = false;
  private readonly startedGroups = new Set<string>();

  constructor(private readonly config: AppConfig) {}

  get kafkaEnabled() {
    return this.config.get('KAFKA_ENABLED');
  }

  /** true once the Kafka producer is connected */
  get connected() {
    return !!this.producer;
  }

  private topic(suffix: string) {
    return `${this.config.get('KAFKA_TOPIC_PREFIX')}.${suffix}`;
  }
  private get allTopics() {
    return [...TOPIC_SUFFIXES, 'misc'].map((s) => this.topic(s));
  }
  private get dlqTopic() {
    return `${this.config.get('KAFKA_TOPIC_PREFIX')}.dlq`;
  }

  /** Register a handler for a named consumer group. Call before the app finishes bootstrapping. */
  subscribe(group: string, handler: EventHandler) {
    this.subs.push({ group, handler });
    if (this.started && this.kafkaEnabled) {
      this.startGroup(group).catch((e) => this.logger.error(`late subscribe ${group}: ${e.message}`));
    }
  }

  async onModuleInit() {
    if (!this.kafkaEnabled) {
      this.logger.warn('Kafka disabled – using in-process event dispatch');
      this.started = true;
      return;
    }
    this.kafka = new Kafka({
      clientId: this.config.get('KAFKA_CLIENT_ID'),
      brokers: this.config.kafkaBrokers,
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 10 },
    });

    try {
      await this.ensureTopics();
      this.producer = this.kafka.producer({ allowAutoTopicCreation: false, idempotent: true, maxInFlightRequests: 1, createPartitioner: Partitioners.DefaultPartitioner });
      await this.producer.connect();
      this.logger.log(`Kafka producer connected (${this.config.kafkaBrokers.join(',')})`);
      this.started = true;
      // Consumers start in the background so a slow rebalance never blocks HTTP boot.
      const groups = [...new Set(this.subs.map((s) => s.group))];
      for (const g of groups) this.startGroup(g).catch((e) => this.logger.error(`consumer ${g}: ${e.message}`));
    } catch (e) {
      // Do not take the whole API down if the broker is temporarily unavailable at boot;
      // fall back to in-process dispatch so core POS flows keep working.
      this.logger.error(`Kafka unavailable (${(e as Error).message}); falling back to in-process dispatch`);
      this.producer = undefined;
      this.kafka = undefined;
      this.started = true;
    }
  }

  private async ensureTopics() {
    const admin = this.kafka!.admin();
    await admin.connect();
    try {
      const existing = new Set(await admin.listTopics());
      const wanted = [...this.allTopics, this.dlqTopic].filter((t) => !existing.has(t));
      if (wanted.length) {
        await admin.createTopics({
          waitForLeaders: true,
          topics: wanted.map((topic) => ({ topic, numPartitions: 3, replicationFactor: 1 })),
        });
        this.logger.log(`Created Kafka topics: ${wanted.join(', ')}`);
      }
    } finally {
      await admin.disconnect();
    }
  }

  private async startGroup(group: string) {
    if (!this.kafka || this.startedGroups.has(group)) return;
    this.startedGroups.add(group);
    const consumer = this.kafka.consumer({
      groupId: `${this.config.get('KAFKA_CLIENT_ID')}-${group}`,
      sessionTimeout: 30000,
      allowAutoTopicCreation: false,
    });
    await consumer.connect();
    await consumer.subscribe({ topics: this.allTopics, fromBeginning: false });
    this.consumers.push(consumer);

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        const event = this.decode(message);
        if (!event) return;
        for (const sub of this.subs.filter((s) => s.group === group)) {
          await this.runWithRetry(sub, event, topic);
        }
      },
    });
    this.logger.log(`Kafka consumer group "${group}" running`);
  }

  private decode(message: KafkaMessage): DomainEvent | null {
    try {
      return message.value ? (JSON.parse(message.value.toString()) as DomainEvent) : null;
    } catch {
      this.logger.warn('Dropped undecodable Kafka message');
      return null;
    }
  }

  private async runWithRetry(sub: Subscription, event: DomainEvent, topic: string) {
    const attempts = 3;
    for (let i = 1; i <= attempts; i++) {
      try {
        await sub.handler(event);
        return;
      } catch (e) {
        this.logger.warn(`[${sub.group}] ${event.type} failed (attempt ${i}/${attempts}): ${(e as Error).message}`);
        if (i < attempts) await new Promise((r) => setTimeout(r, 200 * i));
      }
    }
    await this.producer
      ?.send({
        topic: this.dlqTopic,
        messages: [{ key: event.branchId ?? undefined, value: JSON.stringify({ group: sub.group, topic, event }) }],
      })
      .catch(() => undefined);
  }

  /**
   * Publish a domain event. Never throws: failing to emit an event must not fail the
   * business operation that has already been committed to PostgreSQL.
   */
  async publish<T>(type: EventType, branchId: string | null, data: T, actorId?: string | null): Promise<void> {
    const event: DomainEvent<T> = {
      id: randomUUID(),
      type,
      branchId,
      occurredAt: new Date().toISOString(),
      actorId: actorId ?? null,
      data,
    };

    if (this.producer) {
      try {
        await this.producer.send({
          topic: this.topic(topicSuffixFor(type)),
          messages: [{ key: branchId ?? event.id, value: JSON.stringify(event), headers: { type } }],
        });
        return;
      } catch (e) {
        this.logger.error(`Kafka publish failed for ${type}: ${(e as Error).message}; dispatching locally`);
      }
    }
    this.dispatchLocal(event);
  }

  private dispatchLocal(event: DomainEvent) {
    // One delivery per group, same as Kafka semantics.
    const groups = new Map<string, EventHandler[]>();
    for (const s of this.subs) groups.set(s.group, [...(groups.get(s.group) ?? []), s.handler]);
    setImmediate(() => {
      for (const handlers of groups.values()) {
        for (const h of handlers) {
          Promise.resolve()
            .then(() => h(event))
            .catch((e) => this.logger.warn(`local handler failed for ${event.type}: ${e.message}`));
        }
      }
    });
  }

  async onApplicationShutdown() {
    await Promise.allSettled(this.consumers.map((c) => c.disconnect()));
    await this.producer?.disconnect().catch(() => undefined);
  }
}
