// The signed-in student's LINE name and picture, shown only to them on the settings screen. They
// come from the LIFF SDK in the browser, are never sent to ParkMap's servers, and are never logged.

/** What the settings screen shows for the LINE account. */
export type LineProfile = { name: string; initial: string; picture: string | null };

/** LINE serves profile pictures from its own CDN; any other address is not drawn. */
const PICTURE_HOST = /(^|\.)line-scdn\.net$/;

function linePicture(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && PICTURE_HOST.test(parsed.hostname) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Reads what `liff.getProfile()` returns; null when there is no name to show. */
export function lineProfile(profile: { displayName: string; pictureUrl?: string }): LineProfile | null {
  const name = profile.displayName.trim();
  if (!name) return null;
  // The first grapheme, so a Thai consonant keeps its marks and an emoji stays whole.
  const [first] = new Intl.Segmenter("th", { granularity: "grapheme" }).segment(name);
  return { name, initial: first.segment.toUpperCase(), picture: linePicture(profile.pictureUrl) };
}
