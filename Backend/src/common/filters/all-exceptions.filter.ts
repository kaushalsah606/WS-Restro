import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as any;
      message = typeof r === 'string' ? r : (r.message ?? exception.message);
      code = typeof r === 'object' ? r.error : undefined;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = `Duplicate value for ${(exception.meta?.target as string[] | undefined)?.join(', ') ?? 'unique field'}`;
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        case 'P2003':
          status = HttpStatus.CONFLICT;
          message = 'Operation violates a relation constraint (record is in use)';
          break;
        default:
          this.logger.error(`Prisma ${exception.code}: ${exception.message}`);
          message = 'Database error';
      }
      code = exception.code;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data supplied';
    } else {
      this.logger.error(`${req.method} ${req.url}`, (exception as Error)?.stack);
    }

    // The frontend reads `error.response.data.message` as a string.
    const text = Array.isArray(message) ? message.join('; ') : message;
    res.status(status).json({
      success: false,
      statusCode: status,
      message: text,
      errors: Array.isArray(message) ? message : undefined,
      code,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
