// What the settings tab's "เกี่ยวกับ" group shows: which build this is, and a way to reach the team.

/** The first seven characters of the commit this build came from, or null when the build recorded none. */
export function shortCommit(commit: string | undefined): string | null {
  const value = commit?.trim().toLowerCase();
  return value && /^[0-9a-f]{7,40}$/.test(value) ? value.slice(0, 7) : null;
}

/** The official account's LINE ID ("@" then a basic or premium ID), or null when it is unset or malformed. */
export function lineOaId(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  return value && /^@[0-9a-z._-]+$/.test(value) ? value : null;
}

/**
 * LINE's link that opens the chat with the official account, with a report already started. The
 * build's version goes in the text so the team knows which release the report is about.
 */
export function reportChatUrl(oaId: string, version: string | null): string {
  const text = version ? `แจ้งปัญหา ParkMap (เวอร์ชัน ${version})\n` : "แจ้งปัญหา ParkMap\n";
  return `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(text)}`;
}
