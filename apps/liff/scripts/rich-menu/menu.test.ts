import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { messagingApi } from "@line/bot-sdk";
import { BUTTONS_HEIGHT, MAX_IMAGE_BYTES, MENU_IMAGE, MENU_SIZE, parseLiffId, richMenu } from "./menu.ts";

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

test("the buttons cover the tiles above the logo strip without overlapping", () => {
  const areas = richMenu(LIFF_ID).areas ?? [];
  const covered = areas.reduce((sum, { bounds }) => sum + rect(bounds).width * rect(bounds).height, 0);
  assert.equal(covered, MENU_SIZE.width * BUTTONS_HEIGHT);
  assert.ok(areas.every(({ bounds }) => rect(bounds).y + rect(bounds).height <= BUTTONS_HEIGHT));
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

// Reads the frame size from the first SOF0-SOF2 segment.
function jpegSize(bytes: Buffer) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, "not a JPEG");
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    const marker = bytes.readUInt16BE(offset);
    if (marker >= 0xffc0 && marker <= 0xffc2) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error("JPEG has no frame header");
}

test("the image matches the menu size and LINE's 1 MB limit", () => {
  const image = readFileSync(MENU_IMAGE);
  assert.ok(image.length <= MAX_IMAGE_BYTES, `${image.length} bytes`);
  assert.deepEqual(jpegSize(image), MENU_SIZE);
});

test("a production LIFF ID is required and must be an ID, not a URL", () => {
  assert.equal(parseLiffId(` ${LIFF_ID}\n`), LIFF_ID);
  for (const value of [undefined, "", "   ", `https://liff.line.me/${LIFF_ID}`, "1234567890", `${LIFF_ID}/help`]) {
    assert.throws(() => parseLiffId(value), /PRODUCTION_LIFF_ID/);
  }
});
