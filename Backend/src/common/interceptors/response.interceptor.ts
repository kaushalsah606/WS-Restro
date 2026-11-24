import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { decimalsToNumbers, mapKeys, toSnake } from '../utils/case';

export interface Paginated<T> {
  __paginated: true;
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function paginated<T>(items: T[], page: number, limit: number, total: number): Paginated<T> {
  return { __paginated: true, items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

function isPaginated(v: any): v is Paginated<unknown> {
  return v && typeof v === 'object' && v.__paginated === true;
}

/**
 * Wraps every payload as { success, data, meta? } (the frontend unwraps `response.data.data`),
 * converts Decimals to numbers, and optionally emits snake_case keys when the client sends
 * `X-Response-Case: snake` or `?case=snake` (for frontend components that expect snake_case rows).
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const snake = req.headers['x-response-case'] === 'snake' || req.query?.case === 'snake';

    return next.handle().pipe(
      map((payload) => {
        // Let raw/streamed responses through (health, files)
        if (payload && typeof payload === 'object' && (payload as any).__raw) return (payload as any).value;

        let body: Record<string, unknown>;
        if (isPaginated(payload)) {
          body = { success: true, data: decimalsToNumbers(payload.items), meta: payload.meta };
        } else {
          body = { success: true, data: decimalsToNumbers(payload ?? null) };
        }
        return snake ? (mapKeys(body, toSnake) as Record<string, unknown>) : body;
      }),
    );
  }
}
