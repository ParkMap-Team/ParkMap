// Creates the production rich menu and makes it the default, then deletes the
// previous API-created menus, so running it again leaves exactly one menu.
// Usage: LINE_CHANNEL_ACCESS_TOKEN=... PRODUCTION_LIFF_ID=... pnpm rich-menu
// Never print the token, and never write it to a file.
import { readFile } from "node:fs/promises";
import { HTTPFetchError, messagingApi } from "@line/bot-sdk";
import { liffUrl, parseLiffId, richMenu } from "./menu.ts";

const IMAGE = new URL("./rich-menu.png", import.meta.url);

async function main() {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!channelAccessToken) {
    throw new Error("Set LINE_CHANNEL_ACCESS_TOKEN for this shell from the LINE Developers Console.");
  }
  const liffId = parseLiffId(process.env.PRODUCTION_LIFF_ID);
  const menu = richMenu(liffId);
  const image = new Blob([await readFile(IMAGE)], { type: "image/png" });

  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

  await client.validateRichMenuObject(menu);
  const { richmenus: previous } = await client.getRichMenuList();
  const { richMenuId } = await client.createRichMenu(menu);
  try {
    await blobClient.setRichMenuImage(richMenuId, image);
    await client.setDefaultRichMenu(richMenuId);
  } catch (error) {
    await client
      .deleteRichMenu(richMenuId)
      .catch(() => console.error(`Could not delete the new menu ${richMenuId}; the next run deletes it.`));
    throw error;
  }
  for (const old of previous) {
    await client.deleteRichMenu(old.richMenuId);
  }
  console.log(`Default rich menu ${richMenuId} opens ${liffUrl(liffId)}; deleted ${previous.length} old menu(s).`);
}

main().catch((error: unknown) => {
  if (error instanceof HTTPFetchError) {
    console.error(`LINE API error ${error.message}: ${error.body}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
