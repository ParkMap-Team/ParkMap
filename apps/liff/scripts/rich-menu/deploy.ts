// Creates the production menus, makes the current menu default, and preserves
// the onboarding menu across runs.
// Requires LINE_CHANNEL_ACCESS_TOKEN, PRODUCTION_LIFF_ID, and LINE_BOT_HEALTH_URL.
// Never print the token, and never write it to a file.
import { readFile } from "node:fs/promises";
import { HTTPFetchError, messagingApi } from "@line/bot-sdk";

import {
  liffUrl,
  MENU_IMAGE,
  MENU_IMAGE_TYPE,
  ONBOARDING_MENU_IMAGE,
  onboardingRichMenu,
  parseLiffId,
  richMenu,
} from "./menu.ts";

async function main() {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!channelAccessToken) {
    throw new Error("Set LINE_CHANNEL_ACCESS_TOKEN for this shell from the LINE Developers Console.");
  }
  const liffId = parseLiffId(process.env.PRODUCTION_LIFF_ID);
  const healthUrl = process.env.LINE_BOT_HEALTH_URL?.trim();
  if (!healthUrl) throw new Error("Set LINE_BOT_HEALTH_URL for the healthy parkmap-line-bot service.");
  let health: Response;
  try {
    health = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error("Could not reach the parkmap-line-bot health endpoint.");
  }
  const healthBody = health.ok ? await health.json().catch(() => null) : null;
  if (healthBody?.status !== "ok" || healthBody?.service !== "parkmap-line-settings") {
    throw new Error("The parkmap-line-bot health endpoint is not ready.");
  }

  const menu = richMenu(liffId);
  const onboardingMenu = onboardingRichMenu(liffId);

  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

  await client.validateRichMenuObject(menu);
  await client.validateRichMenuObject(onboardingMenu);
  const { richmenus: previous } = await client.getRichMenuList();
  const configuredOnboardingId = process.env.LINE_ONBOARDING_RICH_MENU_ID?.trim();
  const namedOnboarding = previous.filter(({ name }) => name === "ParkMap onboarding");
  if (namedOnboarding.length > 1 && !configuredOnboardingId) {
    throw new Error("More than one ParkMap onboarding menu exists; set LINE_ONBOARDING_RICH_MENU_ID to the one in use.");
  }
  const existingOnboardingId = configuredOnboardingId ?? namedOnboarding[0]?.richMenuId;
  if (configuredOnboardingId && !previous.some(({ richMenuId }) => richMenuId === configuredOnboardingId)) {
    throw new Error("LINE_ONBOARDING_RICH_MENU_ID is not present in the LINE rich menu list.");
  }

  let onboardingMenuId = existingOnboardingId;
  let createdOnboarding = false;
  let defaultMenuSet = false;
  try {
    if (!onboardingMenuId) {
      onboardingMenuId = await createMenu(client, blobClient, onboardingMenu, ONBOARDING_MENU_IMAGE);
      createdOnboarding = true;
    }
    const richMenuId = await createMenu(client, blobClient, menu, MENU_IMAGE);
    try {
      await client.setDefaultRichMenu(richMenuId);
      defaultMenuSet = true;
    } catch (error) {
      await client.deleteRichMenu(richMenuId).catch(() => console.error(`Could not delete the new main menu ${richMenuId}.`));
      throw error;
    }
    let deleted = 0;
    for (const old of previous) {
      if (old.richMenuId === onboardingMenuId) continue;
      await client.deleteRichMenu(old.richMenuId);
      deleted++;
    }
    console.log(`Default rich menu ${richMenuId} opens ${liffUrl(liffId)}; onboarding rich menu ${onboardingMenuId}; deleted ${deleted} old menu(s).`);
  } catch (error) {
    if (createdOnboarding && onboardingMenuId && !defaultMenuSet) {
      await client.deleteRichMenu(onboardingMenuId).catch(() => console.error(`Could not delete the new onboarding menu ${onboardingMenuId}.`));
    }
    throw error;
  }
}

async function createMenu(
  client: messagingApi.MessagingApiClient,
  blobClient: messagingApi.MessagingApiBlobClient,
  menu: messagingApi.RichMenuRequest,
  imageUrl: URL,
): Promise<string> {
  const image = new Blob([await readFile(imageUrl)], { type: MENU_IMAGE_TYPE });
  const { richMenuId } = await client.createRichMenu(menu);
  try {
    await blobClient.setRichMenuImage(richMenuId, image);
  } catch (error) {
    await client.deleteRichMenu(richMenuId).catch(() => console.error(`Could not delete the new menu ${richMenuId}.`));
    throw error;
  }
  return richMenuId;
}

main().catch((error: unknown) => {
  if (error instanceof HTTPFetchError) {
    console.error(`LINE API error ${error.message}: ${error.body}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
