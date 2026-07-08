// ─────────────────────────────────────────────────────────────
// Raw NetSuite SuiteQL row -> clean DTO.
// 1:1 TypeScript port of src/mappers.js, with returns typed by @nsp/types.
// IMPORTANT: mock data flows through these SAME mappers, so live and mock
// responses are byte-for-byte the same shape.
// ─────────────────────────────────────────────────────────────

import type {
  SalesOrderDetail,
  SalesOrderLineItem,
  SalesOrderListItem,
  ShippingDetail,
  ShippingInfo,
  ShipTo,
} from '@nsp/types';
import { NETSUITE_STATUS_CODE_MAP } from '../query/netsuite.queries';

/** Raw sales-order header row (columns mirror buildSalesOrdersQuery SELECT). */
export interface RawSalesOrderRow {
  id?: unknown;
  tranid?: unknown;
  status?: unknown;
  statusname?: unknown;
  trandate?: unknown;
  createddate?: unknown;
  lastmodifieddate?: unknown;
  entity?: unknown;
  customername?: unknown;
  companyname?: unknown;
  email?: unknown;
  phone?: unknown;
  entityid?: unknown;
  isperson?: unknown;
  deliverytype?: unknown;
  programid?: unknown;
  memo?: unknown;
  otherrefnum?: unknown;
  foreigntotal?: unknown;
  opportunityname?: unknown;
  ordertype?: unknown;
  styledescription?: unknown;
  additionaldescription?: unknown;
  itemcount?: unknown;
  itemname?: unknown;
  firstitemname?: unknown;
  firstitemdisplayname?: unknown;
  trackingnumber?: unknown;
  shipaddressee?: unknown;
  shipstreet?: unknown;
  shipaddr1?: unknown;
  shipcity?: unknown;
  shipstate?: unknown;
  shipzip?: unknown;
  shippingmethod?: unknown;
  shippingcarrier?: unknown;
  carrier?: unknown;
  shipmethod?: unknown;
  actualshipdate?: unknown;
  shipdate?: unknown;
  shipcomplete?: unknown;
}

/** Raw line-item row (columns mirror buildOrderLineItemsQuery SELECT). */
export interface RawOrderLineRow {
  id?: unknown;
  transaction?: unknown;
  item?: unknown;
  itemcode?: unknown;
  itemname?: unknown;
  itemdisplayname?: unknown;
  quantity?: unknown;
  quantitypicked?: unknown;
  picked?: unknown;
  quantitypacked?: unknown;
  packed?: unknown;
  quantityfulfilled?: unknown;
  fulfilled?: unknown;
  quantitybilled?: unknown;
  invoiced?: unknown;
  unitprice?: unknown;
  linetotal?: unknown;
  linestatus?: unknown;
  taxline?: unknown;
  mainline?: unknown;
}

const DELIVERY = { Bulk: 'Bulk', Ipp: 'IPP' } as const;
const DELIVERY_LABEL = { Bulk: 'Bulk Order', Ipp: 'Individual Order' } as const;
const DEFAULT_ORDER_STATUS = NETSUITE_STATUS_CODE_MAP['B']; // Pending Fulfillment
const STATUS_PREFIX = /^sales order\s*:\s*/i;

function trimString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function normalizeStatusName(statusname: unknown): string {
  if (typeof statusname !== 'string') return '';
  return statusname.replace(STATUS_PREFIX, '').trim().toLowerCase();
}

export function mapNetSuiteStatusCode(status: unknown): string | null {
  const code = String(status == null ? '' : status)
    .trim()
    .toUpperCase();
  return code.length > 0 ? code : null;
}

// Resolve label from code map, else fall back to parsing statusname.
export function mapNetSuiteStatusLabel(status: unknown, statusname: unknown): string | null {
  const code = mapNetSuiteStatusCode(status);
  if (code && NETSUITE_STATUS_CODE_MAP[code]) {
    return NETSUITE_STATUS_CODE_MAP[code];
  }
  const normalized = normalizeStatusName(statusname);
  if (!normalized) return null;
  const fromMap = Object.values(NETSUITE_STATUS_CODE_MAP).find(
    (label) => label.toLowerCase() === normalized,
  );
  if (fromMap) return fromMap;
  if (typeof statusname === 'string') {
    return statusname.replace(STATUS_PREFIX, '').trim() || null;
  }
  return null;
}

export function mapOrderStatus(status: unknown, statusname: unknown): string {
  return mapNetSuiteStatusLabel(status, statusname) || DEFAULT_ORDER_STATUS;
}

// Explicit Bulk/IPP text wins; otherwise isperson='T' => IPP, else Bulk.
export function mapDeliveryType(isperson: unknown, deliveryRaw?: unknown): 'Bulk' | 'IPP' {
  const raw = String(deliveryRaw == null ? '' : deliveryRaw)
    .trim()
    .toLowerCase();
  if (raw.includes('ipp') || raw.includes('individual')) return DELIVERY.Ipp;
  if (raw.includes('bulk')) return DELIVERY.Bulk;
  return String(isperson == null ? '' : isperson)
    .trim()
    .toUpperCase() === 'T'
    ? DELIVERY.Ipp
    : DELIVERY.Bulk;
}

export function mapDeliveryLabel(delivery: 'Bulk' | 'IPP'): string {
  return delivery === DELIVERY.Ipp ? DELIVERY_LABEL.Ipp : DELIVERY_LABEL.Bulk;
}

function buildShippingInfo(row: RawSalesOrderRow): ShippingInfo {
  return {
    address: trimString(row.shipaddressee) || trimString(row.companyname) || null,
    street: trimString(row.shipstreet) || trimString(row.shipaddr1) || null,
    city: trimString(row.shipcity),
    state: trimString(row.shipstate),
    zip: trimString(row.shipzip),
  };
}

function parseTrackingNumber(tracking: unknown): string | null {
  if (tracking == null) return null;
  const value = String(tracking).trim();
  if (!value || value === '-') return null;
  const first = (value.split(',')[0] || '').trim();
  return first || null;
}

function parseItemCount(itemcount: unknown): number {
  if (typeof itemcount === 'number' && Number.isFinite(itemcount)) {
    return Math.max(0, Math.floor(itemcount));
  }
  const parsed = Number.parseInt(String(itemcount == null ? '0' : itemcount), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseTotal(foreigntotal: unknown): number | null {
  if (foreigntotal == null || foreigntotal === '') return null;
  const parsed = Number.parseFloat(String(foreigntotal));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseQuantity(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const parsed = Number.parseFloat(String(value == null ? '0' : value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

// Opportunity field; fallback to Style + Additional Description from the Custom tab.
function mapOpportunityName(row: RawSalesOrderRow): string | null {
  const opportunity = trimString(row.opportunityname);
  if (opportunity) return opportunity;
  const style = trimString(row.styledescription);
  const additional = trimString(row.additionaldescription);
  if (style && additional) return `${style} ${additional}`;
  return style || additional || null;
}

function mapCustomerName(row: RawSalesOrderRow): string | null {
  return trimString(row.customername) || trimString(row.companyname) || null;
}

function mapProgramId(row: RawSalesOrderRow): string | null {
  const entityid = trimString(row.entityid);
  const legacySfc = trimString(row.programid);
  const customerName = trimString(row.customername);

  if (entityid) return entityid;
  if (legacySfc) return legacySfc;
  if (customerName) {
    const sf = customerName.match(/^([A]-\d{5,})\s/i);
    if (sf) return sf[1];
    const leading = customerName.match(/^(\d+)\s/);
    if (leading) return leading[1];
  }
  return row.entity != null ? String(row.entity) : null;
}

function mapItemName(row: RawSalesOrderRow): string | null {
  return (
    trimString(row.itemname) ||
    trimString(row.firstitemname) ||
    trimString(row.firstitemdisplayname) ||
    null
  );
}

export function mapSalesOrderListItem(row: RawSalesOrderRow): SalesOrderListItem {
  const delivery = mapDeliveryType(row.isperson, row.deliverytype);
  const tracking = parseTrackingNumber(row.trackingnumber);
  const orderId = String(row.id == null ? '' : row.id);
  const customerInternalId = row.entity != null ? String(row.entity) : null;

  return {
    orderId,
    orderNumber: String(row.tranid == null ? '' : row.tranid),
    customerName: mapCustomerName(row),
    opportunityName: mapOpportunityName(row),
    memo: trimString(row.memo),
    itemName: mapItemName(row),
    orderType: trimString(row.ordertype),
    date: (typeof row.trandate === 'string' && row.trandate) || null,
    items: parseItemCount(row.itemcount),
    delivery,
    deliveryLabel: mapDeliveryLabel(delivery),
    statusCode: mapNetSuiteStatusCode(row.status),
    orderStatus: mapOrderStatus(row.status, row.statusname),
    shipping: buildShippingInfo(row),
    tracking,
    programId: mapProgramId(row),
    customerInternalId,
    entity: customerInternalId,
    total: parseTotal(row.foreigntotal),
  };
}

function buildShipTo(row: RawSalesOrderRow): ShipTo {
  const addressee = trimString(row.shipaddressee) || trimString(row.companyname);
  const street = trimString(row.shipstreet) || trimString(row.shipaddr1);
  const city = trimString(row.shipcity);
  const state = trimString(row.shipstate);
  const zip = trimString(row.shipzip);

  const cityStateZip = [city, state, zip].filter(Boolean).join(' ');
  const displayParts = [addressee, street, cityStateZip].filter(Boolean);
  const display = displayParts.length > 0 ? displayParts.join(', ') : null;

  return { addressee, street, city, state, zip, display };
}

function buildShippingDetail(row: RawSalesOrderRow): ShippingDetail {
  const shipTo = buildShipTo(row);
  return {
    shipDateActual: trimString(row.actualshipdate) || trimString(row.shipdate) || null,
    carrier: trimString(row.shippingcarrier) || trimString(row.carrier) || null,
    method: trimString(row.shippingmethod) || trimString(row.shipmethod) || null,
    shipComplete:
      String(row.shipcomplete == null ? '' : row.shipcomplete)
        .trim()
        .toUpperCase() === 'T',
    shipTo,
  };
}

export function mapSalesOrderLineItem(row: RawOrderLineRow): SalesOrderLineItem {
  return {
    id: String(row.id == null ? '' : row.id),
    itemId: row.item != null ? String(row.item) : null,
    itemCode: trimString(row.itemcode),
    itemName: trimString(row.itemname) || trimString(row.itemdisplayname) || null,
    quantity: parseQuantity(row.quantity),
    picked: parseQuantity(row.quantitypicked != null ? row.quantitypicked : row.picked),
    packed: parseQuantity(row.quantitypacked != null ? row.quantitypacked : row.packed),
    fulfilled: parseQuantity(row.quantityfulfilled != null ? row.quantityfulfilled : row.fulfilled),
    invoiced: parseQuantity(row.quantitybilled != null ? row.quantitybilled : row.invoiced),
    unitPrice: parseTotal(row.unitprice),
    lineTotal: parseTotal(row.linetotal),
  };
}

export function mapSalesOrderDetail(
  header: RawSalesOrderRow,
  lines: RawOrderLineRow[] | null | undefined,
): SalesOrderDetail {
  const listFields = mapSalesOrderListItem(header);
  const shippingDetail = buildShippingDetail(header);
  const lineItems = (lines || []).map(mapSalesOrderLineItem);
  const primaryItemName = lineItems.find((l) => l.itemName)?.itemName || listFields.itemName;

  return {
    ...listFields,
    itemName: primaryItemName,
    items: lineItems.length || listFields.items,
    shipping: buildShippingInfo(header),
    poNumber: trimString(header.otherrefnum),
    styleDescription: trimString(header.styledescription),
    additionalDescription: trimString(header.additionaldescription),
    createdDate: trimString(header.createddate),
    lastModifiedDate: trimString(header.lastmodifieddate),
    shippingDetail,
    lineItems,
  };
}
