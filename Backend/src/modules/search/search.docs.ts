import { num } from '../../common/utils/money';

/** Convert entity snapshots (DB rows or event payloads) into OpenSearch documents. */
export function menuDoc(i: any) {
  return {
    id: i.id,
    branchId: i.branchId,
    name: i.name,
    description: i.description ?? '',
    categoryId: i.categoryId,
    categoryName: i.category?.name ?? undefined,
    price: num(i.price),
    isVeg: !!i.isVeg,
    isAvailable: !!i.isAvailable,
    preparationTime: i.preparationTime ?? 0,
    updatedAt: i.updatedAt ?? new Date().toISOString(),
  };
}

export function orderDoc(o: any) {
  return {
    id: o.id,
    branchId: o.branchId,
    orderNumber: o.orderNumber,
    status: o.status,
    orderType: o.orderType,
    tableId: o.tableId ?? undefined,
    tableNumber: o.table?.tableNumber ?? undefined,
    waiterName: o.waiter?.fullName ?? undefined,
    customerName: o.customerName ?? undefined,
    customerPhone: o.customerPhone ?? undefined,
    itemNames: (o.items ?? []).map((it: any) => it.name).join(' '),
    notes: o.notes ?? undefined,
    total: num(o.total),
    createdAt: o.createdAt,
  };
}

export function reservationDoc(r: any) {
  return {
    id: r.id,
    branchId: r.branchId,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail ?? undefined,
    status: r.status,
    tableId: r.tableId ?? undefined,
    partySize: r.partySize,
    reservationDate: r.reservationDate,
    reservationTime: r.reservationTime,
    specialRequests: r.specialRequests ?? undefined,
  };
}
