import { AppErrorType } from './app-error';
import { InputValidationError, ResourceNotFoundError, UpstreamServiceError } from './errors';

describe('AppError', () => {
  it('carries its type and message', () => {
    const err = new ResourceNotFoundError('Order');
    expect(err.type).toBe(AppErrorType.ResourceNotFoundError);
    expect(err.message).toContain('Order');
  });

  it('keeps the caller-provided validation message', () => {
    const err = new InputValidationError('Invalid order id: abc');
    expect(err.type).toBe(AppErrorType.InputValidationError);
    expect(err.message).toBe('Invalid order id: abc');
  });

  it('tags upstream failures with their source', () => {
    const err = new UpstreamServiceError('NetSuite', undefined, 'suiteql timeout');
    expect(err.type).toBe(AppErrorType.UpstreamServiceError);
    expect(err.message).toContain('NetSuite');
    expect(err.detail).toBe('suiteql timeout');
  });
});
