import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { mapKeys, toCamel } from '../utils/case';

/**
 * Accept both snake_case and camelCase request bodies/queries (the frontend currently
 * mixes the two). Everything is normalised to camelCase before validation.
 */
@Injectable()
export class CamelCaseBodyMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (req.body && typeof req.body === 'object') req.body = mapKeys(req.body, toCamel);
    if (req.query && typeof req.query === 'object') {
      const q = mapKeys({ ...req.query }, toCamel) as Record<string, unknown>;
      // express 5 exposes req.query as a getter; define over it
      Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true, enumerable: true });
    }
    next();
  }
}
