/** Metric calibration map: consume Python's estimate without a display scale. */
export function motorcycleDisplayWidth(vehicle: { width_m: number; estimated_width_m?: number | null }): number {
  return vehicle.estimated_width_m ?? vehicle.width_m;
}
