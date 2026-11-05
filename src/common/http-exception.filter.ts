import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthedRequest } from './auth';
import { AppException } from './errors';

interface PgError {
  code?: string;
}

/**
 * One error envelope for everything, and nothing internal in it: no stack traces, no SQL, no constraint names.
 * Database errors that mean "the client did something wrong" are translated; everything else is a 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<AuthedRequest>();
    const response = http.getResponse<Response>();

    const { status, code, message, details } = this.describe(exception);
    if (status === 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} (${request.id})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (status === 429 && typeof details?.retryAfterSeconds === 'number')
      response.setHeader('Retry-After', String(details.retryAfterSeconds));
    response
      .status(status)
      .json({ error: { code, message, requestId: request.id, ...(details ? { details } : {}) } });
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const names: Record<number, string> = {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        413: 'PAYLOAD_TOO_LARGE',
      };
      return {
        status,
        code: names[status] ?? 'HTTP_ERROR',
        message: status === 404 ? 'Route not found' : exception.message,
      };
    }
    // Errors raised by the body parser before any route runs (too large, not JSON) carry an HTTP status of their own.
    const parser = exception as { status?: unknown; type?: unknown } | null;
    if (typeof parser?.status === 'number' && parser.status >= 400 && parser.status < 500) {
      return parser.status === 413
        ? { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large' }
        : { status: 400, code: 'BAD_REQUEST', message: 'The request body could not be read' };
    }
    switch ((exception as PgError | null)?.code) {
      case '23505':
        return { status: 409, code: 'ALREADY_EXISTS', message: 'A conflicting record already exists' };
      case '23503':
        return {
          status: 409,
          code: 'REFERENCE_VIOLATION',
          message: 'A referenced record does not exist in this fleet',
        };
      case '23514':
        return { status: 422, code: 'CONSTRAINT_VIOLATION', message: 'The request violates a data rule' };
      case '22P02':
        return { status: 400, code: 'INVALID_INPUT', message: 'Malformed input value' };
      case '42501':
        return { status: 403, code: 'FORBIDDEN', message: 'You are not allowed to do this' };
      default:
        return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
    }
  }
}
