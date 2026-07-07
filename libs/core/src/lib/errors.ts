import { AppError, AppErrorType } from './app-error';

export class InputValidationError extends AppError {
  static override _type = AppErrorType.InputValidationError;
  protected override _message: string;
  constructor(message: string) {
    super();
    this._message = message;
  }
}

export class DuplicateResourceInputValidationError extends AppError {
  static override _type = AppErrorType.DuplicateResourceInputValidationError;
  protected override _message: string;
  constructor(resourceName: string, uniqueFields: string) {
    super();
    this._message = `${resourceName} with the same ${uniqueFields} already exists`;
  }
}

export class UnauthorizedError extends AppError {
  static override _type = AppErrorType.UnauthorizedError;
  protected override _message = 'Unauthorized';
}

export class ResourceNotFoundError extends AppError {
  static override _type = AppErrorType.ResourceNotFoundError;
  protected override _message: string;
  constructor(resource = 'Resource') {
    super();
    this._message = `${resource} is not found`;
  }
}

export class FailedToSaveResourceError extends AppError {
  static override _type = AppErrorType.FailedToSaveResourceError;
  protected override _message = 'Failed to save resource';
  constructor(source = 'External', stack?: string, detail?: string) {
    super();
    this._stack = stack;
    this._detail = detail ?? source;
  }
}

export class FailedToGetResourceError extends AppError {
  static override _type = AppErrorType.FailedToGetResourceError;
  protected override _message = 'Failed to get resource';
  constructor(source = 'External', stack?: string) {
    super();
    this._stack = stack;
    this._detail = source;
  }
}

/**
 * An upstream dependency (NetSuite) failed after retries/fallbacks.
 * Mapped to HTTP 502 Bad Gateway, matching the legacy Express behaviour
 * for upstream errors.
 */
export class UpstreamServiceError extends AppError {
  static override _type = AppErrorType.UpstreamServiceError;
  protected override _message = 'Upstream service error';
  constructor(source = 'NetSuite', stack?: string, detail?: string) {
    super();
    this._message = `Upstream service error (${source})`;
    this._stack = stack;
    this._detail = detail ?? source;
  }
}
