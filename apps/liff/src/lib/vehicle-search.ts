// How the settings tab's model search matches what a rider types against a model's name.

/** The model a rider picks when theirs is not in the list. */
export const UNSPECIFIED_MODEL = "other";

function squash(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("th").replace(/[\s._-]/g, "");
}

/** Whether a model's name contains the search, ignoring case, spaces, and hyphens, so "cbr 650" finds Honda CBR650R. */
export function modelMatches(label: string, query: string): boolean {
  return squash(label).includes(squash(query));
}
