import assert from "node:assert/strict";
import { test } from "node:test";
import type { messagingApi } from "@line/bot-sdk";
import { MENU_SIZE, parseLiffId, richMenu } from "./menu.ts";

const LIFF_ID = "1234567890-AbCdEfGh";

function rect(bounds: messagingApi.RichMenuBounds | undefined) {
  const { x, y, width, height } = bounds ?? {};
  assert.ok(x !== undefined && y !== undefined && width !== undefined && height !== undefined);
  return { x, y, width, height };
}

test("the menu has five URI buttons inside the image that open distinct production LIFF URLs", () => {
  const menu = richMenu(LIFF_ID);
  assert.deepEqual(menu.size, MENU_SIZE);
  assert.ok(menu.chatBarText && [...menu.chatBarText].length <= 14);
  assert.equal(menu.areas?.length, 5);

  const uris = menu.areas.map(({ bounds: area, action }) => {
    const bounds = rect(area);
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.height > 0);
    assert.ok(bounds.x + bounds.width <= MENU_SIZE.width);
    assert.ok(bounds.y + bounds.height <= MENU_SIZE.height);
    assert.equal(action?.type, "uri");
    assert.ok(action.type === "uri" && action.uri);
    return action.uri;
  });
  assert.equal(uris[0], `https://liff.line.me/${LIFF_ID}`);
  for (const uri of uris.slice(1)) {
    assert.ok(uri.startsWith(`https://liff.line.me/${LIFF_ID}/`), uri);
  }
  assert.equal(new Set(uris).size, uris.length);
});

test("the buttons do not overlap", () => {
  const areas = richMenu(LIFF_ID).areas ?? [];
  for (const [i, { bounds }] of areas.entries()) {
    const a = rect(bounds);
    for (const other of areas.slice(i + 1)) {
      const b = rect(other.bounds);
      const apart =
        a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      assert.ok(apart);
    }
  }
});

test("a production LIFF ID is required and must be an ID, not a URL", () => {
  assert.equal(parseLiffId(` ${LIFF_ID}\n`), LIFF_ID);
  for (const value of [undefined, "", "   ", `https://liff.line.me/${LIFF_ID}`, "1234567890", `${LIFF_ID}/help`]) {
    assert.throws(() => parseLiffId(value), /PRODUCTION_LIFF_ID/);
  }
});
