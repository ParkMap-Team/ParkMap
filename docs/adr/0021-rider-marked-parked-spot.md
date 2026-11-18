# 0021: Rider-marked parked spot

Accepted 2026-11-18 at the owner's request. It reverses the rejection of "Student marks the spot" in [0010](0010-where-i-parked-by-plate-handoff.md) for this feature only; plate handoff stays proposed and would replace nothing here.

## Decision

After the LINE parking guide ([0020](0020-shared-recommendation-holds.md)) has drawn its route, the recommended place's pin on the map offers to save "I parked here". Saving stores a **marked spot**: the site and the ground point of the recommended place, under the verified LINE account. The "where is my car" tab shows it on the lot model with the time it was saved.

- **Identity.** The LINE settings service (`app.line_bot`, [0018](0018-line-motorcycle-settings.md)) verifies the LINE token server-side and keys the spot by the SHA-256 hash of the verified user ID, as it does for the motorcycle preference. The browser never asserts identity. A spot is visible only to its account.
- **Storage.** One row per account in the bot-owned `parkmap_line` schema, with its own migration. Saving replaces the previous spot; the rider can delete it. A spot older than 24 hours is never returned and is deleted when its account next reads it.
- **Trust.** The spot is the rider's own claim. It is validated for shape and bounds, never used for availability, holds or fitting, and the vision API never reads it. The service does not check it against the lot model; the page draws it on the site it names, and shows nothing for a site that no longer exists.
- **Wording.** It states where the rider said they parked and when, never that the motorcycle is still there. LINE user IDs, tokens and coordinates stay out of logs.

## Why

The owner wants "where is my car" now. Plate handoff needs an entrance camera, tracking and advisor approval, none of which exist. The guide already puts the rider on one recommended place, so marking it is one tap at the moment the rider arrives. Keeping it in the LINE settings service reuses its verified identity and isolated schema; the vision API keeps no rider data.

## Consequences

- A rider who parks somewhere other than the recommended place, or never taps save, has no spot, or a wrong one. The page says it is the place the rider saved.
- The settings service gains a second table and is now needed by the "where is my car" tab as well as settings.
- Spot data is erased with the other LINE data at project end.
