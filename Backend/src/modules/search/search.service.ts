import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { AuthUser } from '../../common/decorators';
import { MENU_ITEM_INCLUDE, ORDER_INCLUDE } from '../../common/includes';
import { OpenSearchService } from '../../infra/search/opensearch.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { menuDoc, orderDoc, reservationDoc } from './search.docs';

export type SearchKind = 'menu' | 'orders' | 'reservations';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly os: OpenSearchService,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  // ───────────────────────── queries ─────────────────────────

  async menu(user: AuthUser | undefined, q: { q: string; branchId?: string; categoryId?: string; isVeg?: boolean; onlyAvailable?: boolean; limit?: number }) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const limit = Math.min(q.limit ?? 20, 100);
    const onlyAvailable = q.onlyAvailable ?? !user;
    if (this.os.isReady) {
      try {
        const filter: any[] = [{ term: { branchId } }];
        if (onlyAvailable) filter.push({ term: { isAvailable: true } });
        if (q.categoryId) filter.push({ term: { categoryId: q.categoryId } });
        if (q.isVeg !== undefined) filter.push({ term: { isVeg: q.isVeg } });
        const res = await this.os.search('menu', {
          size: limit,
          query: {
            bool: {
              filter,
              must: q.q
                ? [
                    {
                      bool: {
                        should: [
                          { multi_match: { query: q.q, type: 'bool_prefix', fields: ['name', 'name._2gram', 'name._3gram'] } },
                          { match: { name: { query: q.q, fuzziness: 'AUTO', boost: 0.8 } } },
                          { match: { description: { query: q.q, fuzziness: 'AUTO', boost: 0.3 } } },
                        ],
                        minimum_should_match: 1,
                      },
                    },
                  ]
                : [{ match_all: {} }],
            },
          },
        });
        return { engine: 'opensearch', total: res.total, results: res.hits };
      } catch (e) {
        this.logger.warn(`OpenSearch menu query failed, using PostgreSQL: ${(e as Error).message}`);
      }
    }
    const where: Prisma.MenuItemWhereInput = {
      branchId,
      ...(onlyAvailable ? { isAvailable: true } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.isVeg !== undefined ? { isVeg: q.isVeg } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.menuItem.findMany({ where, include: MENU_ITEM_INCLUDE, take: limit, orderBy: { name: 'asc' } });
    return { engine: 'postgres', total: rows.length, results: rows };
  }

  async orders(user: AuthUser, q: { q: string; branchId?: string; status?: string; limit?: number }) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const limit = Math.min(q.limit ?? 20, 100);
    if (this.os.isReady) {
      try {
        const filter: any[] = [{ term: { branchId } }];
        if (q.status) filter.push({ terms: { status: q.status.split(',') } });
        const res = await this.os.search('orders', {
          size: limit,
          sort: [{ createdAt: 'desc' }],
          query: {
            bool: {
              filter,
              must: q.q
                ? [
                    {
                      bool: {
                        should: [
                          { multi_match: { query: q.q, fields: ['orderNumber^3', 'customerName^2', 'waiterName', 'itemNames', 'notes'], fuzziness: 'AUTO' } },
                          { wildcard: { 'orderNumber.raw': { value: `*${q.q.toUpperCase()}*` } } },
                          { term: { customerPhone: q.q } },
                          { term: { tableNumber: q.q } },
                        ],
                        minimum_should_match: 1,
                      },
                    },
                  ]
                : [{ match_all: {} }],
            },
          },
        });
        return { engine: 'opensearch', total: res.total, results: res.hits };
      } catch (e) {
        this.logger.warn(`OpenSearch order query failed, using PostgreSQL: ${(e as Error).message}`);
      }
    }
    const rows = await this.prisma.order.findMany({
      where: {
        branchId,
        ...(q.status ? { status: { in: q.status.split(',') as any } } : {}),
        ...(q.q
          ? {
              OR: [
                { orderNumber: { contains: q.q, mode: 'insensitive' } },
                { customerName: { contains: q.q, mode: 'insensitive' } },
                { customerPhone: { contains: q.q } },
                { items: { some: { name: { contains: q.q, mode: 'insensitive' } } } },
                { table: { tableNumber: { contains: q.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { engine: 'postgres', total: rows.length, results: rows };
  }

  async reservations(user: AuthUser, q: { q: string; branchId?: string; limit?: number }) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const limit = Math.min(q.limit ?? 20, 100);
    if (this.os.isReady) {
      try {
        const res = await this.os.search('reservations', {
          size: limit,
          sort: [{ reservationDate: 'desc' }],
          query: {
            bool: {
              filter: [{ term: { branchId } }],
              must: q.q
                ? [{ bool: { should: [{ match: { customerName: { query: q.q, fuzziness: 'AUTO' } } }, { wildcard: { customerPhone: { value: `*${q.q}*` } } }, { term: { customerEmail: q.q.toLowerCase() } }], minimum_should_match: 1 } }]
                : [{ match_all: {} }],
            },
          },
        });
        return { engine: 'opensearch', total: res.total, results: res.hits };
      } catch (e) {
        this.logger.warn(`OpenSearch reservation query failed, using PostgreSQL: ${(e as Error).message}`);
      }
    }
    const rows = await this.prisma.reservation.findMany({
      where: { branchId, ...(q.q ? { OR: [{ customerName: { contains: q.q, mode: 'insensitive' } }, { customerPhone: { contains: q.q } }, { customerEmail: { contains: q.q, mode: 'insensitive' } }] } : {}) },
      orderBy: { reservationDate: 'desc' },
      take: limit,
    });
    return { engine: 'postgres', total: rows.length, results: rows };
  }

  /** One box, all entity types. */
  async global(user: AuthUser, q: { q: string; branchId?: string; limit?: number }) {
    const limit = Math.min(q.limit ?? 5, 20);
    const [menu, orders, reservations] = await Promise.all([
      this.menu(user, { ...q, limit }),
      this.orders(user, { ...q, limit }),
      this.reservations(user, { ...q, limit }),
    ]);
    return { menu: menu.results, orders: orders.results, reservations: reservations.results, engine: menu.engine };
  }

  // ───────────────────────── (re)indexing ─────────────────────────

  async reindex(kind: SearchKind | 'all', branchId?: string) {
    if (!this.os.isReady) return { indexed: 0, skipped: 'OpenSearch not ready' };
    const kinds: SearchKind[] = kind === 'all' ? ['menu', 'orders', 'reservations'] : [kind];
    const counts: Record<string, number> = {};

    for (const k of kinds) {
      let total = 0;
      let cursor: string | undefined;
      for (;;) {
        const batchSize = 500;
        let docs: { id: string; doc: Record<string, unknown> }[] = [];
        let lastId: string | undefined;
        if (k === 'menu') {
          const rows = await this.prisma.menuItem.findMany({ where: branchId ? { branchId } : {}, include: MENU_ITEM_INCLUDE, orderBy: { id: 'asc' }, take: batchSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
          docs = rows.map((r) => ({ id: r.id, doc: menuDoc(r) }));
          lastId = rows.at(-1)?.id;
        } else if (k === 'orders') {
          const rows = await this.prisma.order.findMany({ where: branchId ? { branchId } : {}, include: ORDER_INCLUDE, orderBy: { id: 'asc' }, take: batchSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
          docs = rows.map((r) => ({ id: r.id, doc: orderDoc(r) }));
          lastId = rows.at(-1)?.id;
        } else {
          const rows = await this.prisma.reservation.findMany({ where: branchId ? { branchId } : {}, orderBy: { id: 'asc' }, take: batchSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
          docs = rows.map((r) => ({ id: r.id, doc: reservationDoc(r) }));
          lastId = rows.at(-1)?.id;
        }
        if (!docs.length) break;
        await this.os.bulkIndex(k, docs);
        total += docs.length;
        cursor = lastId;
        if (docs.length < batchSize) break;
      }
      counts[k] = total;
    }
    this.logger.log(`Reindexed ${JSON.stringify(counts)}`);
    return { indexed: counts };
  }
}
