import { describe, it, expect } from "vitest";
import {
  DEFAULT_VIEW,
  VIEWS,
  VIEW_KEY,
  VIEW_STORAGE_KEY,
  initialView,
  isView,
  isViewKey,
  nextView,
  rememberView,
  type View,
  type ViewStore,
} from "../src/ui/view.js";
import { toIntent } from "../src/ui/input.js";

/**
 * The switch between the two screens. Every rule of it is a pure function of a
 * query string, a key and a two-method store, which is the whole reason this
 * can be tested at all in a suite that has no DOM.
 */

function store(initial?: string): ViewStore & { value: string | undefined } {
  return {
    value: initial,
    getItem(key) {
      return key === VIEW_STORAGE_KEY ? (this.value ?? null) : null;
    },
    setItem(key, value) {
      if (key === VIEW_STORAGE_KEY) this.value = value;
    },
  };
}

/** A store that behaves like one in a private window: it throws on both calls. */
const HOSTILE: ViewStore = {
  getItem(): string | null {
    throw new Error("access denied");
  },
  setItem(): void {
    throw new Error("access denied");
  },
};

describe("the view cycle", () => {
  it("walks every view and comes back", () => {
    let view: View = DEFAULT_VIEW;
    const seen = new Set<View>([view]);
    for (let i = 0; i < VIEWS.length; i++) {
      view = nextView(view);
      seen.add(view);
    }
    expect(view).toBe(DEFAULT_VIEW);
    expect([...seen].sort()).toEqual([...VIEWS].sort());
  });

  it("knows a view from anything else a URL or a store could hold", () => {
    expect(isView("web")).toBe(true);
    expect(isView("ascii")).toBe(true);
    expect(isView("hex")).toBe(true);
    for (const junk of ["WEB", "", "svg", null, undefined, 3, {}]) {
      expect(isView(junk), String(junk)).toBe(false);
    }
  });

  it("opens on ASCII with nothing to go on", () => {
    expect(initialView("")).toBe("ascii");
    expect(initialView("?seed=7")).toBe(DEFAULT_VIEW);
  });

  it("takes the view from the URL", () => {
    expect(initialView("?view=web")).toBe("web");
    expect(initialView("?seed=7&view=web")).toBe("web");
    expect(initialView("?view=ascii", store("web"))).toBe("ascii");
  });

  it("ignores a URL that names no view we have", () => {
    expect(initialView("?view=isometric", store("web"))).toBe("web");
    expect(initialView("?view=hex")).toBe("hex");
    expect(initialView("?view=")).toBe(DEFAULT_VIEW);
  });

  it("remembers the last choice when the URL says nothing", () => {
    expect(initialView("", store("web"))).toBe("web");
    expect(initialView("?seed=3", store("ascii"))).toBe("ascii");
  });

  it("writes the choice back, and only the choice", () => {
    const saved = store();
    rememberView("web", saved);
    expect(saved.value).toBe("web");
    rememberView("ascii", saved);
    expect(saved.value).toBe("ascii");
  });

  it("survives a browser that refuses storage at all", () => {
    // Private mode: `localStorage` exists and throws on touch. A setting is not
    // worth a black screen, so both directions swallow it.
    expect(() => rememberView("web", HOSTILE)).not.toThrow();
    expect(initialView("", HOSTILE)).toBe(DEFAULT_VIEW);
    expect(initialView("?view=web", HOSTILE)).toBe("web");
  });

  it("does not need a store at all", () => {
    expect(initialView("?view=web", undefined)).toBe("web");
    expect(() => rememberView("web", undefined)).not.toThrow();
  });
});

describe("the key that switches views", () => {
  it("is shift+V and nothing else", () => {
    expect(isViewKey({ key: VIEW_KEY, code: "KeyV", shiftKey: true })).toBe(true);
    expect(isViewKey({ key: "v", code: "KeyV" })).toBe(false);
    expect(isViewKey({ key: "V", code: "KeyV", metaKey: true })).toBe(false);
    expect(isViewKey({ key: "V", code: "KeyV", ctrlKey: true })).toBe(false);
  });

  it("takes no letter the game already uses", () => {
    // The intent table is the authority on what a key means; `V` reaching it
    // would mean the view key had quietly stolen a verb.
    expect(toIntent({ key: VIEW_KEY, code: "KeyV", shiftKey: true })).toEqual({ kind: "none" });
  });
});
