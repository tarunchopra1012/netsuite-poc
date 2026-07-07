import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { AppError, AppErrorType } from '@nsp/core';

const STATUS_MAP: Record<string, number> = {
  [AppErrorType.UnauthorizedError]: HttpStatus.UNAUTHORIZED,
  [AppErrorType.ForbiddenError]: HttpStatus.FORBIDDEN,
  [AppErrorType.InputValidationError]: HttpStatus.BAD_REQUEST,
  [AppErrorType.DuplicateResourceInputValidationError]: HttpStatus.CONFLICT,
  [AppErrorType.UserNotFoundError]: HttpStatus.NOT_FOUND,
  [AppErrorType.ResourceNotFoundError]: HttpStatus.NOT_FOUND,
  [AppErrorType.FailedToSaveResourceError]: HttpStatus.INTERNAL_SERVER_ERROR,
  [AppErrorType.FailedToGetResourceError]: HttpStatus.INTERNAL_SERVER_ERROR,
  // Upstream (NetSuite) failures → 502, matching the legacy Express handler.
  [AppErrorType.UpstreamServiceError]: HttpStatus.BAD_GATEWAY,
};

/** Translates a thrown AppError (from a controller) into an HTTP response. */
@Catch(AppError)
export class AppErrorFilter implements ExceptionFilter {
  catch(error: AppError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const status = STATUS_MAP[error.type] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    res.status(status).json({
      statusCode: status,
      type: error.type,
      message: error.message,
    });
  }
}
