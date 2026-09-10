import assert from "node:assert/strict";
import test from "node:test";
import { getFocusableElements, trapTabKey } from "./focus-trap";

function createMockElement(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    hasAttribute: (attr: string) => attr === "disabled" && Boolean(overrides.disabled),
    getAttribute: (attr: string) => attr === "aria-hidden" ? (overrides.ariaHidden ? "true" : null) : null,
    style: { display: overrides.display || "block", visibility: overrides.visibility || "visible" },
    focus: overrides.focus || (() => {}),
  } as unknown as HTMLElement;
}

test("focus-trap: extracts and orders focusable elements while ignoring disabled/hidden", () => {
  const container = {
    querySelectorAll: () => [
      createMockElement("disabled-btn", { disabled: true }),
      createMockElement("aria-hidden-input", { ariaHidden: true }),
      createMockElement("hidden-input", { display: "none" }),
      createMockElement("btn1"),
      createMockElement("link1"),
      createMockElement("btn2"),
    ],
  } as unknown as HTMLElement;

  const focusables = getFocusableElements(container);
  assert.equal(focusables.length, 3);
  assert.equal((focusables[0] as unknown as { id: string }).id, "btn1");
  assert.equal((focusables[1] as unknown as { id: string }).id, "link1");
  assert.equal((focusables[2] as unknown as { id: string }).id, "btn2");
});

test("focus-trap: trapTabKey cycles forward from last to first element", () => {
  let focusedId = "";
  const first = createMockElement("first", { focus: () => { focusedId = "first"; } });
  const middle = createMockElement("middle", { focus: () => { focusedId = "middle"; } });
  const last = createMockElement("last", { focus: () => { focusedId = "last"; } });

  const container = {
    querySelectorAll: () => [first, middle, last],
    contains: (el: unknown) => el === first || el === middle || el === last,
  } as unknown as HTMLElement;

  (globalThis as unknown as { document: { activeElement: HTMLElement } }).document = {
    activeElement: last,
  };

  let prevented = false;
  const event = {
    key: "Tab",
    shiftKey: false,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent;

  const handled = trapTabKey(event, container);
  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(focusedId, "first");
});

test("focus-trap: trapTabKey cycles backward from first to last element on Shift+Tab", () => {
  let focusedId = "";
  const first = createMockElement("first", { focus: () => { focusedId = "first"; } });
  const middle = createMockElement("middle", { focus: () => { focusedId = "middle"; } });
  const last = createMockElement("last", { focus: () => { focusedId = "last"; } });

  const container = {
    querySelectorAll: () => [first, middle, last],
    contains: (el: unknown) => el === first || el === middle || el === last,
  } as unknown as HTMLElement;

  (globalThis as unknown as { document: { activeElement: HTMLElement } }).document = {
    activeElement: first,
  };

  let prevented = false;
  const event = {
    key: "Tab",
    shiftKey: true,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent;

  const handled = trapTabKey(event, container);
  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(focusedId, "last");
});
