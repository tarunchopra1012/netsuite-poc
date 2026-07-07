import { AuthApi, CrmApi } from './api.enum';

describe('API URL enums (single source of truth)', () => {
  it('auth endpoints live under /api/auth', () => {
    expect(AuthApi.Login).toBe('/api/auth/login');
    expect(AuthApi.Refresh).toBe('/api/auth/refresh');
    expect(AuthApi.Logout).toBe('/api/auth/logout');
    expect(AuthApi.Me).toBe('/api/auth/me');
  });

  it('crm endpoints live under /api/crm', () => {
    expect(CrmApi.Orders).toBe('/api/crm/orders');
    expect(CrmApi.Sync).toBe('/api/crm/sync/programs');
    expect(CrmApi.Health).toBe('/api/crm/health');
  });

  it('detail paths end with a trailing slash ready for an id suffix', () => {
    expect(CrmApi.OrderDetail.endsWith('/')).toBe(true);
    expect(CrmApi.Customer.endsWith('/')).toBe(true);
    expect(CrmApi.ItemDetail.endsWith('/')).toBe(true);
  });
});
