import type { messagingApi } from "@line/bot-sdk";

// Large rich menu. The image in this folder is drawn on the same grid.
export const MENU_SIZE = { width: 2500, height: 1686 } as const;

const TOP_HEIGHT = 843;
const BUTTON_WIDTH = MENU_SIZE.width / 4;

// The largest button opens the site list; the rest open paths of the same LIFF app.
const BUTTONS = [
  { label: "พื้นที่ว่างตอนนี้", path: "" },
  { label: "จุดที่จอดรถไว้", path: "/parked" },
  { label: "ลานจอดใกล้ฉัน", path: "/nearby" },
  { label: "วิธีใช้งาน", path: "/help" },
  { label: "ตั้งค่า", path: "/settings" },
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
  const [main, ...rest] = BUTTONS;
  return {
    size: { ...MENU_SIZE },
    selected: true,
    name: "ParkMap main menu",
    chatBarText: "เมนู ParkMap",
    areas: [
      area(liffId, main, { x: 0, y: 0, width: MENU_SIZE.width, height: TOP_HEIGHT }),
      ...rest.map((button, index) =>
        area(liffId, button, {
          x: index * BUTTON_WIDTH,
          y: TOP_HEIGHT,
          width: BUTTON_WIDTH,
          height: MENU_SIZE.height - TOP_HEIGHT,
        }),
      ),
    ],
  };
}

function area(
  liffId: string,
  button: (typeof BUTTONS)[number],
  bounds: messagingApi.RichMenuBounds,
): messagingApi.RichMenuArea {
  return { bounds, action: { type: "uri", label: button.label, uri: `${liffUrl(liffId)}${button.path}` } };
}
