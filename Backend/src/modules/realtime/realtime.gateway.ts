import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { AppConfig } from '../../config/app-config.service';
import { AuthUser } from '../../common/decorators';
import { JwtPayload } from '../../common/guards/jwt-auth.guard';
import { AccessService } from '../../common/access/access.service';
import { redisOptions } from '../../infra/redis/redis.module';

export const rooms = {
  branch: (id: string) => `branch:${id}`,
  kitchen: (id: string) => `kitchen:${id}`,
  table: (id: string) => `table:${id}`,
  order: (id: string) => `order:${id}`,
  user: (id: string) => `user:${id}`,
};

const KITCHEN_ROLES = ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER', 'KITCHEN_STAFF', 'CASHIER', 'WAITER'];

/**
 * Socket.IO gateway (default namespace, matches frontend `io(SOCKET_URL, { auth: { token } })`).
 *  - staff connect with a JWT and may join branch / kitchen rooms they have access to
 *  - anonymous customers (QR ordering) may only join table:<id> and order:<id> rooms
 * Horizontal scaling is handled by the Redis adapter.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true }, transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly access: AccessService,
  ) {}

  afterInit(server: Server) {
    const opts = redisOptions(this.config.get('REDIS_URL'));
    const pub = new Redis({ ...opts, maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    pub.on('error', (e) => this.logger.error(`adapter pub: ${e.message}`));
    sub.on('error', (e) => this.logger.error(`adapter sub: ${e.message}`));
    server.adapter(createAdapter(pub, sub));
    this.logger.log('Socket.IO Redis adapter attached');
  }

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token as string | undefined) ?? this.bearer(client.handshake.headers.authorization);
    if (!token) {
      client.data.user = null; // anonymous (customer)
      return;
    }
    try {
      const p = await this.jwt.verifyAsync<JwtPayload>(token, { secret: this.config.get('JWT_ACCESS_SECRET') });
      client.data.user = { id: p.sub, email: p.email, roles: p.roles } satisfies AuthUser;
      client.join(rooms.user(p.sub));
    } catch {
      client.emit('auth:error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  private bearer(h?: string) {
    return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  }

  private async authorizeBranch(client: Socket, branchId: string, kitchen = false): Promise<boolean> {
    const user = client.data.user as AuthUser | null;
    if (!user || !branchId) return false;
    if (kitchen && !user.roles.some((r) => KITCHEN_ROLES.includes(r.role))) return false;
    try {
      return await this.access.canAccessBranch(user, branchId);
    } catch {
      return false;
    }
  }

  @SubscribeMessage('join:branch')
  async joinBranch(@ConnectedSocket() c: Socket, @MessageBody() branchId: string) {
    if (await this.authorizeBranch(c, branchId)) {
      await c.join(rooms.branch(branchId));
      return { ok: true };
    }
    return { ok: false, error: 'forbidden' };
  }

  @SubscribeMessage('leave:branch')
  async leaveBranch(@ConnectedSocket() c: Socket, @MessageBody() branchId: string) {
    await c.leave(rooms.branch(branchId));
    return { ok: true };
  }

  @SubscribeMessage('join:kitchen')
  async joinKitchen(@ConnectedSocket() c: Socket, @MessageBody() branchId: string) {
    if (await this.authorizeBranch(c, branchId, true)) {
      await c.join(rooms.kitchen(branchId));
      return { ok: true };
    }
    return { ok: false, error: 'forbidden' };
  }

  @SubscribeMessage('leave:kitchen')
  async leaveKitchen(@ConnectedSocket() c: Socket, @MessageBody() branchId: string) {
    await c.leave(rooms.kitchen(branchId));
    return { ok: true };
  }

  // Tables & orders are open to anonymous customers (ids are unguessable UUIDs)
  @SubscribeMessage('join:table')
  async joinTable(@ConnectedSocket() c: Socket, @MessageBody() tableId: string) {
    if (typeof tableId === 'string' && tableId.length <= 64) await c.join(rooms.table(tableId));
    return { ok: true };
  }

  @SubscribeMessage('leave:table')
  async leaveTable(@ConnectedSocket() c: Socket, @MessageBody() tableId: string) {
    await c.leave(rooms.table(tableId));
    return { ok: true };
  }

  @SubscribeMessage('join:order')
  async joinOrder(@ConnectedSocket() c: Socket, @MessageBody() orderId: string) {
    if (typeof orderId === 'string' && orderId.length <= 64) await c.join(rooms.order(orderId));
    return { ok: true };
  }

  @SubscribeMessage('leave:order')
  async leaveOrder(@ConnectedSocket() c: Socket, @MessageBody() orderId: string) {
    await c.leave(rooms.order(orderId));
    return { ok: true };
  }

  @SubscribeMessage('ping')
  ping(@ConnectedSocket() c: Socket) {
    c.emit('pong');
  }

  // ───────── emit helpers (used by the realtime consumer) ─────────
  toBranch(branchId: string, event: string, payload: unknown) {
    this.server?.to(rooms.branch(branchId)).emit(event, payload);
  }
  toKitchen(branchId: string, event: string, payload: unknown) {
    this.server?.to(rooms.kitchen(branchId)).emit(event, payload);
  }
  toTable(tableId: string, event: string, payload: unknown) {
    this.server?.to(rooms.table(tableId)).emit(event, payload);
  }
  toOrder(orderId: string, event: string, payload: unknown) {
    this.server?.to(rooms.order(orderId)).emit(event, payload);
  }
  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(rooms.user(userId)).emit(event, payload);
  }
}
