import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { AppConfig } from '../../config/app-config.service';

export type IndexName = 'menu' | 'orders' | 'reservations';

const MAPPINGS: Record<IndexName, Record<string, unknown>> = {
  menu: {
    id: { type: 'keyword' },
    branchId: { type: 'keyword' },
    name: { type: 'search_as_you_type' },
    description: { type: 'text' },
    categoryId: { type: 'keyword' },
    categoryName: { type: 'keyword' },
    price: { type: 'float' },
    isVeg: { type: 'boolean' },
    isAvailable: { type: 'boolean' },
    preparationTime: { type: 'integer' },
    updatedAt: { type: 'date' },
  },
  orders: {
    id: { type: 'keyword' },
    branchId: { type: 'keyword' },
    orderNumber: { type: 'text', fields: { raw: { type: 'keyword' } } },
    status: { type: 'keyword' },
    orderType: { type: 'keyword' },
    tableId: { type: 'keyword' },
    tableNumber: { type: 'keyword' },
    waiterName: { type: 'text' },
    customerName: { type: 'text' },
    customerPhone: { type: 'keyword' },
    itemNames: { type: 'text' },
    notes: { type: 'text' },
    total: { type: 'float' },
    createdAt: { type: 'date' },
  },
  reservations: {
    id: { type: 'keyword' },
    branchId: { type: 'keyword' },
    customerName: { type: 'text', fields: { raw: { type: 'keyword' } } },
    customerPhone: { type: 'keyword' },
    customerEmail: { type: 'keyword' },
    status: { type: 'keyword' },
    tableId: { type: 'keyword' },
    partySize: { type: 'integer' },
    reservationDate: { type: 'date' },
    reservationTime: { type: 'keyword' },
    specialRequests: { type: 'text' },
  },
};

/** Thin, failure-tolerant wrapper around the OpenSearch client. */
@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private client?: Client;
  private ready = false;

  constructor(private readonly config: AppConfig) {}

  get enabled() {
    return this.config.get('OPENSEARCH_ENABLED');
  }
  get isReady() {
    return this.enabled && this.ready;
  }

  indexName(name: IndexName) {
    return `${this.config.get('OPENSEARCH_INDEX_PREFIX')}-${name}`;
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('OpenSearch disabled – search falls back to PostgreSQL');
      return;
    }
    const user = this.config.get('OPENSEARCH_USERNAME');
    this.client = new Client({
      node: this.config.get('OPENSEARCH_NODE'),
      auth: user ? { username: user, password: this.config.get('OPENSEARCH_PASSWORD') } : undefined,
      ssl: { rejectUnauthorized: false },
      maxRetries: 2,
      requestTimeout: 8000,
    });
    // Don't block boot on the cluster; keep retrying in the background.
    void this.connectLoop();
  }

  private async connectLoop() {
    for (let attempt = 1; !this.ready; attempt++) {
      try {
        await this.ensureIndices();
        this.ready = true;
        this.logger.log('OpenSearch ready');
      } catch (e) {
        const delay = Math.min(30000, 2000 * attempt);
        if (attempt === 1 || attempt % 5 === 0) {
          this.logger.warn(`OpenSearch not reachable yet (${(e as Error).message}); retrying every ${delay / 1000}s`);
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async ensureIndices() {
    for (const name of Object.keys(MAPPINGS) as IndexName[]) {
      const index = this.indexName(name);
      const exists = await this.client!.indices.exists({ index });
      if (!exists.body) {
        await this.client!.indices.create({
          index,
          body: {
            settings: { number_of_shards: 1, number_of_replicas: 0 },
            mappings: { properties: MAPPINGS[name] },
          },
        });
        this.logger.log(`Created index ${index}`);
      }
    }
  }

  async indexDoc(name: IndexName, id: string, doc: Record<string, unknown>) {
    if (!this.isReady) return;
    await this.client!.index({ index: this.indexName(name), id, body: doc, refresh: false });
  }

  async deleteDoc(name: IndexName, id: string) {
    if (!this.isReady) return;
    await this.client!.delete({ index: this.indexName(name), id }, { ignore: [404] });
  }

  async bulkIndex(name: IndexName, docs: { id: string; doc: Record<string, unknown> }[]) {
    if (!this.isReady || docs.length === 0) return;
    const index = this.indexName(name);
    const body = docs.flatMap((d) => [{ index: { _index: index, _id: d.id } }, d.doc]);
    const res = await this.client!.bulk({ body, refresh: true });
    if (res.body.errors) this.logger.warn(`Bulk index into ${index} had errors`);
  }

  async clear(name: IndexName) {
    if (!this.isReady) return;
    await this.client!.deleteByQuery({
      index: this.indexName(name),
      body: { query: { match_all: {} } },
      refresh: true,
    });
  }

  async search<T = any>(name: IndexName, body: Record<string, unknown>) {
    if (!this.isReady) throw new Error('OpenSearch not ready');
    const res = await this.client!.search({ index: this.indexName(name), body });
    const hits = res.body.hits;
    const total = typeof hits.total === 'number' ? hits.total : (hits.total?.value ?? 0);
    return { total, hits: hits.hits.map((h: any) => ({ ...(h._source as T), _score: h._score })) as (T & { _score: number })[] };
  }

  async count(name: IndexName): Promise<number> {
    if (!this.isReady) return 0;
    const r = await this.client!.count({ index: this.indexName(name) });
    return r.body.count;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const r = await this.client.cluster.health({ timeout: '2s' });
      return r.body.status !== 'red';
    } catch {
      return false;
    }
  }
}
