export function normalizeDetectionId(value: string | number): string {
  const raw = String(value).trim().replace(/^#/, '');
  const numeric = raw.replace(/^detection[-_]/, '');
  return `detection-${numeric}`;
}
