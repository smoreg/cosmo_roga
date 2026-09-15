/* @ds-bundle: {"format":4,"namespace":"SALVORScreensAsBuilt_2b77ba","components":[{"name":"Lever","sourcePath":"components/action/Lever.jsx"},{"name":"ActionList","sourcePath":"components/action/Lever.jsx"},{"name":"LogStrip","sourcePath":"components/action/Lever.jsx"},{"name":"Knowledge","sourcePath":"components/board/HexTile.jsx"},{"name":"Popover","sourcePath":"components/board/HexTile.jsx"},{"name":"Readout","sourcePath":"components/board/HexTile.jsx"},{"name":"HexTile","sourcePath":"components/board/HexTile.jsx"},{"name":"MoverMark","sourcePath":"components/board/HexTile.jsx"},{"name":"DroneGhost","sourcePath":"components/board/HexTile.jsx"},{"name":"DroneMark","sourcePath":"components/board/HexTile.jsx"},{"name":"HexMap","sourcePath":"components/board/HexTile.jsx"},{"name":"ContentIcon","sourcePath":"components/board/HexTile.jsx"},{"name":"ObjectRow","sourcePath":"components/board/HexTile.jsx"},{"name":"Panel","sourcePath":"components/chrome/Panel.jsx"},{"name":"Tag","sourcePath":"components/chrome/Panel.jsx"},{"name":"MenuSheet","sourcePath":"components/chrome/Panel.jsx"},{"name":"Rail","sourcePath":"components/chrome/Panel.jsx"},{"name":"SegmentMeter","sourcePath":"components/meters/SegmentMeter.jsx"},{"name":"SlashMeter","sourcePath":"components/meters/SegmentMeter.jsx"},{"name":"CorePips","sourcePath":"components/meters/SegmentMeter.jsx"},{"name":"CoreRack","sourcePath":"components/meters/SegmentMeter.jsx"},{"name":"AlertDial","sourcePath":"components/meters/SegmentMeter.jsx"},{"name":"FRAME","sourcePath":"derelict-fx.js"},{"name":"BLOCK_CHARS","sourcePath":"derelict-fx.js"},{"name":"TOKEN_CHARS","sourcePath":"derelict-fx.js"},{"name":"SCRAMBLE_CHARS","sourcePath":"derelict-fx.js"},{"name":"PRESETS","sourcePath":"derelict-fx.js"},{"name":"API","sourcePath":"derelict-fx.js"}],"sourceHashes":{"components/action/Lever.jsx":"4ac989e8584b","components/board/HexTile.jsx":"d01a2860cdad","components/chrome/Panel.jsx":"fefb8f2832d8","components/meters/SegmentMeter.jsx":"78192a651191","derelict-fx.js":"bb2fb3d7e5b4"},"inlinedExternals":[],"unexposedExports":[{"name":"arrive","sourcePath":"derelict-fx.js"},{"name":"blink","sourcePath":"derelict-fx.js"},{"name":"clearGhosts","sourcePath":"derelict-fx.js"},{"name":"edgeBurst","sourcePath":"derelict-fx.js"},{"name":"exchange","sourcePath":"derelict-fx.js"},{"name":"frames","sourcePath":"derelict-fx.js"},{"name":"hitStop","sourcePath":"derelict-fx.js"},{"name":"impact","sourcePath":"derelict-fx.js"},{"name":"prefersReducedMotion","sourcePath":"derelict-fx.js"},{"name":"randomScramble","sourcePath":"derelict-fx.js"},{"name":"scrambleLike","sourcePath":"derelict-fx.js"},{"name":"scrambleReveal","sourcePath":"derelict-fx.js"},{"name":"setAndReveal","sourcePath":"derelict-fx.js"},{"name":"steppedTransit","sourcePath":"derelict-fx.js"},{"name":"teleport","sourcePath":"derelict-fx.js"},{"name":"wake","sourcePath":"derelict-fx.js"}]} */

(() => {

const __ds_ns = (window.SALVORScreensAsBuilt_2b77ba = window.SALVORScreensAsBuilt_2b77ba || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/action/Lever.jsx
try { (() => {
const TONE = {
  amber: "var(--sv-amber)",
  good: "var(--sv-good)",
  warn: "var(--sv-warn)",
  bad: "var(--sv-bad)",
  neutral: "var(--sv-rim)"
};

/* The commit action as a printed slab: ink knocked out of solid accent, the
   same clipped corner the panels carry, the keystroke in brackets under it. */
function Lever({
  label,
  hint,
  tone = "amber",
  ready = false,
  disabled = false,
  width = 186,
  height = 62,
  onClick,
  style
}) {
  const c = disabled ? "var(--sv-plate-lit)" : TONE[tone] || TONE.amber;
  return /*#__PURE__*/React.createElement("div", {
    onClick: disabled ? undefined : onClick,
    style: {
      position: "relative",
      width,
      height,
      clipPath: "var(--sv-cut-bl)",
      background: c,
      cursor: disabled ? "not-allowed" : "pointer",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      animation: ready ? "sv-flick var(--sv-frame-3) var(--sv-step) infinite" : "none",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--sv-scan)",
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      font: "var(--sv-display)",
      fontSize: 27,
      letterSpacing: "var(--sv-display-track)",
      textTransform: "uppercase",
      color: disabled ? "var(--sv-soft)" : "var(--sv-knock)"
    }
  }, label), hint ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      font: "var(--sv-stencil)",
      letterSpacing: "var(--sv-stencil-track)",
      textTransform: "uppercase",
      color: disabled ? "var(--sv-soft)" : "var(--sv-knock)",
      opacity: .75
    }
  }, "[", hint, "]") : null);
}

/* The action list is the whole interface: numbered rows, keyed, ten at a time,
   and the cursor row is the one a keypress would take. Ten is not a layout
   choice — it is how many number keys there are, which is the same reason
   Cogmind's inventory is ten slots rather than six. */
function ActionList({
  actions = [],
  cursor = 0,
  title = "Actions",
  limit = 10,
  onPick,
  style
}) {
  const [hover, setHover] = React.useState(-1);
  const shown = actions.slice(0, limit),
    hidden = actions.length - shown.length;
  const keyOf = (a, i) => a.key != null ? a.key : i === 9 ? 0 : i + 1;
  /* Cogmind brackets the row under the cursor rather than filling it. Bars on
     both sides, stepped in over one frame — no fade, no slide. */
  const bar = side => ({
    position: "absolute",
    [side]: 0,
    top: 0,
    bottom: 0,
    width: 3,
    background: "var(--sv-amber)",
    transformOrigin: "center",
    animation: "sv-bracket var(--sv-frame) var(--sv-step) 1 both"
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--sv-font-mono)",
      ...style
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      paddingBottom: 7,
      borderBottom: "1px solid var(--sv-line)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--sv-stencil)",
      letterSpacing: "var(--sv-stencil-track)",
      textTransform: "uppercase",
      color: "var(--sv-amber)"
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      font: "var(--sv-stencil)",
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, actions.length, " open")) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2,
      marginTop: 9
    },
    onMouseLeave: () => setHover(-1)
  }, shown.map((a, i) => {
    const on = i === cursor,
      hot = i === hover && !a.disabled;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      onClick: a.disabled ? undefined : () => onPick && onPick(i),
      onMouseEnter: () => setHover(i),
      style: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "3px 12px",
        cursor: a.disabled ? "not-allowed" : "pointer",
        background: on ? "var(--sv-amber)" : hot ? "color-mix(in oklab, var(--sv-amber) 14%, transparent)" : "transparent"
      }
    }, hot && !on ? /*#__PURE__*/React.createElement("div", {
      style: bar("left")
    }) : null, hot && !on ? /*#__PURE__*/React.createElement("div", {
      style: bar("right")
    }) : null, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 26,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 3,
        font: "var(--sv-stencil)",
        fontSize: 14,
        letterSpacing: 0,
        color: on ? "var(--sv-knock)" : hot ? "var(--sv-amber-hi)" : "var(--sv-soft)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 9
      }
    }, on ? "\u25b8" : ""), keyOf(a, i)), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        font: "var(--sv-body)",
        color: on ? "var(--sv-knock)" : a.disabled ? "var(--sv-soft)" : hot ? "var(--sv-ink)" : "var(--sv-fg)"
      }
    }, a.label), a.note ? /*#__PURE__*/React.createElement("div", {
      style: {
        flex: "none",
        font: "var(--sv-stencil)",
        fontSize: 14,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: on ? "var(--sv-knock)" : a.tone === "bad" ? "color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))" : "var(--sv-soft)",
        opacity: on ? .78 : 1
      }
    }, a.note) : null);
  }), hidden > 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "4px 12px 0 48px",
      font: "var(--sv-body)",
      color: "var(--sv-soft)"
    }
  }, "\u2026 ", hidden, " more here") : null));
}

/* The log reads as a ticker bolted to the bottom of the screen. Expanding it
   overlays the record upward over whatever is above — it never takes layout
   space, so the map does not resize under you when you open the log. */
function LogStrip({
  entries = [],
  expanded = false,
  onToggle,
  height = 30,
  style
}) {
  const last = entries[0] || {
    tag: "",
    text: ""
  };
  const ink = t => t === "bad" ? "color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))" : t === "warn" ? "var(--sv-warn)" : "var(--sv-fg)";
  const recordRef = React.useRef(null);
  const tickerRef = React.useRef(null);
  /* The record was already written, so it resolves all at once rather than
     line by line — a log you have to wait through is a log you stop opening. */
  React.useEffect(() => {
    if (!expanded) return;
    const FX = typeof window !== "undefined" ? window.FX || window.DerelictFX : null;
    if (!FX || !recordRef.current) return;
    const h = FX.scrambleReveal(recordRef.current.querySelectorAll("[data-sc]"), FX.PRESETS.all || {
      stagger: 0,
      ticks: 3,
      tickMs: 95
    });
    return () => h.cancel();
  }, [expanded]);

  /* A line the machine has just written resolves as it arrives — this is the
     one log animation that is about news rather than about reading. */
  React.useEffect(() => {
    const FX = typeof window !== "undefined" ? window.FX || window.DerelictFX : null;
    if (!FX || !tickerRef.current) return;
    const h = FX.scrambleReveal(tickerRef.current.querySelectorAll("[data-sc]"), FX.PRESETS.hover);
    return () => h.cancel();
  }, [last.text, last.tag]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      background: "var(--sv-plate)",
      borderTop: "1px solid var(--sv-line)",
      fontFamily: "var(--sv-font-mono)",
      ...style
    }
  }, expanded ? /*#__PURE__*/React.createElement("div", {
    ref: recordRef,
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: "100%",
      maxHeight: 260,
      overflow: "auto",
      padding: "10px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 7,
      background: "var(--sv-knock)",
      borderTop: "1px solid var(--sv-line)",
      zIndex: 30
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--sv-scan)",
      pointerEvents: "none"
    }
  }), entries.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: (e.tag || "") + "|" + (e.text || "") + "|" + i,
    style: {
      display: "flex",
      gap: 10,
      alignItems: "baseline"
    }
  }, /*#__PURE__*/React.createElement("div", {
    "data-sc": true,
    style: {
      width: 70,
      flex: "none",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".12em",
      textTransform: "uppercase",
      color: i === 0 ? "var(--sv-amber)" : "var(--sv-soft)"
    }
  }, e.tag), /*#__PURE__*/React.createElement("div", {
    "data-sc": true,
    style: {
      font: "var(--sv-body)",
      color: i === 0 ? "var(--sv-ink)" : ink(e.tone)
    }
  }, e.text)))) : null, /*#__PURE__*/React.createElement("div", {
    onClick: onToggle,
    style: {
      height,
      display: "flex",
      alignItems: "center",
      cursor: onToggle ? "pointer" : "default"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: "stretch",
      display: "flex",
      alignItems: "center",
      padding: "0 12px",
      background: "var(--sv-amber)",
      clipPath: "polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: "var(--sv-stencil-track)",
      textTransform: "uppercase",
      color: "var(--sv-knock)"
    }
  }, "log"), /*#__PURE__*/React.createElement("div", {
    ref: tickerRef,
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "0 14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    "data-sc": true,
    style: {
      flex: "none",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".12em",
      textTransform: "uppercase",
      color: "var(--sv-amber)"
    }
  }, last.tag), /*#__PURE__*/React.createElement("div", {
    "data-sc": true,
    style: {
      font: "var(--sv-body)",
      color: "var(--sv-fg)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, last.text), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      flex: "none",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".12em",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, expanded ? "close" : entries.length + " kept"))));
}
Object.assign(__ds_scope, { Lever, ActionList, LogStrip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/action/Lever.jsx", error: String((e && e.message) || e) }); }

// components/board/HexTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* A compartment, in the printed language. Four states, and the state is how
   much the drone knows about the cell — so the amount of information on the
   face IS the encoding, backed up by colour and by the band's pattern:

     undetected  nothing. a shape in the dark, no label, no contents
     detected    the name only, on a striped band — we have a label, not a look
     monitored   the name and everything in it, on a solid band
     current     the drone is inside. same again, amber, drone crowning the hex

   There is no action list. Every object on the board is its own affordance:
   hover it for what it is and what you could do to it, click it to do the
   obvious thing. You cannot attack a crate, so a crate never offers attack —
   the verb comes from the object and where the drone is standing, which means
   the interface never has to enumerate verbs you were not going to use. */
const STATE = {
  undetected: {
    line: "var(--sv-rule)",
    fill: "var(--sv-knock)",
    band: null,
    knows: "nothing"
  },
  detected: {
    line: "var(--sv-bulkhead)",
    fill: "var(--sv-void)",
    band: "repeating-linear-gradient(90deg, var(--sv-soft) 0 5px, #7d8891 5px 10px)",
    knows: "name"
  },
  monitored: {
    line: "var(--sv-zone)",
    fill: "var(--sv-deck)",
    band: "var(--sv-zone)",
    knows: "all"
  },
  current: {
    line: "var(--sv-amber)",
    fill: "color-mix(in oklab, var(--sv-amber) 16%, var(--sv-deck))",
    band: "var(--sv-amber)",
    knows: "all",
    strong: true
  }
};

/* Room properties, on a separate channel from knowledge: a dashed ring inside
   the hex whose rhythm — not just its colour — says which. */
const PROP = {
  hazard: {
    c: "var(--sv-bad)",
    dash: [6, 4],
    fill: "var(--sv-red-wash)",
    name: "hazard"
  },
  vacuum: {
    c: "var(--sv-zone)",
    dash: [15, 7],
    name: "no atmo"
  },
  dark: {
    c: "var(--sv-soft)",
    dash: [3, 10],
    name: "unpowered"
  },
  alarmed: {
    c: "var(--sv-warn)",
    dash: [4, 3],
    fill: "var(--sv-amber-wash)",
    name: "alarmed"
  }
};

/* Contents are shapes, not letters, and each knows its own verbs. `near` is
   what the drone can do from the next compartment; `at` needs it standing here. */
const KIND = {
  scout: {
    shape: "polygon(50% 0,100% 100%,0 100%)",
    hostile: true,
    name: "scout",
    at: "attack",
    near: "watch",
    note: "melee · 3/3"
  },
  feral: {
    shape: "polygon(50% 0,100% 50%,50% 100%,0 50%)",
    hostile: true,
    name: "feral drone",
    at: "attack",
    near: "watch",
    note: "melee · 3/3"
  },
  sentry: {
    shape: "polygon(50% 0,100% 35%,82% 100%,18% 100%,0 35%)",
    hostile: true,
    name: "sentry",
    at: "attack",
    near: "watch",
    note: "fixed · 5/5"
  },
  crate: {
    shape: null,
    name: "cargo crate",
    at: "take",
    near: null,
    note: "8 cr"
  },
  terminal: {
    shape: "polygon(0 0,100% 0,100% 72%,62% 72%,62% 100%,38% 100%,38% 72%,0 72%)",
    name: "terminal",
    at: "read",
    near: null,
    note: "1 turn"
  },
  machine: {
    shape: "circle(50%)",
    name: "machine",
    at: "strip",
    near: null,
    note: "2 turns"
  }
};
function knowsOf(state) {
  return (STATE[state] || STATE.monitored).knows;
}

/**
 * The knowledge model, exposed so nothing has to re-derive it — a readout must
 * never out-know the board. Capitalised because that is what the design system
 * puts on its namespace.
 *
 *   Knowledge.of(state)    "nothing" | "name" | "all"
 *   Knowledge.name(room)   the room's name, or null if it is not yours to know
 */
const Knowledge = {
  of: knowsOf,
  name(room) {
    if (!room) return null;
    return knowsOf(room.state) === "nothing" ? null : room.name || null;
  }
};
const RATIO = 1.1547; // pointy-top: point-to-point height over flat-to-flat width
const HEX = "var(--sv-hex)";
const PTS = "50,1.5 98.5,29.7 98.5,85.8 50,113.9 1.5,85.8 1.5,29.7";

/* A hollow hexagonal outline. fill:none means it draws only the line, so it
   can sit over a cell without hiding anything in it. */
function HexRing({
  stroke,
  width = 2.6,
  dash = null,
  style
}) {
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 100 115.47",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      overflow: "visible",
      pointerEvents: "none",
      ...style
    }
  }, /*#__PURE__*/React.createElement("polygon", {
    points: PTS,
    fill: "none",
    stroke: stroke,
    strokeWidth: width,
    strokeDasharray: dash || undefined,
    vectorEffect: "non-scaling-stroke"
  }));
}

/* A cell can hold nine hostiles and still be 118px wide, so chips are grouped
   by kind and counted rather than drawn one per body. Nine scouts is one
   triangle reading 9 — which is also the more useful sentence.

   Grouping is what bounds the row: there are three hostile kinds and three
   object kinds, so a row is at most three chips whatever the body count. */
function group(list) {
  const out = [],
    by = {};
  list.forEach(c => {
    const k = c.kind;
    if (by[k]) {
      by[k].n++;
      by[k].threat = Math.max(by[k].threat || 0, c.threat || 0);
      /* A chip that stands for several bodies cannot borrow one body's name —
         "scout 1 ×3" names a thing that does not exist. Fall back to the kind. */
      by[k].name = undefined;
      return;
    }
    by[k] = {
      kind: k,
      n: 1,
      threat: c.threat || 0,
      name: c.name
    };
    out.push(by[k]);
  });
  return out;
}

/* Every panel that only exists while you are hovering something. It draws its
   own border out from the middle of each edge and resolves its text out of
   noise, both on mount — so appearing is the animation, and there is no state
   to track. Mark any leaf text with `data-sc` to have it descramble. */
function Popover({
  tone = "var(--sv-amber)",
  children,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const FX = typeof window !== "undefined" ? window.FX || window.DerelictFX : null;
    if (!FX || !ref.current) return;
    const h = FX.scrambleReveal(ref.current.querySelectorAll("[data-sc]"), FX.PRESETS.hover);
    return () => h.cancel();
  }, []);
  const line = o => ({
    position: "absolute",
    background: tone,
    zIndex: 3,
    pointerEvents: "none",
    transformOrigin: "center",
    animation: "sv-draw-" + (o.height ? "x" : "y") + " var(--sv-frame) var(--sv-step) 1 both",
    ...o
  });
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: "relative",
      background: "var(--sv-knock)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: line({
      left: 0,
      right: 0,
      top: 0,
      height: 2
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: line({
      left: 0,
      right: 0,
      bottom: 0,
      height: 2
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: line({
      top: 0,
      bottom: 0,
      left: 0,
      width: 2
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: line({
      top: 0,
      bottom: 0,
      right: 0,
      width: 2
    })
  }), children);
}

/* The compressed readout. Everything a hover is allowed to say: what it is,
   how many, how dangerous, and the one verb a click would spend. */
function Readout({
  item,
  here = true,
  style
}) {
  const k = KIND[item.kind] || KIND.machine;
  const verb = here ? k.at : k.near;
  const tone = k.hostile ? "var(--sv-bad)" : "var(--sv-amber)";
  return /*#__PURE__*/React.createElement(Popover, {
    tone: tone,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 10px",
      whiteSpace: "nowrap",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    "data-sc": true,
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".12em",
      textTransform: "uppercase",
      color: k.hostile ? "color-mix(in oklab, var(--sv-bad) 26%, var(--sv-ink))" : "var(--sv-ink)"
    }
  }, (item.name || k.name) + (item.n > 1 ? " ×" + item.n : "")), k.hostile ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 3
    }
  }, [0, 1, 2].map(i => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 7,
      height: 12,
      background: i < (item.threat || 1) ? "var(--sv-bad)" : "var(--sv-plate-lit)"
    }
  }))) : /*#__PURE__*/React.createElement("span", {
    "data-sc": true,
    style: {
      font: "var(--sv-body)",
      color: "var(--sv-soft)"
    }
  }, k.note), verb ? /*#__PURE__*/React.createElement("span", {
    "data-sc": true,
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      background: tone,
      color: "var(--sv-knock)",
      padding: "2px 6px"
    }
  }, verb) : /*#__PURE__*/React.createElement("span", {
    "data-sc": true,
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, "go there first"));
}
function Chip({
  item,
  size,
  here,
  onEnter,
  onLeave,
  onAct
}) {
  const k = KIND[item.kind] || KIND.machine;
  const c = k.hostile ? "var(--sv-bad)" : "var(--sv-amber)";
  const can = here ? k.at : k.near;
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: onEnter,
    onMouseLeave: onLeave,
    onClick: can && onAct ? e => {
      e.stopPropagation();
      onAct(can, item);
    } : undefined,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 3,
      cursor: can && onAct ? "pointer" : "help"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: size,
      height: size,
      flex: "none",
      background: c,
      clipPath: k.shape || undefined
    }
  }), item.n > 1 ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: 0,
      lineHeight: 1,
      color: k.hostile ? "color-mix(in oklab, var(--sv-bad) 26%, var(--sv-ink))" : "var(--sv-amber-hi)"
    }
  }, item.n) : null);
}
function HexTile({
  name,
  id,
  contents = [],
  props = [],
  state = "monitored",
  size = 118,
  step = null,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onAct,
  hot = false,
  style
}) {
  const s = STATE[state] || STATE.monitored;
  const [tip, setTip] = React.useState(null);
  const [seq, setSeq] = React.useState(0);
  const show = c => {
    setTip(c);
    setSeq(n => n + 1);
  };
  const h = Math.round(size * RATIO);
  const here = state === "current";
  const shows = s.knows === "all";
  const named = knowsOf(state) !== "nothing" && name;
  const rings = (shows ? props : []).slice(0, 1).map(p => PROP[p]).filter(Boolean);
  const wash = rings.map(r => r.fill).filter(Boolean)[0];
  const fill = wash || s.fill;
  const loot = shows ? group(contents.filter(c => !(KIND[c.kind] || {}).hostile)) : [];
  const foes = shows ? group(contents.filter(c => (KIND[c.kind] || {}).hostile)) : [];
  /* The band is the hex's full inset width, so the budget is the assembled
     line against the band — not each word. */
  const chars = Math.floor((size - 8) / 8.4);
  const fit = named ? String(name).length > chars ? String(name).slice(0, chars) : String(name) : "";
  const base = s.strong || hot ? 2.5 : 1.5;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: onMouseEnter,
    onMouseLeave: onMouseLeave
    /* Board stacking, fixed: doors 1-3 < tiles 4-5 < raised tile 40 <
       drone 50 < popovers 60. The crown straddles its room's top edge, so a
       raised tile must stay under it. */,
    style: {
      position: "relative",
      width: size,
      height: h,
      pointerEvents: "none",
      ...style,
      zIndex: tip ? 40 : (style || {}).zIndex
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      clipPath: HEX,
      pointerEvents: "auto",
      cursor: onClick ? "pointer" : "default",
      zIndex: 5
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      clipPath: HEX,
      background: s.line,
      opacity: state === "undetected" ? .55 : 1
    }
  }), hot ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      animation: "sv-hex-grow var(--sv-frame) var(--sv-step) 1 both",
      pointerEvents: "none",
      zIndex: 3
    }
  }, /*#__PURE__*/React.createElement(HexRing, {
    stroke: "var(--sv-rim)",
    width: 3
  })) : null, step ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      animation: "sv-step-in var(--sv-frame) var(--sv-step) " + (step.n - 1) * 112 + "ms 1 both",
      pointerEvents: "none",
      zIndex: 3
    }
  }, /*#__PURE__*/React.createElement(HexRing, {
    stroke: "var(--sv-amber)",
    width: step.last ? 3.4 : 2.6,
    dash: step.last ? null : "7 6"
  })) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: base,
      clipPath: HEX,
      background: fill
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: base,
      clipPath: HEX,
      background: "var(--sv-scan)"
    }
  }), rings.map((r, i) => {
    const at = base + 6 + i * 7;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        inset: at,
        clipPath: HEX,
        background: `repeating-linear-gradient(90deg, ${r.c} 0 ${r.dash[0]}px, transparent ${r.dash[0]}px ${r.dash[0] + r.dash[1]}px)`
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        inset: at + 3,
        clipPath: HEX,
        background: fill
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        inset: at + 3,
        clipPath: HEX,
        background: "var(--sv-scan)"
      }
    }));
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: base,
      clipPath: HEX,
      pointerEvents: "auto",
      zIndex: 6,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 20,
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, loot.map((c, i) => /*#__PURE__*/React.createElement(Chip, {
    key: i,
    item: c,
    size: 15,
    here: here,
    onAct: onAct,
    onEnter: () => show(c),
    onLeave: () => setTip(null)
  }))), s.band ? /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: "stretch",
      background: s.band,
      padding: "3px 0",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: 0,
      textTransform: "uppercase",
      color: "var(--sv-knock)",
      whiteSpace: "nowrap"
    }
  }, fit)) : /*#__PURE__*/React.createElement("div", {
    style: {
      height: 20
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 22,
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, foes.map((c, i) => /*#__PURE__*/React.createElement(Chip, {
    key: i,
    item: c,
    size: 17,
    here: here,
    onAct: onAct,
    onEnter: () => show(c),
    onLeave: () => setTip(null)
  })))), tip ? /*#__PURE__*/React.createElement(Readout, {
    key: seq,
    item: tip,
    here: here,
    style: {
      position: "absolute",
      left: size + 10,
      top: "50%",
      transform: "translateY(-50%)",
      zIndex: 60,
      pointerEvents: "none"
    }
  }) : null);
}

/* A body in transit. Same silhouette as its chip, so the thing that arrives is
   recognisably the thing that left. */
const MoverMark = React.forwardRef(function MoverMark({
  kind = "scout",
  size = 19,
  style
}, ref) {
  const k = KIND[kind] || KIND.machine;
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    "data-face": "\u25AA",
    style: {
      position: "relative",
      width: size,
      height: size,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    "data-fx-face": true,
    style: {
      width: "100%",
      height: "100%",
      background: k.hostile ? "var(--sv-bad)" : "var(--sv-amber)",
      clipPath: k.shape || undefined,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: 0,
      lineHeight: 1,
      color: "var(--sv-knock)"
    }
  }));
});

/* The drone it WOULD be, at the end of a previewed route. Hollow rather than
   solid so it never reads as where the drone actually is, and struck through
   when the route cannot be walked. */
function DroneGhost({
  size = 40,
  blocked = false,
  style
}) {
  const c = blocked ? "var(--sv-bad)" : "var(--sv-amber)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: size,
      height: Math.round(size * RATIO),
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 100 115.47",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      overflow: "visible"
    }
  }, /*#__PURE__*/React.createElement("polygon", {
    points: PTS,
    fill: "var(--sv-knock)",
    fillOpacity: ".72",
    stroke: c,
    strokeWidth: "3",
    strokeDasharray: blocked ? null : "8 6",
    vectorEffect: "non-scaling-stroke"
  }), blocked ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "22",
    y1: "28",
    x2: "78",
    y2: "88",
    stroke: c,
    strokeWidth: "3.4",
    vectorEffect: "non-scaling-stroke"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "78",
    y1: "28",
    x2: "22",
    y2: "88",
    stroke: c,
    strokeWidth: "3.4",
    vectorEffect: "non-scaling-stroke"
  })) : null), !blocked ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: 0,
      color: c
    }
  }, "\u25C6") : null);
}

/* The drone crowns the hex it is in, so it never competes with the cell's own
   contents for the middle. */
const DroneMark = React.forwardRef(function DroneMark({
  size = 40,
  style
}, ref) {
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: "relative",
      width: size,
      height: Math.round(size * RATIO),
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      clipPath: HEX,
      background: "var(--sv-amber)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    "data-fx-face": true,
    style: {
      position: "absolute",
      inset: 3,
      clipPath: HEX,
      background: "var(--sv-knock)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: 0,
      color: "var(--sv-amber)"
    }
  }, "\u25C6"));
});

/* Which door states the drone can simply walk through. Everything else is a
   thing to be done first, not a route. */
const PASSABLE = {
  open: 1,
  airlock: 1
};

/* A door is the one board object with more than one sensible verb, so it is
   the one that offers a choice — on hover, and only on hover. */
const DOOR = {
  open: {
    c: "var(--sv-zone)",
    bars: 0,
    verbs: [["close", "free"], ["weld shut", "cutter · 2 turns"]]
  },
  closed: {
    c: "var(--sv-bulkhead)",
    bars: 1,
    verbs: [["open", "free"], ["force", "loud"], ["weld shut", "cutter · 2 turns"]]
  },
  locked: {
    c: "var(--sv-amber)",
    bars: 2,
    verbs: [["unlock", "needs a key"], ["force", "loud · 1 turn"], ["cut open", "cutter · 2 turns"]]
  },
  sealed: {
    c: "var(--sv-burned)",
    bars: 3,
    verbs: [["cut open", "cutter · 3 turns"]]
  },
  airlock: {
    c: "var(--sv-airlock)",
    bars: 0,
    lock: true,
    verbs: [["cycle", "1 turn"], ["leave the hull", "ends the sortie"]]
  }
};

/* Owns the geometry, the camera and the board's interactions: pointy-top hexes
   on offset rows, corridors centre to centre beneath them, right-drag pan. */
function HexMap({
  rooms = [],
  links = [],
  drone,
  size = 118,
  spread = 1.3,
  doorStyle = "rungs",
  hint = true,
  plan = null,
  moves = null,
  onSelect,
  onHoverRoom,
  onAct,
  onDoorAct,
  onMovesDone,
  renderHover,
  style
}) {
  const [pan, setPan] = React.useState({
    x: 0,
    y: 0
  });
  const [hover, setHover] = React.useState(null);
  const [door, setDoor] = React.useState(null);
  const [barred, setBarred] = React.useState(null);
  const [moving, setMoving] = React.useState(null);
  const droneRef = React.useRef(null);
  const moveFx = React.useRef(null);
  const movers = React.useRef({});
  const moveKey = (moves || []).map(m => (m.id || "") + m.from + ">" + m.to).join("|");
  React.useEffect(() => () => {
    if (moveFx.current) moveFx.current.cancel();
  }, []);

  /* Play every reported relocation at once — a watch passes for all of them
     together, so they should not queue up one after another. */
  React.useEffect(() => {
    if (!moves || !moves.length) return;
    const FX = window.FX || window.DerelictFX;
    if (!FX) {
      if (onMovesDone) onMovesDone();
      return;
    }
    let left = moves.length,
      cancelled = false;
    const hs = moves.map((m, i) => {
      const el = movers.current[m.id || i];
      const to = byId[m.to];
      if (!el || !to) {
        left--;
        return null;
      }
      const c = centre(to);
      return FX.teleport(el, {
        left: c.x - 9,
        top: c.y - 9
      }, {
        faceEl: el.querySelector("[data-fx-face]"),
        label: "",
        onDone: () => {
          if (!cancelled && --left <= 0 && onMovesDone) onMovesDone();
        }
      });
    }).filter(Boolean);
    if (!left && onMovesDone) onMovesDone();
    return () => {
      cancelled = true;
      hs.forEach(x => x && x.cancel());
    };
  }, [moveKey]);
  const [dseq, setDseq] = React.useState(0);
  const hoverTimer = React.useRef(null);
  const holdHover = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const dropHover = () => {
    holdHover();
    hoverTimer.current = setTimeout(() => {
      setHover(null);
      setBarred(null);
      if (onHoverRoom) onHoverRoom(null);
    }, 450);
  };
  const doorTimer = React.useRef(null);
  const holdDoor = () => {
    if (doorTimer.current) {
      clearTimeout(doorTimer.current);
      doorTimer.current = null;
    }
  };
  const openDoor = i => {
    holdDoor();
    setDoor(i);
    setDseq(n => n + 1);
  };
  /* A menu offset clear of its door leaves a gap the pointer must cross, and
     leaving the door was closing the menu before the pointer arrived. Two
     frames of grace: long enough to cross, short enough never to feel stuck. */
  const dropDoor = () => {
    holdDoor();
    doorTimer.current = setTimeout(() => setDoor(null), 450);
  };
  React.useEffect(() => () => {
    holdDoor();
    holdHover();
  }, []);
  const drag = React.useRef(null);
  const W = size * spread,
    H = size * RATIO * spread,
    ROW = H * 0.75;
  const centre = r => ({
    x: (r.q + (r.r % 2 ? 0.5 : 0)) * W + W / 2,
    y: r.r * ROW + H / 2
  });
  const byId = {};
  rooms.forEach(r => {
    byId[r.id] = r;
  });
  const maxQ = Math.max(0, ...rooms.map(r => r.q)),
    maxR = Math.max(0, ...rooms.map(r => r.r));
  const bw = (maxQ + 1.5) * W + W / 2,
    bh = maxR * ROW + H;
  const hexH = Math.round(size * RATIO);
  const here = drone ? byId[drone] : null;

  /* The walk from the drone to a room, and whether it can actually be walked.
     Only an open door or a cycled airlock is a route — a closed, locked or
     sealed one has to be dealt with first — so the preview is planned twice:
     over passable doors, and, when that fails, over every door, so it can say
     which door is in the way rather than just refusing. */
  const walk = React.useMemo(() => {
    if (plan) return {
      path: plan,
      blocked: null
    };
    if (!hover || !drone || hover === drone) return null;
    const search = passableOnly => {
      const adj = {};
      links.forEach(l => {
        if (passableOnly && !PASSABLE[l.state || "closed"]) return;
        (adj[l.a] = adj[l.a] || []).push(l.b);
        (adj[l.b] = adj[l.b] || []).push(l.a);
      });
      const prev = {},
        seen = {
          [drone]: 1
        },
        q = [drone];
      while (q.length) {
        const at = q.shift();
        if (at === hover) break;
        (adj[at] || []).forEach(n => {
          if (seen[n]) return;
          seen[n] = 1;
          prev[n] = at;
          q.push(n);
        });
      }
      if (!seen[hover]) return null;
      const out = [];
      let at = hover;
      while (at !== drone) {
        out.unshift(at);
        at = prev[at];
        if (!at) return null;
      }
      return out;
    };
    const clear = search(true);
    if (clear) return {
      path: clear,
      blocked: null
    };
    const any = search(false);
    if (!any) return null;
    /* The first shut door along the way is the one to point at. */
    const full = [drone, ...any];
    let blocked = null;
    for (let i = 0; i < full.length - 1 && blocked === null; i++) {
      const n = links.findIndex(l => l.a === full[i] && l.b === full[i + 1] || l.b === full[i] && l.a === full[i + 1]);
      if (n >= 0 && !PASSABLE[links[n].state || "closed"]) blocked = n;
    }
    return {
      path: any,
      blocked
    };
  }, [plan, hover, drone, links]);
  const route = walk ? walk.path : null;
  const blockedDoor = walk ? walk.blocked : null;

  /* Where a board point lands once the pan is applied. */
  const at = (x, y) => ({
    left: "calc(50% + " + (pan.x + x - bw / 2) + "px)",
    top: "calc(50% + " + (pan.y + y - bh / 2) + "px)"
  });

  /* Move the drone along a cleared route, one teleport per compartment: it
     dissolves out of each room and reassembles in the next, so a three-room
     move reads as three hops and the path is still legible. The pip is placed
     imperatively while it plays so React is not fighting the animation; the
     parent commits the new position when it lands. */
  const hop = (el, ids, i, onEnd) => {
    const FX = window.FX || window.DerelictFX;
    const c = centre(byId[ids[i]]);
    return FX.teleport(el, {
      left: c.x - 20,
      top: c.y - hexH / 2 - 24
    }, {
      faceEl: el.querySelector("[data-fx-face]"),
      label: el.dataset.face || "◆",
      onDone: () => {
        if (i + 1 < ids.length) {
          moveFx.current = hop(el, ids, i + 1, onEnd);
          return;
        }
        onEnd();
      }
    });
  };
  const move = path => {
    const FX = typeof window !== "undefined" ? window.FX || window.DerelictFX : null;
    const el = droneRef.current;
    const dest = path[path.length - 1];
    if (!FX || !el) {
      if (onSelect) onSelect(dest);
      return;
    }
    if (moveFx.current) moveFx.current.cancel();
    setMoving(path);
    moveFx.current = hop(el, path, 0, () => {
      setMoving(null);
      if (onSelect) onSelect(dest);
    });
  };

  /* What clicking a given room would do. The single source for the verb shown
     and the action taken. */
  const intentFor = id => {
    if (id === drone) return "here";
    if (hover !== id) return null;
    if (blockedDoor != null) return "blocked";
    if (route && route.length) return "move";
    return "none";
  };
  const step = id => route ? route.indexOf(id) : -1;
  const onRoute = (a, b) => {
    if (!route) return -1;
    const walk = [drone, ...route];
    for (let i = 0; i < walk.length - 1; i++) {
      if (walk[i] === a && walk[i + 1] === b || walk[i] === b && walk[i + 1] === a) return i;
    }
    return -1;
  };
  const onDown = e => {
    if (e.button !== 2) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      px: pan.x,
      py: pan.y
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = e => {
    const d = drag.current;
    if (!d) return;
    setPan({
      x: d.px + (e.clientX - d.x),
      y: d.py + (e.clientY - d.y)
    });
  };
  const onUp = e => {
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}
  };
  return /*#__PURE__*/React.createElement("div", {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
    onContextMenu: e => e.preventDefault(),
    onDoubleClick: () => setPan({
      x: 0,
      y: 0
    }),
    style: {
      position: "relative",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      touchAction: "none",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: bw,
      height: bh,
      transform: `translate(-50%,-50%) translate(${pan.x}px,${pan.y}px)`
    }
  }, links.map((l, i) => {
    const a = byId[l.a],
      b = byId[l.b];
    if (!a || !b) return null;
    const p = centre(a),
      q = centre(b);
    const len = Math.hypot(q.x - p.x, q.y - p.y),
      ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    const d = DOOR[l.state] || DOOR.closed;
    const mid = {
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2
    };
    const ux = (q.x - p.x) / len,
      uy = (q.y - p.y) / len;
    const reach = l.a === drone || l.b === drone;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      onMouseEnter: () => openDoor(i),
      onMouseLeave: dropDoor,
      style: {
        position: "absolute",
        left: p.x,
        top: p.y - 9,
        width: len,
        height: 18,
        transform: `rotate(${ang}deg)`,
        transformOrigin: "0 50%",
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        cursor: "help"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        left: 0,
        right: 0,
        top: "50%",
        height: 11,
        transform: "translateY(-50%)",
        background: "var(--sv-deck)"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        left: 0,
        right: 0,
        top: "50%",
        height: 2,
        transform: "translateY(-50%)",
        background: d.c,
        opacity: d.bars ? .7 : .9
      }
    }), (() => {
      const n = onRoute(l.a, l.b);
      if (n < 0) return null;
      const shut = blockedDoor === i,
        c = shut ? "var(--sv-bad)" : "var(--sv-amber)";
      return /*#__PURE__*/React.createElement("div", {
        style: {
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: 12,
          transform: "translateY(-50%)",
          animation: "sv-step-in var(--sv-frame) var(--sv-step) " + n * 112 + "ms 1 both"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 2,
          background: c
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          background: c
        }
      }));
    })(), Array.from({
      length: d.bars
    }).map((_, n) => /*#__PURE__*/React.createElement("div", {
      key: n,
      style: {
        position: "relative",
        width: 3,
        height: 17,
        background: d.c
      }
    })), d.lock ? /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        width: 11,
        height: 11,
        background: d.c,
        clipPath: "polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)"
      }
    }) : null), blockedDoor === i || barred === i ? /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        left: mid.x,
        top: mid.y,
        transform: "translate(-50%,-50%) rotate(45deg)",
        width: 25,
        height: 25,
        border: "2.5px solid var(--sv-bad)",
        boxSizing: "border-box",
        zIndex: 9,
        pointerEvents: "none",
        animation: "sv-flick var(--sv-frame-2) var(--sv-step) infinite"
      }
    }) : null, doorStyle === "stencil" && l.label && door !== i ? /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        left: mid.x - uy * 15,
        top: mid.y + ux * 15,
        transform: "translate(-50%,-50%)",
        zIndex: 3,
        font: "var(--sv-stencil)",
        fontSize: 14,
        letterSpacing: ".14em",
        color: d.c,
        pointerEvents: "none",
        whiteSpace: "nowrap"
      }
    }, l.label) : null);
  }), rooms.map(r => {
    const c = centre(r);
    const n = step(r.id);
    return /*#__PURE__*/React.createElement(HexTile, _extends({
      key: r.id
    }, r, {
      size: size,
      hot: hover === r.id,
      step: n < 0 ? null : {
        n: n + 1,
        last: n === route.length - 1
      },
      onMouseEnter: () => {
        if (moving) return;
        holdHover();
        setHover(r.id);
        if (onHoverRoom) onHoverRoom(r.id);
      },
      onMouseLeave: () => {
        if (moving) return;
        dropHover();
      },
      onAct: onAct ? (verb, item) => onAct(r, verb, item) : undefined,
      onClick: () => {
        const intent = intentFor(r.id);
        if (intent === "blocked") {
          setBarred(blockedDoor);
          return;
        }
        setBarred(null);
        if (intent === "move") {
          move(route);
          return;
        }
        if (onSelect) onSelect(r.id);
      },
      style: {
        position: "absolute",
        left: c.x - size / 2,
        top: c.y - hexH / 2,
        zIndex: r.state === "current" ? 5 : 4
      }
    }));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "calc(50% + " + (pan.x - bw / 2) + "px)",
      top: "calc(50% + " + (pan.y - bh / 2) + "px)",
      width: bw,
      height: bh,
      zIndex: 65,
      pointerEvents: "none"
    }
  }, route && route.length && !moving ? (() => {
    const end = byId[route[route.length - 1]];
    if (!end) return null;
    const c = centre(end);
    const blocked = blockedDoor != null;
    return /*#__PURE__*/React.createElement(DroneGhost, {
      key: "ghost",
      blocked: blocked,
      style: {
        position: "absolute",
        left: c.x - 20,
        top: blocked ? c.y - Math.round(20 * RATIO) : c.y - hexH / 2 - 24,
        animation: "sv-step-in var(--sv-frame) var(--sv-step) " + route.length * 112 + "ms 1 both"
      }
    });
  })() : null, here ? (() => {
    const c = centre(here);
    return /*#__PURE__*/React.createElement(DroneMark, {
      key: "drone",
      ref: droneRef,
      style: {
        position: "absolute",
        left: c.x - 20,
        top: c.y - hexH / 2 - 24
      }
    });
  })() : null, (moves || []).map((m, i) => {
    const from = byId[m.from];
    if (!from) return null;
    const c = centre(from);
    return /*#__PURE__*/React.createElement(MoverMark, {
      key: m.id || i,
      kind: m.kind,
      ref: el => {
        movers.current[m.id || i] = el;
      },
      style: {
        position: "absolute",
        left: c.x - 9,
        top: c.y - 9
      }
    });
  })), renderHover && hover && byId[hover] ? (() => {
    const r = byId[hover],
      c = centre(r),
      p = at(c.x + size / 2 + 12, c.y - hexH / 2);
    const flip = pan.x + c.x + size / 2 + 12 + 250 > bw;
    const intent = intentFor(r.id);
    return /*#__PURE__*/React.createElement("div", {
      onMouseEnter: holdHover,
      onMouseLeave: dropHover,
      onClick: () => {
        if (intent === "blocked") {
          setBarred(blockedDoor);
          return;
        }
        if (intent === "move") {
          move(route);
          return;
        }
        if (onSelect) onSelect(r.id);
      },
      style: {
        position: "absolute",
        ...(flip ? at(c.x - size / 2 - 12, c.y - hexH / 2) : p),
        transform: flip ? "translateX(-100%)" : "none",
        zIndex: 70,
        minWidth: 220,
        cursor: intent === "move" ? "pointer" : "default"
      }
    }, renderHover(r, {
      intent,
      path: route,
      blocked: blockedDoor != null ? links[blockedDoor] : null,
      steps: route ? route.length : 0
    }));
  })() : null, door != null && links[door] ? (() => {
    const l = links[door],
      a = byId[l.a],
      b = byId[l.b];
    if (!a || !b) return null;
    const p = centre(a),
      q = centre(b),
      d = DOOR[l.state] || DOOR.closed;
    const reach = l.a === drone || l.b === drone;
    /* Offset along the corridor's own perpendicular, so the menu clears the
       door it describes whichever way that corridor runs. */
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = -(q.y - p.y) / len,
      ny = (q.x - p.x) / len;
    const gap = 26,
      mx = (p.x + q.x) / 2,
      my = (p.y + q.y) / 2;
    const sideways = Math.abs(nx) >= Math.abs(ny);
    const dx = sideways ? nx >= 0 ? gap : -gap : 0,
      dy = sideways ? 0 : ny >= 0 ? gap : -gap;
    const anchor = sideways ? nx >= 0 ? "translate(0,-50%)" : "translate(-100%,-50%)" : ny >= 0 ? "translate(-50%,0)" : "translate(-50%,-100%)";
    return /*#__PURE__*/React.createElement(Popover, {
      key: dseq,
      tone: d.c,
      style: {
        position: "absolute",
        ...at(mx + dx, my + dy),
        transform: anchor,
        zIndex: 70,
        minWidth: 200
      }
    }, /*#__PURE__*/React.createElement("div", {
      onMouseEnter: holdDoor,
      onMouseLeave: dropDoor
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "4px 9px",
        background: d.c
      }
    }, /*#__PURE__*/React.createElement("span", {
      "data-sc": true,
      style: {
        font: "var(--sv-stencil)",
        fontSize: 14,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: "var(--sv-knock)"
      }
    }, l.label || "door"), /*#__PURE__*/React.createElement("span", {
      "data-sc": true,
      style: {
        marginLeft: "auto",
        font: "var(--sv-stencil)",
        fontSize: 14,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: "var(--sv-knock)",
        opacity: .8
      }
    }, l.state)), /*#__PURE__*/React.createElement("div", {
      style: {
        background: "var(--sv-scan)"
      }
    }, d.verbs.map(([v, cost], n) => /*#__PURE__*/React.createElement("div", {
      key: n,
      onClick: reach && onDoorAct ? e => {
        e.stopPropagation();
        onDoorAct(l, v);
      } : undefined,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "4px 9px",
        cursor: reach ? "pointer" : "not-allowed",
        opacity: reach ? 1 : .55
      },
      onMouseEnter: e => {
        if (reach) e.currentTarget.style.background = "color-mix(in oklab, var(--sv-amber) 16%, transparent)";
      },
      onMouseLeave: e => {
        e.currentTarget.style.background = "transparent";
      }
    }, /*#__PURE__*/React.createElement("span", {
      "data-sc": true,
      style: {
        font: "var(--sv-body)",
        color: "var(--sv-ink)"
      }
    }, v), /*#__PURE__*/React.createElement("span", {
      "data-sc": true,
      style: {
        marginLeft: "auto",
        font: "var(--sv-stencil)",
        fontSize: 14,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: "var(--sv-soft)"
      }
    }, cost))), !reach ? /*#__PURE__*/React.createElement("div", {
      "data-sc": true,
      style: {
        padding: "4px 9px",
        font: "var(--sv-stencil)",
        fontSize: 14,
        letterSpacing: ".12em",
        textTransform: "uppercase",
        color: "var(--sv-soft)",
        borderTop: "1px solid var(--sv-line)"
      }
    }, "not from here") : null)));
  })() : null, hint ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: 12,
      bottom: 10,
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--sv-soft)",
      pointerEvents: "none"
    }
  }, "right-drag to pan \xB7 hover a room for the route") : null);
}

/* The same shape the board uses, for panels that list what is in a room. */
function ContentIcon({
  kind,
  size = 15,
  style
}) {
  const k = KIND[kind] || KIND.machine;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: size,
      height: size,
      flex: "none",
      background: k.hostile ? "var(--sv-bad)" : "var(--sv-amber)",
      clipPath: k.shape || undefined,
      ...style
    }
  });
}

/* One row of a compartment's manifest: the same object as on the board, with
   the same verb on the same click. The panel and the cell are two views of one
   set of things, which is why neither needs a list of actions. */
function ObjectRow({
  item,
  here = true,
  onAct,
  style
}) {
  const k = KIND[item.kind] || KIND.machine;
  const [hot, setHot] = React.useState(false);
  const verb = here ? k.at : k.near;
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHot(true),
    onMouseLeave: () => setHot(false),
    onClick: verb && onAct ? () => onAct(verb, item) : undefined,
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "4px 8px",
      cursor: verb && onAct ? "pointer" : "help",
      background: hot ? "color-mix(in oklab, var(--sv-amber) 12%, transparent)" : "transparent",
      ...style
    }
  }, /*#__PURE__*/React.createElement(ContentIcon, {
    kind: item.kind,
    size: 15
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--sv-body)",
      color: "var(--sv-ink)"
    }
  }, (item.name || k.name) + (item.n > 1 ? " ×" + item.n : "")), hot ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".1em",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, k.note), verb ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      background: k.hostile ? "var(--sv-bad)" : "var(--sv-amber)",
      color: "var(--sv-knock)",
      padding: "2px 6px"
    }
  }, verb) : /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, "go there first")) : k.hostile ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 3
    }
  }, [0, 1, 2].map(n => /*#__PURE__*/React.createElement("span", {
    key: n,
    style: {
      width: 7,
      height: 12,
      background: n < (item.threat || 1) ? "var(--sv-bad)" : "var(--sv-plate-lit)"
    }
  }))) : null);
}
Object.assign(__ds_scope, { Knowledge, Popover, Readout, HexTile, MoverMark, DroneGhost, DroneMark, HexMap, ContentIcon, ObjectRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/board/HexTile.jsx", error: String((e && e.message) || e) }); }

// components/chrome/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONE = {
  amber: "var(--sv-amber)",
  good: "var(--sv-good)",
  warn: "var(--sv-warn)",
  bad: "var(--sv-bad)",
  neutral: "var(--sv-rim)"
};

/* Five housings, one component. Each variant answers a different tell from the
   "why it reads as a dashboard" audit — a panel that is mounted, painted,
   implied, bolted, or printed. They are not skins: each changes what material
   the interface claims to be made of. */
function Panel({
  title,
  stencil,
  tone = "amber",
  variant = "plate",
  mount = "right",
  notch = 16,
  hatch = true,
  width,
  fill = false,
  children,
  style
}) {
  const c = TONE[tone] || TONE.amber;
  const V = variant;
  const [hot, setHot] = React.useState(false);

  /* On hover the housing draws its own border out from the middle of each edge,
     in held frames rather than a transition. The title does NOT descramble:
     resolving text is for panels that appear, and this one was already here. */
  const hover = {
    onMouseEnter: () => setHot(true),
    onMouseLeave: () => setHot(false)
  };
  const line = o => ({
    position: "absolute",
    background: c,
    zIndex: 12,
    pointerEvents: "none",
    transformOrigin: "center",
    ...o
  });
  const border = hot ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: line({
      left: 0,
      right: 0,
      top: 0,
      height: 2,
      animation: "sv-draw-x var(--sv-frame) var(--sv-step) 1 both"
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: line({
      left: 0,
      right: 0,
      bottom: 0,
      height: 2,
      animation: "sv-draw-x var(--sv-frame) var(--sv-step) 1 both"
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: line({
      top: 0,
      bottom: 0,
      left: 0,
      width: 2,
      animation: "sv-draw-y var(--sv-frame) var(--sv-step) 1 both"
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: line({
      top: 0,
      bottom: 0,
      right: 0,
      width: 2,
      animation: "sv-draw-y var(--sv-frame) var(--sv-step) 1 both"
    })
  })) : null;
  const head = inner => title || stencil ? inner : null;

  /* ── plate · a housing bolted to a screen edge ─────────────────────────── */
  if (V === "plate") {
    const cut = `polygon(0 0, calc(100% - ${notch}px) 0, 100% ${notch}px, 100% 100%, 0 100%)`;
    const cutIn = `polygon(0 0, calc(100% - ${notch - 1}px) 0, 100% ${notch - 1}px, 100% 100%, 0 100%)`;
    const edges = {
      right: {
        right: 0,
        top: 0,
        bottom: 0,
        width: 2
      },
      left: {
        left: 0,
        top: 0,
        bottom: 0,
        width: 2
      },
      top: {
        left: 0,
        right: 0,
        top: 0,
        height: 2
      },
      bottom: {
        left: 0,
        right: 0,
        bottom: 0,
        height: 2
      },
      none: null
    };
    const edge = edges[mount];
    return /*#__PURE__*/React.createElement("div", _extends({}, hover, {
      style: {
        position: "relative",
        width,
        clipPath: cut,
        background: "linear-gradient(180deg,var(--sv-plate-lit) 0%,var(--sv-plate) 100%)",
        boxShadow: "var(--sv-cast)",
        fontFamily: "var(--sv-font-mono)",
        color: "var(--sv-fg)",
        ...style
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        inset: 1.5,
        clipPath: cutIn,
        background: hatch ? "var(--sv-hatch)" : "var(--sv-deck)"
      }
    }), border, edge ? /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        ...edge,
        background: c,
        opacity: .85
      }
    }) : null, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative"
      }
    }, head(/*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: `linear-gradient(180deg, color-mix(in oklab, ${c} 22%, transparent) 0%, transparent 100%)`,
        borderBottom: `1px solid color-mix(in oklab, ${c} 45%, transparent)`
      }
    }, title ? /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--sv-title)",
        letterSpacing: "var(--sv-title-track)",
        textTransform: "uppercase",
        color: "var(--sv-ink)",
        textShadow: "0 1px 0 rgba(0,0,0,.6)"
      }
    }, title) : null, stencil ? /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        font: "var(--sv-stencil)",
        letterSpacing: "var(--sv-stencil-track)",
        textTransform: "uppercase",
        color: c
      }
    }, stencil) : null)), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 14px 14px"
      }
    }, children)));
  }

  /* ── stencil · no housing. The label is painted on the hull itself ─────── */
  if (V === "stencil") {
    const tick = (a, b) => ({
      position: "absolute",
      [a]: 0,
      [b]: 0,
      width: 10,
      height: 10,
      borderTop: a === "top" ? `1px solid ${c}` : "none",
      borderBottom: a === "bottom" ? `1px solid ${c}` : "none",
      borderLeft: b === "left" ? `1px solid ${c}` : "none",
      borderRight: b === "right" ? `1px solid ${c}` : "none",
      opacity: .7
    });
    return /*#__PURE__*/React.createElement("div", _extends({}, hover, {
      style: {
        position: "relative",
        width,
        padding: "2px",
        fontFamily: "var(--sv-font-mono)",
        color: "var(--sv-fg)",
        ...style
      }
    }), border, /*#__PURE__*/React.createElement("div", {
      style: tick("top", "left")
    }), /*#__PURE__*/React.createElement("div", {
      style: tick("top", "right")
    }), /*#__PURE__*/React.createElement("div", {
      style: tick("bottom", "left")
    }), /*#__PURE__*/React.createElement("div", {
      style: tick("bottom", "right")
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 16px 14px"
      }
    }, head(/*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 12
      }
    }, title ? /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--sv-display)",
        fontSize: 27,
        letterSpacing: ".12em",
        textTransform: "uppercase",
        color: "var(--sv-ink)",
        whiteSpace: "nowrap"
      }
    }, title) : null, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 3,
        background: `repeating-linear-gradient(90deg, ${c} 0 7px, transparent 7px 11px)`,
        opacity: .8
      }
    }), stencil ? /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--sv-stencil)",
        letterSpacing: "var(--sv-stencil-track)",
        textTransform: "uppercase",
        color: c,
        whiteSpace: "nowrap"
      }
    }, stencil) : null)), children));
  }

  /* ── bracket · the frame is implied, never drawn ───────────────────────── */
  if (V === "bracket") {
    const br = (v, h) => ({
      position: "absolute",
      [v]: 0,
      [h]: 0,
      width: 20,
      height: 20,
      [v === "top" ? "borderTop" : "borderBottom"]: `2px solid ${c}`,
      [h === "left" ? "borderLeft" : "borderRight"]: `2px solid ${c}`
    });
    return /*#__PURE__*/React.createElement("div", _extends({}, hover, {
      style: {
        position: "relative",
        width,
        background: "radial-gradient(ellipse 120% 100% at 50% 0%, color-mix(in oklab, var(--sv-deck) 88%, var(--sv-plate)) 0%, var(--sv-deep) 86%)",
        fontFamily: "var(--sv-font-mono)",
        color: "var(--sv-fg)",
        ...style
      }
    }), border, /*#__PURE__*/React.createElement("div", {
      style: br("top", "left")
    }), /*#__PURE__*/React.createElement("div", {
      style: br("top", "right")
    }), /*#__PURE__*/React.createElement("div", {
      style: br("bottom", "left")
    }), /*#__PURE__*/React.createElement("div", {
      style: br("bottom", "right")
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "14px 20px 16px"
      }
    }, head(/*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        marginBottom: 13
      }
    }, title ? /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--sv-title)",
        letterSpacing: ".2em",
        textTransform: "uppercase",
        color: "var(--sv-ink)",
        textAlign: "center"
      }
    }, title) : null, stencil ? /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--sv-stencil)",
        letterSpacing: "var(--sv-stencil-track)",
        textTransform: "uppercase",
        color: c
      }
    }, stencil) : null, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 40,
        height: 1,
        background: c,
        opacity: .6
      }
    }))), children));
  }

  /* ── riveted · real material, top-lit, bolted, with a recessed well ───── */
  if (V === "riveted") {
    const rivet = top => ({
      position: "absolute",
      left: 5,
      top,
      width: 7,
      height: 7,
      borderRadius: "50%",
      background: "radial-gradient(circle at 35% 30%, var(--sv-rim) 0%, var(--sv-plate) 62%, var(--sv-deep) 100%)"
    });
    return /*#__PURE__*/React.createElement("div", _extends({}, hover, {
      style: {
        position: "relative",
        width,
        background: "linear-gradient(180deg,var(--sv-plate-hi) 0%,var(--sv-plate) 42%,var(--sv-deck) 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.18), inset 0 -1px 0 rgba(0,0,0,.5), var(--sv-cast)",
        fontFamily: "var(--sv-font-mono)",
        color: "var(--sv-fg)",
        ...style
      }
    }), border, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 18,
        background: "linear-gradient(90deg, rgba(255,255,255,.06) 0%, transparent 100%)",
        borderRight: "1px solid rgba(0,0,0,.45)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: rivet(12)
    }), /*#__PURE__*/React.createElement("div", {
      style: rivet("50%")
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        ...rivet(0),
        top: "auto",
        bottom: 12
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: 18
      }
    }, head(/*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: "linear-gradient(180deg, var(--sv-deep) 0%, var(--sv-deck) 100%)",
        boxShadow: "inset 0 2px 4px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.08)"
      }
    }, title ? /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--sv-title)",
        letterSpacing: "var(--sv-title-track)",
        textTransform: "uppercase",
        color: "var(--sv-ink)",
        textShadow: "0 -1px 0 rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.1)"
      }
    }, title) : null, stencil ? /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        font: "var(--sv-stencil)",
        letterSpacing: "var(--sv-stencil-track)",
        textTransform: "uppercase",
        color: c
      }
    }, stencil) : null)), /*#__PURE__*/React.createElement("div", {
      style: {
        margin: "10px 12px 12px",
        padding: "12px 13px",
        background: "var(--sv-deep)",
        boxShadow: "inset 0 2px 5px rgba(0,0,0,.7), inset 0 -1px 0 rgba(255,255,255,.05)"
      }
    }, children)));
  }

  /* ── readout · the machine's own printout, addressed to the crew ───────── */
  const cut = `polygon(0 0, 100% 0, 100% 100%, ${notch}px 100%, 0 calc(100% - ${notch}px))`;
  return /*#__PURE__*/React.createElement("div", _extends({}, hover, {
    style: {
      position: "relative",
      width,
      clipPath: cut,
      background: "var(--sv-deep)",
      boxShadow: "var(--sv-cast)",
      fontFamily: "var(--sv-font-mono)",
      color: "var(--sv-fg)",
      ...(fill ? {
        display: "flex",
        flexDirection: "column"
      } : null),
      ...style
    }
  }), border, head(/*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "3px 12px",
      background: c
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--sv-title)",
      letterSpacing: "var(--sv-title-track)",
      textTransform: "uppercase",
      color: "var(--sv-knock)"
    }
  }, title) : null, stencil ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      font: "var(--sv-stencil)",
      letterSpacing: "var(--sv-stencil-track)",
      textTransform: "uppercase",
      color: "var(--sv-knock)",
      opacity: .78
    }
  }, stencil) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 8,
      height: 15,
      background: "var(--sv-knock)"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      padding: "12px 14px 15px",
      ...(fill ? {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column"
      } : null)
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--sv-scan)",
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      ...(fill ? {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column"
      } : null)
    }
  }, children)));
}

/* Printed label. A tag is a stamp: ink knocked out of a solid fill, one corner
   clipped like the panels. Quiet tags print on a wash instead of the accent. */
function Tag({
  tone = "neutral",
  solid = false,
  children,
  style
}) {
  const c = TONE[tone] || TONE.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-block",
      padding: "4px 8px",
      font: "var(--sv-stencil)",
      letterSpacing: "var(--sv-stencil-track)",
      textTransform: "uppercase",
      clipPath: "polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",
      background: solid ? c : `color-mix(in oklab, ${c} 24%, var(--sv-knock))`,
      color: solid ? "var(--sv-knock)" : c,
      ...style
    }
  }, children);
}

/* A menu is a housing that arrives over the board: the same printed language,
   one column of rows, and — when it is a page rather than the root menu — a
   way back. Nothing here is a dialog; it is a plate bolted over the view. */
function MenuSheet({
  title,
  stencil,
  rows = [],
  onBack,
  onClose,
  width = 340,
  leaving = false,
  drawer = false,
  children,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (leaving) return;
    const FX = typeof window !== "undefined" ? window.FX || window.DerelictFX : null;
    if (!FX || !ref.current) return;
    let nodes = Array.from(ref.current.querySelectorAll("[data-sc]"));
    if (!nodes.length) {
      /* Every leaf that holds text — a node whose children are all text — so
         the whole sheet resolves whatever the caller passed as children. */
      nodes = Array.from(ref.current.querySelectorAll("div,span,p")).filter(el => {
        if (!el.textContent.trim()) return false;
        return Array.from(el.childNodes).every(n => n.nodeType === 3);
      });
    }
    const h = FX.scrambleReveal(nodes, FX.PRESETS.sheet || FX.PRESETS.panel);
    return () => h.cancel();
  }, [leaving]);
  const slide = drawer ? {
    animation: (leaving ? "sv-slide-out" : "sv-slide-in") + " var(--sv-frame) var(--sv-step) 1 both"
  } : null;
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: "relative",
      ...slide,
      ...(drawer ? {
        height: "100%"
      } : null)
    }
  }, onClose ? /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    title: "close",
    style: {
      position: "absolute",
      right: 0,
      top: 0,
      width: 30,
      height: 30,
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      font: "var(--sv-stencil)",
      fontSize: 17,
      letterSpacing: 0,
      lineHeight: 1,
      color: "var(--sv-knock)"
    }
  }, "\xD7") : null, /*#__PURE__*/React.createElement(Panel, {
    variant: "printed",
    title: title,
    mount: "none",
    width: width,
    fill: drawer,
    style: drawer ? {
      height: "100%",
      ...style
    } : style
  }, children, rows.length ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    onClick: r.onPick,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "7px 9px",
      cursor: "pointer",
      background: "transparent"
    },
    onMouseEnter: e => {
      e.currentTarget.style.background = "color-mix(in oklab, var(--sv-amber) 16%, transparent)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = "transparent";
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 13,
      flex: "none",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: 0,
      color: "var(--sv-amber)"
    }
  }, r.key || "·"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--sv-body)",
      color: "var(--sv-ink)"
    }
  }, r.label), r.note ? /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".1em",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, r.note) : null))) : null, onBack ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      marginTop: "auto",
      paddingTop: 12,
      borderTop: "1px solid var(--sv-line)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: onBack,
    style: {
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      background: "var(--sv-amber)",
      color: "var(--sv-knock)",
      padding: "3px 9px",
      cursor: "pointer"
    }
  }, "back")) : null));
}

/* The left rail: printed keys on a flat strip. The active one is knocked out. */
function Rail({
  items = [],
  active,
  onSelect,
  width = 46,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      background: "var(--sv-knock)",
      borderRight: "1px solid var(--sv-line)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "10px 0",
      gap: 6,
      ...style
    }
  }, items.map((it, i) => {
    const on = active === (it.id != null ? it.id : i);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      title: it.title,
      onClick: () => onSelect && onSelect(it.id != null ? it.id : i),
      style: {
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        clipPath: "polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",
        background: on ? "var(--sv-amber)" : "var(--sv-deck)",
        color: on ? "var(--sv-knock)" : "var(--sv-soft)",
        font: "var(--sv-stencil)"
      }
    }, it.glyph);
  }));
}
Object.assign(__ds_scope, { Panel, Tag, MenuSheet, Rail });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chrome/Panel.jsx", error: String((e && e.message) || e) }); }

// components/meters/SegmentMeter.jsx
try { (() => {
const TONE = {
  amber: "var(--sv-amber)",
  good: "var(--sv-good)",
  warn: "var(--sv-warn)",
  bad: "var(--sv-bad)",
  neutral: "var(--sv-rim)"
};

/* Segments, not a bar — a module's stability is a row of ▮ cells, and a cell
   is lit or it is out. Nothing partial, so nothing to interpolate. */
function SegmentMeter({
  label,
  value = 0,
  max = 8,
  burned = 0,
  tone = "good",
  shape = "block",
  height = 12,
  showValue = true,
  style
}) {
  const c = TONE[tone] || TONE.good;
  const cells = [];
  for (let i = 0; i < max; i++) {
    const isBurned = i >= max - burned;
    const on = i < value && !isBurned;
    cells.push(/*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        flex: 1,
        minWidth: 2,
        height,
        background: isBurned ? "var(--sv-burned)" : on ? c : "var(--sv-plate)",
        clipPath: shape === "slant" ? "polygon(14% 0,100% 0,86% 100%,0 100%)" : undefined
      }
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      ...style
    }
  }, label ? /*#__PURE__*/React.createElement("div", {
    style: {
      width: 78,
      flex: "none",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, label) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      gap: shape === "slant" ? 3 : 2
    }
  }, cells), showValue ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--sv-value)",
      color: "var(--sv-ink)",
      whiteSpace: "nowrap"
    }
  }, value, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--sv-soft)"
    }
  }, "/", max)) : null);
}

/* Stability written the way the machine prints it: one struck mark per step of
   capacity, lit while the module holds it, dim where it has been lost. Left
   aligned and never stretched, so two modules of different size are directly
   comparable and no number has to restate the count. */
function SlashMeter({
  label,
  value = 0,
  max = 8,
  tone = "good",
  style
}) {
  const c = TONE[tone] || TONE.good;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      ...style
    }
  }, label ? /*#__PURE__*/React.createElement("div", {
    style: {
      width: 78,
      flex: "none",
      font: "var(--sv-stencil)",
      fontSize: 14,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, label) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      gap: 1,
      font: "var(--sv-value)",
      fontSize: 17,
      lineHeight: 1,
      letterSpacing: 0,
      whiteSpace: "nowrap",
      overflow: "hidden"
    }
  }, Array.from({
    length: max
  }).map((_, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      color: i < value ? c : "var(--sv-plate-lit)"
    }
  }, "/"))));
}

/* The core's stability, read as pips: ●●○. The last one is the run. */
function CorePips({
  value = 1,
  max = 3,
  size = 15,
  style
}) {
  const tone = value <= 1 ? "var(--sv-bad)" : value < max ? "var(--sv-warn)" : "var(--sv-good)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      ...style
    }
  }, Array.from({
    length: max
  }).map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      width: size,
      height: size,
      background: i < value ? tone : "transparent",
      border: `2px solid ${i < value ? tone : "var(--sv-plate-lit)"}`,
      boxSizing: "border-box",
      animation: i === value - 1 && value <= 1 ? "sv-flick var(--sv-frame-3) var(--sv-step) infinite" : "none"
    }
  })));
}

/* The drone: its core, then six numbered slots. A module is a named system
   with a stability bar; when it burns out the slot is empty for the rest of
   the sortie. This is where damage lands — there is no hull bar anywhere. */
function CoreRack({
  core = 1,
  coreMax = 3,
  slots = [],
  title = "Core",
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      paddingBottom: 11,
      borderBottom: "1px solid var(--sv-line)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--sv-stencil)",
      letterSpacing: "var(--sv-stencil-track)",
      textTransform: "uppercase",
      color: core <= 1 ? "color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))" : "var(--sv-ink)"
    }
  }, title), /*#__PURE__*/React.createElement(CorePips, {
    value: core,
    max: coreMax
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      marginTop: 11
    }
  }, slots.map((s, i) => {
    /* A burned slot and an empty slot are the same thing to look at: the
       bay is there and nothing is in it. Naming what used to be in it is
       a fact for the log, not a permanent label on the rack. */
    const dead = s.burned || s.empty;
    return dead ? /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        height: 19,
        padding: "0 9px",
        border: "1px dotted var(--sv-rule)",
        boxSizing: "border-box"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--sv-stencil)",
        fontSize: 14,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: "var(--sv-faint)"
      }
    }, "empty")) : /*#__PURE__*/React.createElement(SlashMeter, {
      key: i,
      label: s.name,
      value: s.value,
      max: s.max,
      tone: s.tone || (s.value <= s.max * 0.34 ? "bad" : s.value < s.max * 0.7 ? "warn" : "good")
    });
  })));
}

/* Alert. Five steps, and only the fifth sweeps: a printed gauge, not a bezel. */
function AlertDial({
  value = 0,
  max = 5,
  label = "Alert",
  size = 76,
  tone = "bad",
  style
}) {
  const c = TONE[tone] || TONE.bad;
  const seg = 360 / max,
    deg = Math.max(0, Math.min(max, value)) * seg;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 7,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: size,
      height: size,
      borderRadius: "50%",
      background: "var(--sv-knock)",
      border: `1px solid ${value ? c : "var(--sv-plate-lit)"}`,
      boxSizing: "border-box",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 4,
      borderRadius: "50%",
      background: `conic-gradient(${c} 0deg ${deg}deg, color-mix(in oklab, ${c} 14%, var(--sv-knock)) ${deg}deg 360deg)`
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 4,
      borderRadius: "50%",
      background: `repeating-conic-gradient(from -2deg, transparent 0 ${seg - 4}deg, var(--sv-knock) ${seg - 4}deg ${seg}deg)`
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: Math.round(size * .17),
      borderRadius: "50%",
      background: "var(--sv-knock)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--sv-display)",
      fontSize: Math.round(size * .45),
      color: value ? c : "var(--sv-soft)",
      animation: value >= max ? "sv-flick var(--sv-frame-3) var(--sv-step) infinite" : "none"
    }
  }, value)), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--sv-scan)",
      pointerEvents: "none"
    }
  })), label ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--sv-stencil)",
      letterSpacing: "var(--sv-stencil-track)",
      textTransform: "uppercase",
      color: "var(--sv-soft)"
    }
  }, label) : null);
}
Object.assign(__ds_scope, { SegmentMeter, SlashMeter, CorePips, CoreRack, AlertDial });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/meters/SegmentMeter.jsx", error: String((e && e.message) || e) }); }

// derelict-fx.js
try { (() => {
/**
 * derelict-fx — a tiny animation library for turn-based games whose interface
 * is meant to look like damaged hardware.
 *
 * One rule underneath everything: NOTHING INTERPOLATES. Every visual state is
 * one of a small set of discrete frames held for a fixed number of ms. No
 * easing curves, no tweens. That is what makes text reveals, token movement
 * and combat read as the same machine rather than as four separate effects.
 *
 * No dependencies, no build step. Works with any DOM element in any framework.
 *
 *   import * as FX from './derelict-fx.js';
 *   FX.scrambleReveal(document.querySelectorAll('.line'), FX.PRESETS.panel);
 *
 * or drop it in with a plain <script src> and use the window.DerelictFX global.
 *
 * The scramble reveal is ported from vuvko-lab/coherence-7drl (src/main.ts).
 */

/**
 * The sampling rate of the whole system. Every held frame is a multiple of this.
 * Raising it slows every effect at once — text, movement and combat stay locked
 * to each other, which is the point of having a single constant.
 */
const FRAME = 225;

/**
 * Block-drawing glyphs. Only safe where the box is a fixed size — unit tokens,
 * board cells — because most UI typefaces do not contain them and the browser
 * substitutes a fallback font with different metrics, which makes scrambled
 * text jump wider than the string it is standing in for.
 */
const BLOCK_CHARS = '░▒▓█▀▄╔╗╚╝║═├┤┬┴┼─│┌┐└┘';

/** Fewer, denser glyphs — better for 1–2 character tokens. */
const TOKEN_CHARS = '░▒▓█▚▞▙▟';

/** Kept for back-compat; text reveals now scramble per character class. */
const SCRAMBLE_CHARS = BLOCK_CHARS;
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const pick = s => s[Math.random() * s.length | 0];
function randomScramble(length, chars = BLOCK_CHARS) {
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.random() * chars.length | 0];
  return out;
}

/**
 * Scramble a string while holding its shape: every character is replaced by a
 * random one of the SAME class — capital for capital, lowercase for lowercase,
 * digit for digit — and spaces, punctuation and symbols are left alone.
 *
 * Two things fall out of that. The line never changes width, because letters of
 * the same case have near-identical advances in a sane UI face and the spaces
 * stay where they were. And the reveal reads as a signal resolving rather than
 * as noise, since the word and number shapes are visible the whole time.
 */
function scrambleLike(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch >= 'A' && ch <= 'Z') out += pick(UPPER);else if (ch >= 'a' && ch <= 'z') out += pick(LOWER);else if (ch >= '0' && ch <= '9') out += pick(DIGITS);else out += ch;
  }
  return out;
}
function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Every function returns one of these. Call cancel() to stop and leave the DOM as-is. */
function handle(timers, intervals) {
  return {
    cancel() {
      timers.forEach(clearTimeout);
      (intervals || []).forEach(clearInterval);
      timers.length = 0;
    }
  };
}

/* ────────────────────────────── core sequencer ───────────────────────────── */

/**
 * Hold each step for `frame` ms, in order. The primitive everything else is
 * built from — use it directly for any effect not covered below.
 *
 *   FX.frames([
 *     () => el.textContent = '▚',
 *     () => el.style.background = '#fff',
 *     () => el.style.background = ''
 *   ]);
 */
function frames(steps, {
  frame = FRAME,
  delay = 0,
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  if (skip) {
    steps.forEach(s => s());
    if (onDone) onDone();
    return handle([]);
  }
  const timers = [];
  let t = delay;
  for (const step of steps) {
    timers.push(setTimeout(step, t));
    t += frame;
  }
  if (onDone) timers.push(setTimeout(onDone, t));
  return handle(timers);
}

/* ──────────────────────────────── text ───────────────────────────────────── */

/**
 * Resolve text out of noise, element by element.
 *
 * Each element scrambles for `ticks` re-randomisations at `tickMs` apart, then
 * snaps to its real text. `stagger` offsets each element in the list, so a
 * panel assembles top to bottom. `block` groups lines into stagger slots, so
 * a thirty-line sheet arrives in six steps rather than thirty.
 *
 * The text in flight is cached on el.dataset.text, guarded by el.dataset.fxBusy.
 * At rest the DOM is treated as the truth, so an element whose text CHANGES
 * between calls — a log ticker, a live value — reveals its new text rather than
 * restoring the old one. Cancelling restores the text in flight and clears the
 * guard.
 */
function scrambleReveal(els, {
  stagger = 0,
  staggerTotal = 0,
  block = 1,
  ticks = 3,
  tickMs = 40,
  chars = null,
  dim = 0.42,
  blockChance = 0.3,
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  const list = Array.from(els || []);
  if (!list.length) {
    if (onDone) onDone();
    return handle([]);
  }

  // Cogmind's rule for a list reveal: the whole animation must finish in a
  // bounded time no matter how many rows there are, so the per-row offset is
  // derived from a total budget rather than fixed. (Kyzrati: each item is
  // staggered within 0–700ms, each move takes 300ms, so the sort never runs
  // longer than a second regardless of item count.)
  if (staggerTotal && list.length > 1) {
    stagger = Math.min(stagger || Infinity, staggerTotal / (list.length - 1));
  }

  // Which stagger slot a line sits in. With block = 1 this is just its index;
  // with block = 5 the first five lines all start at 0, the next five one
  // stagger later, and a thirty-line sheet costs six slots instead of thirty.
  const slot = i => block > 1 ? Math.floor(i / block) : i;
  if (skip) {
    list.forEach(el => {
      if (el.dataset.fxBusy === '1' && el.dataset.text != null) el.textContent = el.dataset.text;
      delete el.dataset.fxBusy;
    });
    if (onDone) onDone();
    return handle([]);
  }
  const timers = [],
    intervals = [];
  let pending = list.length;
  list.forEach((el, i) => {
    // At rest the DOM holds the real text; only while a scramble is in flight
    // does dataset.text know better. Trusting the cache unconditionally is
    // what pinned a live ticker to the first line it ever animated.
    const live = el.textContent;
    const text = el.dataset.fxBusy === '1' && el.dataset.text != null ? el.dataset.text : live;
    el.dataset.text = text;
    el.dataset.fxBusy = '1';

    // Block glyphs only where they cannot change the line's width: monospace
    // runs, where every glyph shares one advance. Elsewhere the browser would
    // substitute a fallback font and the text would jump.
    const mono = chars ? true : isMono(el);
    const noise = ch => chars ? chars[Math.random() * chars.length | 0] : noiseChar(ch, mono, blockChance);
    el.textContent = '';
    timers.push(setTimeout(() => {
      let tick = 0;
      const paint = () => {
        // characters lock left to right as the signal resolves
        const locked = Math.floor(tick / ticks * text.length);
        let html = '';
        for (let k = 0; k < text.length; k++) {
          if (k < locked) html += esc(text[k]);else html += '<span style="opacity:' + dim + '">' + esc(noise(text[k])) + '</span>';
        }
        el.innerHTML = html;
      };
      paint();
      const iv = setInterval(() => {
        tick++;
        if (tick >= ticks) {
          clearInterval(iv);
          el.textContent = text;
          delete el.dataset.fxBusy; // at rest again: the DOM is the truth
          if (--pending === 0 && onDone) onDone();
          return;
        }
        paint();
      }, tickMs);
      intervals.push(iv);
    }, slot(i) * stagger));
  });
  const h = handle(timers, intervals);
  /* A cancelled reveal must not leave noise on screen, and must not leave the
     busy flag set — a later call would then trust a cache that is no longer
     the truth. */
  return {
    cancel() {
      h.cancel();
      list.forEach(el => {
        if (el.dataset.fxBusy === '1' && el.dataset.text != null) el.textContent = el.dataset.text;
        delete el.dataset.fxBusy;
      });
    }
  };
}
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function isMono(el) {
  try {
    return /mono|courier|consolas/i.test(getComputedStyle(el).fontFamily || '');
  } catch (e) {
    return false;
  }
}
function noiseChar(ch, mono, blockChance) {
  if (ch === ' ' || ch === '\n' || ch === '\t') return ch;
  const isUpper = ch >= 'A' && ch <= 'Z';
  const isLower = ch >= 'a' && ch <= 'z';
  const isDigit = ch >= '0' && ch <= '9';
  if (!isUpper && !isLower && !isDigit) return ch;
  if (mono && Math.random() < blockChance) return pick(TOKEN_CHARS);
  if (isUpper) return pick(UPPER);
  if (isLower) return pick(LOWER);
  return pick(DIGITS);
}

/**
 * Timings that have been tuned in a shipped game. Reach for these before
 * inventing numbers — the differences between them carry meaning.
 *
 *   hover  no stagger at all, so a glance feels like focusing, not building
 *   panel  assembles top to bottom; the reader watches it arrive
 *   value  no stagger, many ticks — one number working itself out
 *   boot   slow and theatrical; only for a loading screen
 */
const PRESETS = {
  hover: {
    stagger: 0,
    ticks: 4,
    tickMs: 84
  },
  panel: {
    stagger: 135,
    ticks: 4,
    tickMs: 114
  },
  panelEdge: {
    stagger: 120,
    ticks: 3,
    tickMs: 120
  },
  value: {
    stagger: 0,
    ticks: 7,
    tickMs: 120
  },
  log: {
    stagger: 360,
    ticks: 4,
    tickMs: 150
  },
  name: {
    stagger: 165,
    ticks: 5,
    tickMs: 105
  },
  menu: {
    stagger: 900,
    ticks: 5,
    tickMs: 180
  },
  boot: {
    stagger: 900,
    ticks: 5,
    tickMs: 180
  },
  /** A list of unknown length — bounded total, so ten rows read like three. */
  list: {
    stagger: 135,
    staggerTotal: 700,
    ticks: 3,
    tickMs: 110
  },
  /** A sheet of many lines: five at a time, so length costs almost nothing. */
  sheet: {
    stagger: 112,
    block: 5,
    ticks: 3,
    tickMs: 95
  },
  /** Everything at once — for a record that was already written. */
  all: {
    stagger: 0,
    ticks: 3,
    tickMs: 95
  }
};

/**
 * Arrival flash. Cogmind flashes a moved item white and lets it fade back over
 * 400ms, which is what tells you at a glance which rows just changed. Ours
 * steps rather than fades — three held frames, white, half, base — because a
 * fade is the one thing this system does not do.
 */
function arrive(els, {
  frame = 135,
  color = '#ffffff',
  mid = null,
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  const list = Array.from(els || []);
  if (!list.length) {
    if (onDone) onDone();
    return handle([]);
  }
  const prev = list.map(el => el.style.color);
  if (skip) {
    if (onDone) onDone();
    return handle([]);
  }
  const half = mid || 'color-mix(in oklab, ' + color + ' 50%, currentColor)';
  return frames([() => list.forEach(el => {
    el.style.color = color;
  }), () => list.forEach(el => {
    el.style.color = half;
  }), () => list.forEach((el, i) => {
    el.style.color = prev[i] || '';
  })], {
    frame,
    onDone
  });
}

/** Write new text into elements and reveal it. Convenience for panels that change content. */
function setAndReveal(els, texts, preset = PRESETS.panel) {
  const list = Array.from(els || []);
  list.forEach((el, i) => {
    const t = texts[i] != null ? texts[i] : '';
    el.dataset.text = t;
    el.textContent = t;
  });
  return scrambleReveal(list, preset);
}

/* ─────────────────────────────── tokens ──────────────────────────────────── */

/**
 * A ghost must never impersonate the element it was cloned from: duplicate ids
 * are invalid HTML and break #id selectors, and a consumer iterating its units
 * by data attribute would otherwise find phantom copies mid-move.
 */
function stripIdentity(node, extra) {
  node.removeAttribute('id');
  node.removeAttribute('name');
  Array.from(node.attributes).forEach(a => {
    if (a.name.indexOf('data-') === 0 || a.name.indexOf('aria-') === 0) node.removeAttribute(a.name);
  });
  (extra || []).forEach(a => node.removeAttribute(a));
  node.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
}

/**
 * `place` tells the library how to put a token somewhere. The default writes
 * {left, top} as pixels; pass your own for grids, transforms or canvas.
 */
const defaultPlace = (el, pos) => {
  if (pos == null) return;
  if (typeof pos === 'object') {
    if (pos.left != null) el.style.left = typeof pos.left === 'number' ? pos.left + 'px' : pos.left;
    if (pos.top != null) el.style.top = typeof pos.top === 'number' ? pos.top + 'px' : pos.top;
  }
};

/**
 * Scrambled wake — the default way to move a token one or more tiles.
 *
 * The token steps from tile to tile, never between them, with its face broken
 * into block glyphs the whole way. Each tile it leaves keeps a decaying ghost,
 * so the route is revealed by the movement itself and no arrow is needed.
 *
 *   FX.wake(token, [{left: 50}, {left: 88}, {left: 126}], { label: 'D1' });
 *
 * If the token is a drawing rather than a text node, pass `faceEl` — the child
 * that carries the readable face (mark it `data-fx-face` so ghosts find it too).
 * The host element moves; only the face scrambles.
 *
 * Ghosts are clones, so they are stripped of anything that identifies the
 * original before being inserted: the id, every data-* attribute, and any
 * name/aria hooks. They carry only `data-fx-ghost`. That means you can keep
 * querying your own tokens by id or data attribute while a move is playing —
 * add to `stripAttrs` if your project hangs identity on something else.
 */
function wake(el, path, {
  place = defaultPlace,
  frame = FRAME,
  ghostMs = 1350,
  faceEl = null,
  label = null,
  chars = TOKEN_CHARS,
  scrambleFace = true,
  ghostOpacity = 0.5,
  stripAttrs = [],
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  const steps = Array.from(path || []);
  if (!el || !steps.length) {
    if (onDone) onDone();
    return handle([]);
  }
  const face = faceEl || el;
  const text = label != null ? label : face.textContent || '';
  if (skip) {
    place(el, steps[steps.length - 1]);
    face.textContent = text;
    if (onDone) onDone();
    return handle([]);
  }
  const timers = [],
    intervals = [];
  const faceLen = (text || '··').length;
  steps.forEach((pos, i) => {
    timers.push(setTimeout(() => {
      const ghost = el.cloneNode(true);
      stripIdentity(ghost, stripAttrs);
      ghost.setAttribute('data-fx-ghost', '');
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = String(ghostOpacity);
      ghost.style.transition = 'opacity ' + ghostMs + 'ms linear';
      if (scrambleFace) ghost.textContent = randomScramble(faceLen, chars);
      el.parentNode.appendChild(ghost);
      const ghostFace = faceEl ? ghost.querySelector('[data-fx-face]') || ghost : ghost;
      let gt = 0;
      const giv = setInterval(() => {
        ghostFace.textContent = randomScramble(faceLen, chars);
        if (++gt > 3) clearInterval(giv);
      }, frame);
      intervals.push(giv);
      requestAnimationFrame(() => {
        ghost.style.opacity = '0';
      });
      timers.push(setTimeout(() => {
        clearInterval(giv);
        ghost.remove();
      }, ghostMs + 60));
      place(el, pos);
      if (scrambleFace) face.textContent = randomScramble(faceLen, chars);
    }, i * frame));
  });
  const tail = steps.length * frame;
  timers.push(setTimeout(() => {
    face.textContent = text;
    if (onDone) onDone();
  }, tail + frame));
  return handle(timers, intervals);
}

/**
 * Blink-step — the token cuts out and reappears elsewhere, flickering once as
 * the feed re-acquires it. No path is shown, which makes it right for
 * teleports, deploys, and anything that did not physically travel.
 */
function blink(el, to, {
  place = defaultPlace,
  frame = FRAME,
  flickers = 2,
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  if (!el) {
    if (onDone) onDone();
    return handle([]);
  }
  if (skip) {
    place(el, to);
    if (onDone) onDone();
    return handle([]);
  }
  const steps = [() => {
    el.style.opacity = '0';
  }, () => {
    place(el, to);
  }];
  for (let i = 0; i < flickers; i++) {
    steps.push(() => {
      el.style.opacity = '1';
    });
    steps.push(() => {
      el.style.opacity = '0';
    });
  }
  steps.push(() => {
    el.style.opacity = '1';
  });
  return frames(steps, {
    frame: Math.round(frame * 0.6),
    onDone
  });
}

/**
 * Teleport — dissolve into noise here, reassemble there. No path is drawn, so
 * the move reads as a cut rather than a walk. Longer and more expensive than
 * blink.
 *
 * If the token is a drawing rather than a text node, pass `faceEl` — the child
 * carrying the readable face. The host moves; only the face scrambles.
 */
function teleport(el, to, {
  place = defaultPlace,
  frame = FRAME,
  faceEl = null,
  label = null,
  chars = TOKEN_CHARS,
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  if (!el) {
    if (onDone) onDone();
    return handle([]);
  }
  const face = faceEl || el;
  const text = label != null ? label : face.textContent || '';
  if (skip) {
    place(el, to);
    face.textContent = text;
    if (onDone) onDone();
    return handle([]);
  }
  const n = (text || '··').length;
  const scr = () => {
    face.textContent = randomScramble(n, chars);
  };
  return frames([scr, scr, scr, () => {
    el.style.opacity = '0';
  }, () => {
    place(el, to);
    el.style.opacity = '1';
    scr();
  }, scr, scr, () => {
    face.textContent = text;
  }], {
    frame: Math.round(frame * 0.6),
    onDone
  });
}

/** Stepped transit — drawn on each tile, never between them, and no ghosts. */
function steppedTransit(el, path, {
  place = defaultPlace,
  frame = FRAME,
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  const steps = Array.from(path || []);
  if (!el || !steps.length) {
    if (onDone) onDone();
    return handle([]);
  }
  if (skip) {
    place(el, steps[steps.length - 1]);
    if (onDone) onDone();
    return handle([]);
  }
  return frames(steps.map(pos => () => place(el, pos)), {
    frame,
    onDone
  });
}

/* ─────────────────────────────── combat ──────────────────────────────────── */

/**
 * Impact frames — a heavy adjacent hit. Nothing travels: the attacker's face
 * flips to a strike mark, the shared edge fills, the target goes solid white
 * for exactly one frame, then returns scrambled and dimmed.
 *
 * Every element is optional; pass what you have.
 */
function impact({
  attacker,
  target,
  edge,
  damageEl,
  damage = '',
  frame = FRAME,
  chars = TOKEN_CHARS,
  strikeGlyph = '▚',
  flashColor = '#ffffff',
  hurtOpacity = 0.62,
  targetLabel,
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  const tLabel = targetLabel != null ? targetLabel : target && target.textContent;
  const aLabel = attacker && attacker.textContent;
  const tBg = target && target.style.background;
  if (skip) {
    if (target) target.style.opacity = String(hurtOpacity);
    if (damageEl) {
      damageEl.textContent = damage;
      damageEl.style.opacity = '1';
    }
    if (onDone) onDone();
    return handle([]);
  }
  return frames([() => {
    if (attacker) attacker.textContent = strikeGlyph;
  }, () => {
    if (edge) {
      edge.style.opacity = '1';
      edge.textContent = '▓▒░';
    }
  }, () => {
    if (target) {
      target.style.background = flashColor;
      target.textContent = '██';
    }
    if (edge) edge.textContent = '█▓█';
  }, () => {
    if (target) {
      target.style.background = tBg || '';
      target.textContent = randomScramble(2, chars);
    }
    if (edge) edge.style.opacity = '0';
    if (damageEl && damage) {
      damageEl.textContent = damage;
      damageEl.style.opacity = '1';
    }
  }, () => {
    if (target) target.textContent = randomScramble(2, chars);
    if (attacker) attacker.textContent = aLabel;
  }, () => {
    if (target) {
      target.textContent = tLabel;
      target.style.opacity = String(hurtOpacity);
    }
  }, () => {
    if (damageEl) damageEl.style.opacity = '0';
  }], {
    frame,
    onDone
  });
}

/**
 * Edge burst — the cheapest legible adjacent hit. Only the shared edge
 * changes, stepping ░ → █ → ▓ while the target inverts. Nothing moves and no
 * glyph is swapped on the attacker, so any number of these can resolve in
 * sequence without the turn dragging.
 */
function edgeBurst({
  target,
  edge,
  damageEl,
  damage = '',
  frame = FRAME,
  hurtOpacity = 0.62,
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  if (skip) {
    if (target) target.style.opacity = String(hurtOpacity);
    if (damageEl) {
      damageEl.textContent = damage;
      damageEl.style.opacity = '1';
    }
    if (onDone) onDone();
    return handle([]);
  }
  return frames([() => {
    if (edge) {
      edge.style.opacity = '1';
      edge.textContent = '░';
    }
  }, () => {
    if (edge) {
      edge.textContent = '█';
      edge.style.color = '#ffffff';
    }
  }, () => {
    if (edge) edge.textContent = '▓';
    if (target) target.style.filter = 'invert(1) brightness(2)';
    if (damageEl && damage) {
      damageEl.textContent = damage;
      damageEl.style.opacity = '1';
    }
  }, () => {
    if (edge) edge.style.opacity = '0';
    if (target) {
      target.style.filter = '';
      target.style.opacity = String(hurtOpacity);
    }
  }, () => {
    if (damageEl) damageEl.style.opacity = '0';
  }], {
    frame,
    onDone
  });
}

/**
 * Exchange — a strike and the answering blow, with a deliberate dead frame
 * between them. The pause is what makes the counter legible as its own event.
 * Runs `impact` in both directions; both parties end dimmed.
 */
function exchange({
  attacker,
  target,
  edge,
  damageEl,
  damage = '',
  counterDamage = '',
  frame = FRAME,
  counterColor = '#cf6a5a',
  onDone,
  skip = prefersReducedMotion()
} = {}) {
  const first = impact({
    attacker,
    target,
    edge,
    damageEl,
    damage,
    frame,
    skip
  });
  if (skip) {
    if (attacker) attacker.style.opacity = '0.72';
    if (onDone) onDone();
    return first;
  }
  const gap = frame * 8;
  const second = setTimeout(() => {
    if (edge) edge.style.color = counterColor;
    impact({
      attacker: target,
      target: attacker,
      edge,
      damageEl,
      damage: counterDamage,
      frame,
      strikeGlyph: '▞',
      onDone
    });
  }, gap);
  return {
    cancel() {
      first.cancel();
      clearTimeout(second);
    }
  };
}

/* ──────────────────────────── screen-level ───────────────────────────────── */

/**
 * Hit-stop. Freeze everything for a beat on a heavy blow — it sells weight
 * better than any motion. Applies a class you define, or pauses your own tick.
 */
function hitStop(ms = 60, {
  onResume
} = {}) {
  const t = setTimeout(() => {
    if (onResume) onResume();
  }, ms);
  return handle([t]);
}

/** Remove any ghosts left behind by a cancelled wake(). */
function clearGhosts(root = document) {
  root.querySelectorAll('[data-fx-ghost]').forEach(g => g.remove());
}

/* ───────────────────────────── global build ──────────────────────────────── */

const API = {
  FRAME,
  SCRAMBLE_CHARS,
  TOKEN_CHARS,
  PRESETS,
  BLOCK_CHARS,
  randomScramble,
  scrambleLike,
  prefersReducedMotion,
  frames,
  scrambleReveal,
  setAndReveal,
  arrive,
  wake,
  blink,
  teleport,
  steppedTransit,
  impact,
  edgeBurst,
  exchange,
  hitStop,
  clearGhosts
};
if (typeof window !== 'undefined') window.DerelictFX = API;
Object.assign(__ds_scope, { FRAME, BLOCK_CHARS, TOKEN_CHARS, SCRAMBLE_CHARS, randomScramble, scrambleLike, prefersReducedMotion, frames, scrambleReveal, PRESETS, arrive, setAndReveal, wake, blink, teleport, steppedTransit, impact, edgeBurst, exchange, hitStop, clearGhosts, API, __ds_default_derelict_fx_asvcgs: API });
})(); } catch (e) { __ds_ns.__errors.push({ path: "derelict-fx.js", error: String((e && e.message) || e) }); }

__ds_ns.Lever = __ds_scope.Lever;

__ds_ns.ActionList = __ds_scope.ActionList;

__ds_ns.LogStrip = __ds_scope.LogStrip;

__ds_ns.Knowledge = __ds_scope.Knowledge;

__ds_ns.Popover = __ds_scope.Popover;

__ds_ns.Readout = __ds_scope.Readout;

__ds_ns.HexTile = __ds_scope.HexTile;

__ds_ns.MoverMark = __ds_scope.MoverMark;

__ds_ns.DroneGhost = __ds_scope.DroneGhost;

__ds_ns.DroneMark = __ds_scope.DroneMark;

__ds_ns.HexMap = __ds_scope.HexMap;

__ds_ns.ContentIcon = __ds_scope.ContentIcon;

__ds_ns.ObjectRow = __ds_scope.ObjectRow;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.MenuSheet = __ds_scope.MenuSheet;

__ds_ns.Rail = __ds_scope.Rail;

__ds_ns.SegmentMeter = __ds_scope.SegmentMeter;

__ds_ns.SlashMeter = __ds_scope.SlashMeter;

__ds_ns.CorePips = __ds_scope.CorePips;

__ds_ns.CoreRack = __ds_scope.CoreRack;

__ds_ns.AlertDial = __ds_scope.AlertDial;

__ds_ns.FRAME = __ds_scope.FRAME;

__ds_ns.BLOCK_CHARS = __ds_scope.BLOCK_CHARS;

__ds_ns.TOKEN_CHARS = __ds_scope.TOKEN_CHARS;

__ds_ns.SCRAMBLE_CHARS = __ds_scope.SCRAMBLE_CHARS;

__ds_ns.PRESETS = __ds_scope.PRESETS;

__ds_ns.API = __ds_scope.API;

})();
