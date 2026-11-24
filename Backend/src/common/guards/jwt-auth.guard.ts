import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../config/app-config.service';
import { AuthUser, IS_PUBLIC_KEY } from '../decorators';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: AuthUser['roles'];
}

/**
 * Global guard. Routes marked @Public() are open, but if a valid bearer token is
 * present on them it is still decoded so handlers can use the user optionally.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Missing access token');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: this.config.get('JWT_ACCESS_SECRET') });
      req.user = { id: payload.sub, email: payload.email, roles: payload.roles ?? [] } satisfies AuthUser;
      return true;
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
