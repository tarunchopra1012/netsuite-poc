export enum AppErrorType {
  UnknownError = 'UnknownError',
  UnauthorizedError = 'UnauthorizedError',
  ForbiddenError = 'ForbiddenError',
  InputValidationError = 'InputValidationError',
  DuplicateResourceInputValidationError = 'DuplicateResourceInputValidationError',
  UserNotFoundError = 'UserNotFoundError',
  ResourceNotFoundError = 'ResourceNotFoundError',
  FailedToSaveResourceError = 'FailedToSaveResourceError',
  FailedToGetResourceError = 'FailedToGetResourceError',
  // Upstream (NetSuite) failures — mapped to 502 by nest-kernel's AppErrorFilter.
  UpstreamServiceError = 'UpstreamServiceError',
}

/**
 * Base class every domain error extends. Errors are RETURNED, never thrown,
 * across UseCase / Service / Repository layers. Only the Controller throws
 * (the AppErrorFilter in nest-kernel maps it to an HTTP response).
 */
export abstract class AppError {
  static _type: AppErrorType = AppErrorType.UnknownError;
  protected _message = 'Something went wrong';
  protected _stack?: string;
  protected _detail?: string;

  get type(): AppErrorType {
    return (this.constructor as typeof AppError)._type;
  }
  get message() {
    return this._message;
  }
  get stack() {
    return this._stack;
  }
  get detail() {
    return this._detail;
  }
}
