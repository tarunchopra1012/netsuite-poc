'use strict';

// ─────────────────────────────────────────────────────────────
// Raw NetSuite SuiteQL row -> clean DTO.
// Ported from src/netsuite/map-sales-order.util.ts + netsuite-order.types.ts.
// IMPORTANT: mock data flows through these SAME mappers, so live and mock
// responses are byte-for-byte the same shape.
// ─────────────────────────────────────────────────────────────

const { NETSUITE_STATUS_CODE_MAP } = require('./queries');

const DELIVERY = { Bulk: 'Bulk', Ipp: 'IPP' };
const DELIVERY_LABEL = { Bulk: 'Bulk Order', Ipp: 'Individual Order' };
const DEFAULT_ORDER_STATUS = NETSUITE_STATUS_CODE_MAP.B; // Pending Fulfillment
const STATUS_PREFIX = /^sales order\s*:\s*/i;

function trimString(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function normalizeStatusName(statusname) {
  if (typeof statusname !== 'string') return '';
  return statusname.replace(STATUS_PREFIX, '').trim().toLowerCase();
}

function mapNetSuiteStatusCode(status) {
  const code = String(status == null ? '' : status).trim().toUpperCase();
  return code.length > 0 ? code : null;
}

// Resolve label from code map, else fall back to parsing statusname.
function mapNetSuiteStatusLabel(status, statusname) {
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

function mapOrderStatus(status, statusname) {
  return mapNetSuiteStatusLabel(status, statusname) || DEFAULT_ORDER_STATUS;
}

// Explicit Bulk/IPP text wins; otherwise isperson='T' => IPP, else Bulk.
function mapDeliveryType(isperson, deliveryRaw) {
  const raw = String(deliveryRaw == null ? '' : deliveryRaw).trim().toLowerCase();
  if (raw.includes('ipp') || raw.includes('individual')) return DELIVERY.Ipp;
  if (raw.includes('bulk')) return DELIVERY.Bulk;
  return String(isperson == null ? '' : isperson).trim().toUpperCase() === 'T'
    ? DELIVERY.Ipp
    : DELIVERY.Bulk;
}

function mapDeliveryLabel(delivery) {
  return delivery === DELIVERY.Ipp ? DELIVERY_LABEL.Ipp : DELIVERY_LABEL.Bulk;
}

function buildShippingInfo(row) {
  return {
    address: trimString(row.shipaddressee) || trimString(row.companyname) || null,
    street: trimString(row.shipstreet) || trimString(row.shipaddr1) || null,
    city: trimString(row.shipcity),
    state: trimString(row.shipstate),
    zip: trimString(row.shipzip),
  };
}

function parseTrackingNumber(tracking) {
  if (tracking == null) return null;
  const value = String(tracking).trim();
  if (!value || value === '-') return null;
  const first = (value.split(',')[0] || '').trim();
  return first || null;
}

function parseItemCount(itemcount) {
  if (typeof itemcount === 'number' && Number.isFinite(itemcount)) {
    return Math.max(0, Math.floor(itemcount));
  }
  const parsed = Number.parseInt(String(itemcount == null ? '0' : itemcount), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseTotal(foreigntotal) {
  if (foreigntotal == null || foreigntotal === '') return null;
  const parsed = Number.parseFloat(String(foreigntotal));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseQuantity(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const parsed = Number.parseFloat(String(value == null ? '0' : value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

// Opportunity field; fallback to Style + Additional Description from the Custom tab.
function mapOpportunityName(row) {
  const opportunity = trimString(row.opportunityname);
  if (opportunity) return opportunity;
  const style = trimString(row.styledescription);
  const additional = trimString(row.additionaldescription);
  if (style && additional) return `${style} ${additional}`;
  return style || additional || null;
}

function mapCustomerName(row) {
  return trimString(row.customername) || trimString(row.companyname) || null;
}

function mapProgramId(row) {
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

function mapItemName(row) {
  return (
    trimString(row.itemname) ||
    trimString(row.firstitemname) ||
    trimString(row.firstitemdisplayname) ||
    null
  );
}

function mapSalesOrderListItem(row) {
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

function buildShipTo(row) {
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

function buildShippingDetail(row) {
  const shipTo = buildShipTo(row);
  return {
    shipDateActual: trimString(row.actualshipdate) || trimString(row.shipdate) || null,
    carrier: trimString(row.shippingcarrier) || trimString(row.carrier) || null,
    method: trimString(row.shippingmethod) || trimString(row.shipmethod) || null,
    shipComplete: String(row.shipcomplete == null ? '' : row.shipcomplete).trim().toUpperCase() === 'T',
    shipTo,
  };
}

function mapSalesOrderLineItem(row) {
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

function mapSalesOrderDetail(header, lines) {
  const listFields = mapSalesOrderListItem(header);
  const shippingDetail = buildShippingDetail(header);
  const lineItems = (lines || []).map(mapSalesOrderLineItem);
  const primaryItemName =
    (lineItems.find((l) => l.itemName) || {}).itemName || listFields.itemName;

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

module.exports = {
  mapSalesOrderListItem,
  mapSalesOrderLineItem,
  mapSalesOrderDetail,
  mapOrderStatus,
  mapNetSuiteStatusCode,
  mapNetSuiteStatusLabel,
  mapDeliveryType,
  mapDeliveryLabel,
};
