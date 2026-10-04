import type { messagingApi } from "@line/bot-sdk";

// The menu matches its image, generated with Codex at 1536x1024. LINE accepts widths of 800 to
// 2500 px and a width/height ratio of at least 1.45.
export const MENU_SIZE = { width: 1536, height: 1024 } as const;
export const MENU_IMAGE = new URL("./rich-menu.jpg", import.meta.url);
// LINE accepts JPEG or PNG up to 1 MB. JPEG keeps the glossy art well under it.
export const MENU_IMAGE_TYPE = "image/jpeg";
export const MAX_IMAGE_BYTES = 1_000_000;

// Buttons cover the tiles; the logo strip below them is not a button.
export const BUTTONS_HEIGHT = 832;

// The largest button opens the site list; the rest open paths of the same LIFF app.
// Tap areas meet in the middle of the gutters between the tiles, measured on the image.
const BUTTONS = [
  { label: "พื้นที่ว่างตอนนี้", path: "", bounds: { x: 0, y: 0, width: 896, height: BUTTONS_HEIGHT } },
  { label: "จุดที่จอดรถไว้", path: "/parked", bounds: { x: 896, y: 0, width: 298, height: 433 } },
  { label: "ลานจอดใกล้ฉัน", path: "/nearby", bounds: { x: 1194, y: 0, width: 342, height: 433 } },
  { label: "วิธีใช้งาน", path: "/help", bounds: { x: 896, y: 433, width: 298, height: BUTTONS_HEIGHT - 433 } },
  { label: "ตั้งค่า", path: "/settings", bounds: { x: 1194, y: 433, width: 342, height: BUTTONS_HEIGHT - 433 } },
] as const;

const LIFF_ID = /^\d+-[A-Za-z0-9]+$/;

export function parseLiffId(value: string | undefined): string {
  const liffId = value?.trim() ?? "";
  if (!LIFF_ID.test(liffId)) {
    throw new Error("PRODUCTION_LIFF_ID must be a LIFF ID like 1234567890-AbCdEfGh");
  }
  return liffId;
}

export function liffUrl(liffId: string): string {
  return `https://liff.line.me/${liffId}`;
}

export function richMenu(liffId: string): messagingApi.RichMenuRequest {
  return {
    size: { ...MENU_SIZE },
    selected: true,
    name: "ParkMap main menu",
    chatBarText: "เมนู ParkMap",
    areas: BUTTONS.map(({ label, path, bounds }) => ({
      bounds: { ...bounds },
      action: { type: "uri", label, uri: `${liffUrl(liffId)}${path}` },
    })),
  };
}
