import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    // Log all exceptions so that unexpected 500 errors can be diagnosed in production.
    // eslint-disable-next-line no-console
    console.error('[HttpExceptionFilter] exception:', exception);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Internal server error';
    let error: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = resObj.message ?? resObj;
        if (typeof resObj.error === 'string') {
          error = resObj.error;
        }
      } else {
        message = res;
      }
    }

    const body: Record<string, unknown> = {
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    };

    if (error) {
      body.error = error;
    }

    response.status(status).json(body);
  }
}
