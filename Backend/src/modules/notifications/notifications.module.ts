import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { AuthUser, CurrentUser } from '../../common/decorators';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface NewNotification {
  branchId: string;
  userId?: string | null;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
  ) {}

  /** Persist + fan out through Kafka -> Socket.IO (`notification` event). */
  async create(n: NewNotification) {
    const row = await this.prisma.notification.create({
      data: { branchId: n.branchId, userId: n.userId ?? null, type: n.type, title: n.title, message: n.message, data: (n.data ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    await this.bus.publish(EVENT.NOTIFICATION_CREATED, n.branchId, row);
    return row;
  }

  async list(user: AuthUser, q: { branchId?: string; unread?: string; limit?: string }) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    return this.prisma.notification.findMany({
      where: { branchId, OR: [{ userId: null }, { userId: user.id }], ...(q.unread === 'true' ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit) || 50, 200),
    });
  }

  async unreadCount(user: AuthUser, branchId?: string) {
    const id = await this.access.resolveBranchId(user, branchId);
    const count = await this.prisma.notification.count({ where: { branchId: id, readAt: null, OR: [{ userId: null }, { userId: user.id }] } });
    return { count };
  }

  async markRead(user: AuthUser, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || (n.userId && n.userId !== user.id)) throw new NotFoundException('Notification not found');
    await this.access.assertBranchAccess(user, n.branchId);
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(user: AuthUser, branchId?: string) {
    const id = await this.access.resolveBranchId(user, branchId);
    const r = await this.prisma.notification.updateMany({ where: { branchId: id, readAt: null, OR: [{ userId: null }, { userId: user.id }] }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: { branchId?: string; unread?: string; limit?: string }) {
    return this.svc.list(user, q);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string) {
    return this.svc.unreadCount(user, branchId);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string) {
    return this.svc.markAllRead(user, branchId);
  }

  @Patch(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(user, id);
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
