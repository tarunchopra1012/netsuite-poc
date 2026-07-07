import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ResourceNotFoundError, UnauthorizedError, UpstreamServiceError } from '@nsp/core';
import { AppErrorFilter } from './app-error.filter';

function mockHost() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AppErrorFilter', () => {
  const filter = new AppErrorFilter();

  it('maps ResourceNotFoundError to 404', () => {
    const { host, res } = mockHost();
    filter.catch(new ResourceNotFoundError('Order'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: HttpStatus.NOT_FOUND }),
    );
  });

  it('maps UnauthorizedError to 401', () => {
    const { host, res } = mockHost();
    filter.catch(new UnauthorizedError(), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
  });

  it('maps UpstreamServiceError to 502 (legacy Express parity)', () => {
    const { host, res } = mockHost();
    filter.catch(new UpstreamServiceError('NetSuite'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
  });
});
