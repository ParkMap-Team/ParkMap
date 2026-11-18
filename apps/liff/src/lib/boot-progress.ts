// What the app does before its first screen, in order. Each step is real work the gate waits on, so
// the progress bar moves only when one finishes and never stands for time passing.

/** The steps the vehicle gate runs at launch, each named for what the student is waiting on. */
export const BOOT_STEPS = ["กำลังเชื่อมต่อ LINE", "กำลังตรวจสอบรุ่นรถของคุณ"] as const;

/** The catalogue's Progress Fill starts at 8%, so the bar is never an empty track. */
const FILL_START = 0.08;

/** How full the bar is with `done` of `total` steps finished. */
export function progressFill(done: number, total: number): number {
  return Math.max(FILL_START, done / total);
}
