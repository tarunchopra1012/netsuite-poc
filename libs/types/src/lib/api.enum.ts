/* eslint-disable @typescript-eslint/no-duplicate-enum-values */
export enum AuthApi {
  Login = '/api/auth/login',
  Refresh = '/api/auth/refresh',
  Logout = '/api/auth/logout',
  Me = '/api/auth/me',
}
export enum CrmApi {
  Orders = '/api/crm/orders',
  OrderDetail = '/api/crm/orders/', // + :id
  OrderLines = '/api/crm/orders/', // + :id/lines
  Customer = '/api/crm/customers/', // + :id
  Items = '/api/crm/items',
  ItemDetail = '/api/crm/items/', // + :id
  Programs = '/api/crm/programs',
  Sync = '/api/crm/sync/programs',
  Health = '/api/crm/health',
}
