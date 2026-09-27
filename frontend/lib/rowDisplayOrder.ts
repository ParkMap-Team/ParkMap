export type RowDisplayOrder = 'ASCENDING' | 'DESCENDING';
export const ROW_DISPLAY_ORDER_STORAGE_KEY = 'parkmap.rowDisplayOrder';

export function orderRowsForDisplay<T>(canonicalRows: readonly T[], order: RowDisplayOrder): T[] {
  return order === 'DESCENDING' ? [...canonicalRows].reverse() : [...canonicalRows];
}

export function readRowDisplayOrder(storage?: Pick<Storage, 'getItem'> | null): RowDisplayOrder {
  const value = storage?.getItem(ROW_DISPLAY_ORDER_STORAGE_KEY);
  return value === 'DESCENDING' ? 'DESCENDING' : 'ASCENDING';
}

export function persistRowDisplayOrder(order: RowDisplayOrder, storage?: Pick<Storage, 'setItem'> | null): void {
  storage?.setItem(ROW_DISPLAY_ORDER_STORAGE_KEY, order);
}
