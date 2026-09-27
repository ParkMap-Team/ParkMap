export function proportionalRowWidth(rowLength: number | null, rowLengths: Array<number | null>): number | null {
  if (rowLength === null || !Number.isFinite(rowLength) || rowLength <= 0) return null;
  const valid = rowLengths.filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  if (!valid.length) return null;
  return rowLength / Math.max(...valid);
}

export function positionWithinProportionalRow(t: number, rowWidth: number): number {
  return t * rowWidth;
}
