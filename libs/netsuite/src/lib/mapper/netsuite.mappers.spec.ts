import type { SalesOrderListItem } from '@nsp/types';
import { salesOrderRows, orderLinesByOrderId } from '../mock/netsuite.mock';
import {
  mapDeliveryType,
  mapOrderStatus,
  mapSalesOrderDetail,
  mapSalesOrderListItem,
} from './netsuite.mappers';

describe('mapSalesOrderListItem (mock row -> DTO)', () => {
  it('maps a known mock row into the SalesOrderListItem golden shape', () => {
    const row = salesOrderRows[0]; // SO-100345, id 3091

    const dto = mapSalesOrderListItem(row);

    const expected: SalesOrderListItem = {
      orderId: '3091',
      orderNumber: 'SO-100345',
      customerName: 'Prodigy All Stars',
      opportunityName: 'Prodigy 2026 Team Package',
      memo: 'Spring competition uniforms',
      itemName: 'Pro Series Jersey',
      orderType: 'Team Uniform',
      date: '2026-06-18',
      items: 3,
      delivery: 'Bulk',
      deliveryLabel: 'Bulk Order',
      statusCode: 'B',
      orderStatus: 'Pending Fulfillment',
      shipping: {
        address: 'Prodigy All Stars',
        street: '1200 Innovation Blvd',
        city: 'Austin',
        state: 'TX',
        zip: '78758',
      },
      tracking: null,
      programId: 'A-00001516',
      customerInternalId: '2006',
      entity: '2006',
      total: 4820,
    };

    expect(dto).toEqual(expected);
  });

  it('has exactly the SalesOrderListItem keys (no extra/missing fields)', () => {
    const dto = mapSalesOrderListItem(salesOrderRows[0]);
    expect(Object.keys(dto).sort()).toEqual(
      [
        'customerInternalId',
        'customerName',
        'date',
        'delivery',
        'deliveryLabel',
        'entity',
        'items',
        'itemName',
        'memo',
        'opportunityName',
        'orderId',
        'orderNumber',
        'orderStatus',
        'orderType',
        'programId',
        'shipping',
        'statusCode',
        'total',
        'tracking',
      ].sort(),
    );
  });

  it('takes the first tracking number when several are comma-joined', () => {
    const billed = salesOrderRows[1]; // SO-100346, two tracking numbers
    expect(mapSalesOrderListItem(billed).tracking).toBe('1Z999AA10123456784');
  });
});

describe('delivery + status helpers', () => {
  it('treats an individual (isperson=T) customer as IPP', () => {
    expect(mapDeliveryType('T')).toBe('IPP');
    expect(mapDeliveryType('F')).toBe('Bulk');
  });

  it('resolves the status label from the A-H code map', () => {
    expect(mapOrderStatus('G', undefined)).toBe('Billed');
    expect(mapOrderStatus('H', undefined)).toBe('Closed');
  });

  it('falls back to Pending Fulfillment when the status is unknown', () => {
    expect(mapOrderStatus(undefined, undefined)).toBe('Pending Fulfillment');
  });
});

describe('mapSalesOrderDetail (header + lines)', () => {
  it('nests mapped line items and richer shipping detail', () => {
    const header = salesOrderRows[0];
    const lines = orderLinesByOrderId[3091];

    const detail = mapSalesOrderDetail(header, lines);

    expect(detail.orderId).toBe('3091');
    expect(detail.lineItems).toHaveLength(3);
    expect(detail.items).toBe(3);
    expect(detail.lineItems[0].itemCode).toBe('JER-PRO');
    expect(detail.shippingDetail.shipTo.city).toBe('Austin');
    expect(detail.poNumber).toBe('PO-7781');
  });
});
