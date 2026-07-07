export interface ShippingInfo {
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface SalesOrderListItem {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  opportunityName: string | null;
  memo: string | null;
  itemName: string | null;
  orderType: string | null;
  date: string | null;
  items: number;
  delivery: 'Bulk' | 'IPP';
  deliveryLabel: string;
  statusCode: string | null;
  orderStatus: string;
  shipping: ShippingInfo;
  tracking: string | null; // note: `tracking`, not `trackingNumber`
  programId: string | null;
  customerInternalId: string | null;
  entity: string | null; // legacy alias of customerInternalId, kept for parity
  total: number | null;
}

export interface SalesOrderLineItem {
  id: string;
  itemId: string | null;
  itemCode: string | null;
  itemName: string | null;
  quantity: number;
  picked: number;
  packed: number;
  fulfilled: number;
  invoiced: number;
  unitPrice: number | null;
  lineTotal: number | null;
}

// buildShipTo() in src/mappers.js
export interface ShipTo {
  addressee: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  display: string | null;
}

// buildShippingDetail() in src/mappers.js — richer than ShippingInfo
export interface ShippingDetail {
  shipDateActual: string | null;
  carrier: string | null;
  method: string | null;
  shipComplete: boolean;
  shipTo: ShipTo;
}

export interface SalesOrderDetail extends SalesOrderListItem {
  poNumber: string | null;
  styleDescription: string | null;
  additionalDescription: string | null;
  createdDate: string | null;
  lastModifiedDate: string | null;
  shippingDetail: ShippingDetail;
  lineItems: SalesOrderLineItem[];
}

// Customers and items have NO mapper today — the routes return the raw
// SuiteQL/mock row as-is, so the fields keep NetSuite's lowercase column names.
// (See src/routes/customers.js / src/routes/items.js and mock.customersById.)
export interface Customer {
  id: number | string;
  entityid: string | null;
  companyname: string | null;
  email: string | null;
  phone: string | null;
  defaultbillingaddresstext: string | null;
  defaultshippingaddresstext: string | null;
  datecreated: string | null;
  lastmodifieddate: string | null;
}

export interface Item {
  id: number | string;
  itemid: string | null;
  displayname: string | null;
  itemtype: string | null;
  baseprice: string | null;
  isinactive: 'T' | 'F' | null;
}

export interface ProgramRow {
  id: string;
  netsuiteId: string | null;
  salesforceId: string | null;
  name: string;
  ownerId: string | null;
  ownerEmail: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  phone: string | null;
  type: string | null;
  subType: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedOrders {
  count: number;
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  hasMore: boolean;
  items: SalesOrderListItem[];
}

// GET /netsuite/orders/:id/lines and GET /netsuite/items envelopes
export interface OrderLinesResponse {
  count: number;
  items: SalesOrderLineItem[];
}

export interface ItemsResponse {
  count: number;
  total: number;
  items: Item[];
}
