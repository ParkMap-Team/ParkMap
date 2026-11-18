import type { Insets } from "@/lib/map/camera";
import { COLORS } from "@/lib/parking/presentation";
import { LoadingDots } from "./mascot";

/**
 * What shows while a map view loads: bare ground behind both views, with no lot shape and no status,
 * so nothing has to line up with the map as it fades in. The catalogue's Loading Dots rise in turn
 * where the lot will appear; the words are for screen readers only.
 */
export function MapSkeleton({ insets, loading }: { insets: Insets; loading: boolean }) {
  return (
    <div className="absolute inset-0" style={{ backgroundColor: COLORS.GROUND }}>
      {/* The overview centres the lot between the insets, so the dots sit where it will be. */}
      <div role="status" className="absolute flex items-center justify-center" style={{ top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left }}>
        {loading && (
          <>
            <span className="sr-only">กำลังโหลดแผนที่</span>
            <LoadingDots size="large" />
          </>
        )}
      </div>
    </div>
  );
}
