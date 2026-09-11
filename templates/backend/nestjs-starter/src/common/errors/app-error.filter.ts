import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app.error';

@Catch()
export class AppErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      response.status(exception.statusCode).json({
        error: { code: exception.code, message: exception.message },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const detail = exception.getResponse();
      const errorBody = detail as { message?: string | string[] };
      const message =
        typeof detail === 'string'
          ? detail
          : Array.isArray(errorBody.message)
            ? errorBody.message.join(', ')
            : errorBody.message;

      response.status(exception.getStatus()).json({
        error: {
          code: `HTTP_${exception.getStatus()}`,
          message: message ?? exception.message,
        },
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected application error occurred.',
      },
    });
  }
}
