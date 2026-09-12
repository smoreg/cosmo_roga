/* Geomorph model: tiles, where they may sit, and how a plan is laid out.
 *
 * Split out of geomorphs.html so a second page can build the same ships —
 * hexmap.html lays a hex grid over what this produces. A classic script, not a
 * module, because both pages have to work from file:// where module loading and
 * fetch are both refused; classic scripts share one global scope, so everything
 * declared here is visible to the page that includes it.
 *
 * Nothing in this file touches the DOM. The page reads its own controls and
 * passes them to layout(); what comes back is geometry.
 */

/* Which build you are looking at. Baked so it works from file://, and checked
   against the file's own Last-Modified when served, because "I reloaded and it
   is still wrong" needs an answer that does not depend on me remembering to
   bump a number. */
const BUILD = "2026-09-10";
function stampBuild(el){
  if (!el) return;
  el.textContent = "build " + BUILD;
  fetch("geomorph-core.js", {method:"HEAD"}).then(r=>{
    const t = r.headers.get("Last-Modified");
    if (t) el.textContent = "build " + BUILD + " · core " +
      new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z";
  }).catch(()=>{});
}

const FT = 12;                 // px per foot at native scale (60px / 5ft)
const IMG = FT*5/60;           // image px -> plan px (1:1 while FT is 12)
const SETS = ["Geomorphs","Custom-Tiles","Symbols","AdventureClass"];
/* The Adventure Class download sorts its parts by connection topology, and the
   two-letter code in each folder name is the part's role — the same split
   Geomorph Shipyard's part library uses. */
const AC_ROLES = {
  HG:"hg", LG:"lg", QG:"qg", Sh:"sh",       // hull centres
  SE:null,                                   // small end: [Fore] or [Aft]
  LC:"lc", SC:"sc", HC:"hc",                 // cores, connected fore and aft
  LS:"ls", SS:"ss", AO:"ao",                 // mirrored sides and add-ons
  M:"acmisc", TG:"transition", DV:"dorsal", As:"asteroid", UG:"unique",
};
const AC_FOLDER_RE = /^\d+(?:\.\d+)?\s+([A-Za-z]{1,2})\s/;
const TAG_RE  = /\[(Fore|Aft|Port|Starboard)\]/;
const TONS_RE = /\[([\d+]+)-dTons\]/;

const KIND_FOLDERS = [
  ["100x100 Core","core"], ["100x50 Edge","edge"], ["50x50 Corner","corner"],
  ["100x100 End","end"], ["200x100 Megamorph","megamorph"], ["50x50 Build It","build"],
  ["Small Craft","craft"], ["Starships","ship"], ["Baseplates","baseplate"],
  ["Bridge","bridge"], ["Engineering","engineering"], ["Misc","misc"],
];

let LIB = [];                  // every parsed tile
let POOL = {};                 // playable tiles by role
let OVERLAYS = new Map();      // code -> overlay tiles
let SYMBOLS = [];
let FAMILIES = [];             // Port/Starboard hull forms
let BOW = null;                // the A1xx pointed bow kit
let AC = {ready:false};        // Adventure Class parts, if they are unpacked too
let TAX = null;                // tiles.taxonomy.json: which sides are skin, read off the art
let BYSIZE = new Map();        // tiles by footprint, for the fit test
let PLACEABLE = [];
let RULES = "folder rules";
let SETSEL = "all";            // which tile sets buildPools draws from
let WING_FORMS = [];           // hull forms the page offers, rebuilt with the pools
let PLAN = null;               // current layout
let STAMPS = [];               // hand-placed symbols, kept across generations
let scale = 0.14;

/* ---------- seeded random ---------- */
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
let RNG = mulberry32(1);
const rnd = ()=>RNG();
const ri  = (a,b)=>a+Math.floor(RNG()*(b-a+1));
const pick = a=>a[Math.floor(RNG()*a.length)];
function shuffle(a){const c=a.slice();for(let i=c.length-1;i>0;i--){const j=Math.floor(RNG()*(i+1));[c[i],c[j]]=[c[j],c[i]];}return c;}

/* ---------- filename parsing (mirrors geomorph_manifest.py) ---------- */
const SIZE_RE = /\[(\d+)\s*[xX]\s*(\d+)\]/;
const CODE_RE = /^((?:[A-Za-z]{1,3}-?\d{2,4}|\d{3,4})(?:,(?:[A-Za-z]{1,3}-?\d{2,4}|\d{3,4}))*)\b/;

function parseTile(relPath, pxw, pxh){
  const parts = relPath.split("/");
  const file  = parts[parts.length-1];
  if (!/\.png$/i.test(file)) return null;
  const stem  = file.replace(/\.png$/i,"");
  const set   = parts.find(p=>SETS.includes(p)) || parts[0] || "";
  let kind = set === "Symbols" ? "symbol" : "misc";
  if (set === "AdventureClass"){
    for (const p of parts){
      const m = AC_FOLDER_RE.exec(p);
      if (!m) continue;
      const role = AC_ROLES[m[1]];
      if (role){ kind = role; break; }
      kind = /\[Aft\]/.test(stem) ? "aft" : "fore";
      break;
    }
  } else if (set !== "Symbols"){
    outer: for (const p of parts){
      for (const [folder,k] of KIND_FOLDERS){ if (p === folder){ kind = k; break outer; } }
    }
  }
  const m = SIZE_RE.exec(stem), code = CODE_RE.exec(stem);
  const sqw = Math.round(pxw/60), sqh = Math.round(pxh/60);
  let w, h, bx, by;
  if (m && kind !== "symbol"){
    w = +m[1]; h = +m[2];
    bx = (sqw - w/5)/2; by = (sqh - h/5)/2;
  } else {
    w = sqw*5; h = sqh*5; bx = by = 0;
  }
  const label = stem.replace(CODE_RE,"").replace(SIZE_RE,"").replace(TONS_RE,"")
    .replace(/\[(Mirror|Overlay|Fore|Aft|Port|Starboard)\]/g,"").replace(/^\s*\(\d+\)\s*/,"")
    .replace(/\s{2,}/g," ").trim().replace(/^[-,\s]+|[-,\s]+$/g,"") || stem;
  const tag = TAG_RE.exec(stem), tons = TONS_RE.exec(stem);
  return {
    path: relPath, set, kind, code: code ? code[1] : "",
    w, h, px:[pxw,pxh], bleed:[bx,by],
    mirror: stem.includes("[Mirror]"), overlay: stem.includes("[Overlay]"),
    tag: tag ? tag[1] : "",
    tons: tons ? tons[1].split("+").reduce((a,b)=>a + +b, 0) : 0,
    label, search: (label+" "+stem).toLowerCase(),
  };
}

/* ---------- library ---------- */
/* Which base an overlay may be drawn on: same folder, same index, same hand. */
function overlayKey(t){
  const dir = t.path.slice(0, t.path.lastIndexOf("/"));
  return dir + "|" + t.code + (t.mirror ? "|m" : "");
}
function canonical(t, w, h){
  return t.w === w && t.h === h && t.bleed[0] === 2 && t.bleed[1] === 2;
}
/* ---------- hull forms ----------
   The archive carries a whole ship-design system that the folder names hide:
   flank pieces sold as matched Port/Starboard pairs (AF01-AF13 aerofins and
   wings, A103-A140 hull sides, from the Concorde and shuttle profiles up to
   300 ft gunnery decks). A pair of those either side of a 100 ft spine of core
   tiles gives a hull with a real silhouette instead of a rectangle — which is
   how Geomorph Shipyard builds its ships, and what its saved JSON describes.

   Two of those lines also ship their own bow, and only their own bow fits:
   AF13's [100x100] nose continues its flanks' diagonal exactly, and the A1xx
   sides meet the pointed bow assembly (a [100x50] transition, a [50x50] tip,
   and [25x50] fuel cheeks). Everything else has the bow drawn into the flank
   art already, so adding a nose to those just floats a tile in front. */
const POINTED_BOW = new Set(["A103","A117","A118","A119","A120","A121"]);
const BOW_TIP     = new Set(["A101","A102"]);           // [50x50] tips
const BOW_TRANS   = new Set(["A104","A122","A123","A130","A131"]); // [100x50]
const BOW_CHEEK   = new Set(["A105","A106"]);           // [25x50] port/starboard

const SIDE_RE = { port: /\bPort\b/, star: /\bStarboard\b/ };
const NOSE_RE = /\bNose\b/;
const fileOf = t => t.path.split("/").pop();

/* Rooms a section ought to hold, fore to aft. Scoring rather than filtering:
   a bridge tile forward if the set has one, otherwise the best thing left. */
/* What a room is for, by the words on the tile. The same vocabulary as
   geomorph_taxonomy.py, so a slot asking for a `command` tile and a room typed
   `command` by the taxonomy mean the same thing. They did not for a while: the
   layouts had moved to the taxonomy's names while this list still held the
   original five, so every slot that asked for `command`, `bay`, `weapon` or
   `fuel` scored nothing at all and took whatever it was offered — which is why
   bridges stopped appearing at the bow. */
const ROLES = {
  drive:    ["engineering","drive","thruster","power plant","reactor","plasma conduit","battery"],
  fuel:     ["fuel","intake","scoop","tank","refinery"],
  command:  ["bridge","station","avionics","sensor","control room","cic",
             "combat information","flight control","stellar cartography","communication"],
  weapon:   ["gunnery","turret","missile","weapon","laser","barbette","spinal",
             "particle accelerator","fire control"],
  bay:      ["cargo","hangar","bay","hold","launch","shuttle","air-raft","fighter",
             "docking","landing pad","helipad","escape pod","drop capsule"],
  quarters: ["stateroom","barrack","low berth","passenger","galley","mess","lounge",
             "fresher","gym","medical","surgery","suite","brig"],
  service:  ["repair","shop","lab","office","briefing","computer","security",
             "storage","locker","classroom","retail","utility"],
  green:    ["arboretum","hydroponic","agricultur","animal","biosphere","pool"],
  vertical: ["elevator","stairs","lift","vertical core","catwalk","gangway","tram"],
  airlock:  ["airlock","iris valve","cargo door","bay door"],
};
function score(tile, role){
  if (!role) return 0;
  const words = ROLES[role] || [];
  let n = 0;
  for (const w of words) if (tile.search.includes(w)) n += 1;
  return n;
}

function buildPools(setSel){
  setSel = setSel || SETSEL;
  SETSEL = setSel;
  const inSet = t => setSel === "all"
    ? (t.set === "Geomorphs" || t.set === "Custom-Tiles")
    : t.set === setSel;
  const base = LIB.filter(t=>!t.overlay && inSet(t));
  POOL = {
    core:      base.filter(t=>t.kind==="core"      && canonical(t,100,100)),
    end:       base.filter(t=>t.kind==="end"       && canonical(t,100,100)),
    edge:      base.filter(t=>t.kind==="edge"      && canonical(t,100,50)),
    corner:    base.filter(t=>t.kind==="corner"    && canonical(t,50,50)),
    megamorph: base.filter(t=>t.kind==="megamorph" && canonical(t,200,100)),
  };
  buildFamilies(base);

  /* With the taxonomy loaded, a slot no longer needs a folder — it needs tiles
     of the right size, and the fit test does the rest. */
  BYSIZE = new Map();
  PLACEABLE = base.filter(t=>t.kind !== "craft" && t.kind !== "ship" && t.kind !== "baseplate");
  for (const t of PLACEABLE){
    const [w, h] = taxOf(t).ft;
    for (const key of new Set([w + "x" + h, h + "x" + w])){
      if (!BYSIZE.has(key)) BYSIZE.set(key, []);
      BYSIZE.get(key).push(t);
    }
  }
  if (!POOL.end.length)  POOL.end  = POOL.core;
  if (!POOL.edge.length) POOL.edge = POOL.core;
  /* An overlay belongs to one tile, and "one tile" means the same index in the
     same folder — not merely the same index. Codes repeat: 66 of 977 span more
     than one directory, and keying on the code alone let an E700 [Overlay]
     Pointed Nose land on the Rounded Nose base sitting under the same number.
     Sixteen overlays could cross like that. */
  OVERLAYS = new Map();
  for (const t of LIB){
    if (!t.overlay || !t.code) continue;
    const key = overlayKey(t);
    if (!OVERLAYS.has(key)) OVERLAYS.set(key, []);
    OVERLAYS.get(key).push(t);
  }
  SYMBOLS = LIB.filter(t=>t.kind==="symbol").sort((a,b)=>a.path.localeCompare(b.path));
}

/* Group the Port/Starboard art into hull forms: one code, one size, both
   sides, a length that whole 100 ft spine sections fit into. */
function buildFamilies(base){
  const by = new Map();
  for (const t of base){
    const f = fileOf(t);
    const side = SIDE_RE.port.test(f) ? "port" : SIDE_RE.star.test(f) ? "star" : null;
    if (!side || !t.code || t.h % 100 || t.w < 25) continue;
    if (t.set === "AdventureClass") continue;   // those go with the 50 ft spine below
    const key = t.code + "|" + t.w + "x" + t.h;
    if (!by.has(key)) by.set(key, {key, code:t.code, w:t.w, h:t.h, port:[], star:[], nose:[]});
    by.get(key)[side].push(t);
  }
  FAMILIES = [...by.values()].filter(f=>f.port.length && f.star.length);
  for (const f of FAMILIES){
    f.nose = base.filter(t=>t.code === f.code && t.w === 100 && NOSE_RE.test(fileOf(t)));
    f.bow  = f.nose.length ? "own" : POINTED_BOW.has(f.code) ? "pointed" : "none";
    /* The art has to agree that these are sides: a port piece joins on its east
       edge, a starboard piece on its west. Where the taxonomy says otherwise the
       pair is not a wing pair, whatever the filename claims. */
    const px = taxOf(f.port[0]), sx = taxOf(f.star[0]);
    f.pairOK = !px.skin.length || !sx.skin.length ||
      (px.attach.includes("e") && sx.attach.includes("w"));
    f.label = f.code + " · " + f.w + "×" + f.h + " ft · " + f.port[0].label.replace(/^(Port|Starboard)[,\s]*/,"");
  }
  FAMILIES.sort((a,b)=>a.code.localeCompare(b.code));

  /* Geomorph Shipyard's five roles, straight off the folder names. Sides come
     as two files per code, so pair them the way its library does: the
     starboard drawing is the part, the port one is its mirror. */
  const ac = base.filter(t=>t.set === "AdventureClass");
  const sides = kind => {
    const by = new Map();
    for (const t of ac){
      if (t.kind !== kind || !t.code) continue;
      if (!by.has(t.code)) by.set(t.code, {code:t.code, w:t.w, h:t.h});
      by.get(t.code)[t.tag === "Port" ? "port" : "star"] = t;
    }
    return [...by.values()].filter(f=>f.port && f.star);
  };
  AC = {
    fore: ac.filter(t=>t.kind === "fore"),
    aft:  ac.filter(t=>t.kind === "aft"),
    hg:   ac.filter(t=>t.kind === "hg"),
    qg:   ac.filter(t=>t.kind === "qg"),
    lg:   ac.filter(t=>t.kind === "lg"),
    sh:   ac.filter(t=>t.kind === "sh"),
    ls:   sides("ls"),
    ss:   sides("ss"),
  };
  AC.ready = AC.fore.length && AC.aft.length && (AC.hg.length || AC.sh.length);
  BOW = {
    tip:   base.filter(t=>BOW_TIP.has(t.code)   && t.w === 50  && t.h === 50),
    trans: base.filter(t=>BOW_TRANS.has(t.code) && t.w === 100 && t.h === 50),
    cheek: {
      port: base.filter(t=>BOW_CHEEK.has(t.code) && SIDE_RE.port.test(fileOf(t))),
      star: base.filter(t=>BOW_CHEEK.has(t.code) && SIDE_RE.star.test(fileOf(t))),
    },
  };
  /* The page renders this list; the model only says what the choices are. */
  WING_FORMS = [
    ...[...AC.ls, ...AC.ss].map(side=>({
      value: "ac:" + side.code,
      label: "AC " + side.code + " · " + side.w + "×" + side.h + " ft · " + side.star.label,
    })),
    ...FAMILIES.map(f=>({value:f.key, label:f.label})),
  ];
}

/* ---------- where a tile may sit ----------
   tiles.taxonomy.json records, for every tile, which of its four sides are the
   ship's skin and which can take a neighbour — read off the alpha channel by
   geomorph_taxonomy.py, with the four canonical folders filling in where a
   straight hull wall drawn on the boundary looks exactly like an interior wall.

   That turns placement into a fit test instead of a folder assumption: rotate a
   tile until the sides facing other tiles are all joinable, and prefer the
   rotation that also turns its skin outward. It finds the mirrored corners the
   old hard-coded rotations got wrong, and it finds sterns in Engineering and
   bows in the Bridge nose kits without being told they are there. */
const SIDES = ["n","e","s","w"];

/* The taxonomy is a fetched file, and fetch is blocked on file:// — so when the
   tiles come in through the folder picker there is none. Fall back to what the
   archive itself declares: the four canonical folders are drawn to a fixed
   orientation (bow north), Bridge holds nose kits and Engineering holds sterns.
   Coarser than reading the art, but the page keeps working. */
const FOLDER_SKIN = {
  edge:["n"], corner:["n","w"], end:["e","n","w"],
  bridge:["e","n","w"], engineering:["e","s","w"],
  core:[], megamorph:[],
};
const MIRROR_FLIP = {n:"n", s:"s", w:"e", e:"w"};
function shapeClass(attach){
  if (attach.length === 4) return "core";
  if (!attach.length) return "island";
  if (attach.length === 1) return (attach[0] === "e" || attach[0] === "w") ? "side" : "cap";
  if (attach.length === 3) return "edge";
  const a = attach.join("");
  if (a === "ns" || a === "ew") return "spine";
  return "corner";
}
function taxOf(t){
  if (t.tax) return t.tax;
  if (!t._tax){
    let skin = FOLDER_SKIN[t.kind] || [];
    if (t.mirror) skin = skin.map(c=>MIRROR_FLIP[c]);
    const attach = SIDES.filter(x=>!skin.includes(x));
    t._tax = {ft:[t.w, t.h], skin, attach, class:shapeClass(attach),
              roles:[], needsSkin:false, source:"folder"};
  }
  return t._tax;
}
function turn(list, rot){
  const k = ((rot / 90) % 4 + 4) % 4;
  return new Set(list.map(s=>SIDES[(SIDES.indexOf(s) + k) % 4]));
}
function tileFt(t, rot){
  const ft = taxOf(t).ft;
  return (rot === 90 || rot === 270) ? [ft[1], ft[0]] : ft;
}

/* Work out which sides of each slot face another slot rather than open space. */
function neighbours(slots){
  for (const a of slots){
    a.inside = {n:false, s:false, e:false, w:false};   // any tile at all
    a.room   = {n:false, s:false, e:false, w:false};   // a compartment, specifically
    for (const b of slots){
      if (a === b) continue;
      const overlapX = Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y);
      const note = side => { a.inside[side] = true; if (b.want === "core") a.room[side] = true; };
      if (overlapX > 0){
        if (b.y + b.h === a.y) note("n");
        if (b.y === a.y + a.h) note("s");
      }
      if (overlapY > 0){
        if (b.x + b.w === a.x) note("w");
        if (b.x === a.x + a.w) note("e");
      }
    }
  }
  return slots;
}

/* Score a tile in a slot, over all four rotations. null when it cannot go there
   at all: a side facing another tile that is skin would put the ship's outer
   hull in the middle of the ship. `relax` drops that rule, in order, so a thin
   pool degrades to something rather than to a hole. */
function fit(tile, slot, relax){
  const tax = taxOf(tile);
  let best = null;
  for (const rot of [0, 90, 180, 270]){
    const [w, h] = tileFt(tile, rot);
    if (w !== slot.w || h !== slot.h) continue;
    const skin = turn(tax.skin, rot), attach = turn(tax.attach, rot);
    /* Where a tile's art spills past its own box — a pod door, a turret, a
       scoop hanging into the margin — the artist has claimed that ground. A
       neighbour there would be drawn through. Those sides face space or they
       face nothing. */
    const proud = turn(tax.proud || [], rot);
    let ok = true, score = 0;
    for (const side of SIDES){
      if (proud.has(side) && slot.inside[side]){ ok = false; break; }
    }
    if (!ok && relax < 2) continue;
    ok = true;
    for (const side of SIDES){
      if (slot.room && slot.room[side]){
        // A compartment is through there: this side has to be joinable.
        if (!attach.has(side)){ ok = false; break; }
      } else if (slot.inside[side]){
        /* Plating alongside plating. Two hull pieces meeting is what a hull is
           made of, and demanding the join be walkable is what forced the gaps
           beside a nose and at every step — gaps the vacuum then flooded in
           through, which is why the ends of a ship went uncovered. */
        if (skin.has(side)) score += 0.5;
      } else if (skin.has(side)) {
        score += 2;                       // the skin faces space, as it should
      }
    }
    if (!ok && relax < 1) continue;
    if (!ok) score -= 6;
    // A hangar mouth, an airlock or a fuel scoop has to open onto something.
    if (tax.needsSkin && !SIDES.some(side=>!slot.inside[side] && skin.has(side))) score -= 3;
    if (tax.class === "loose" || tax.class === "island") score -= 5;
    /* A wing turned on its end will fit a bow slot — one join, three skins — but
       it is still a wing. Shape has to agree with the job, not just the edges. */
    if (slot.want) score += tax.class === slot.want ? 3 : -3;
    /* Where the hull changes beam, a piece that cuts the corner reads as a
       chamfer instead of a notch. Only 23 tiles in the archive draw their hull
       line diagonally, so this is a preference, not a requirement. */
    if (slot.chamfer && tax.slope >= 0.45 && tax.cut > 0.12) score += 8;
    /* A fuel intake scoop faces the way the ship is going. Putting one on the
       stern is the sort of thing only a generator does. */
    if (slot.aft && /intake|scoop/.test(tile.search)) score -= 6;
    if (!best || score > best.score) best = {rot, score};
  }
  return best;
}

/* Pick the best tile a pool can offer for one slot. Walks a shuffled deck so a
   plan does not repeat itself, then relaxes only if nothing fits. */
function candidates(slot, role){
  const pool = BYSIZE.get(slot.w + "x" + slot.h) || [];
  /* Seven tiles in nine hundred cut their corner diagonally, so a sample of
     ninety misses them half the time and the shoulder of a step came out square
     for no better reason than that. Offer them first where one is wanted. */
  if (slot.chamfer){
    const diag = [], rest = [];
    for (const t of pool){
      const x = taxOf(t);
      (x.slope >= 0.45 && x.cut > 0.12 ? diag : rest).push(t);
    }
    return [...shuffle(diag), ...shuffle(rest)].slice(0, 90);
  }
  if (!role) return shuffle(pool).slice(0, 90);
  /* Ninety tiles drawn at random from two hundred will often contain no bridge
     at all, and then the slot that asked for one takes whatever it was shown.
     Offer the tiles that suit the job first. */
  const fits = [], rest = [];
  for (const t of pool) (score(t, role) ? fits : rest).push(t);
  return [...shuffle(fits), ...shuffle(rest)].slice(0, 90);
}
/* Some things a ship has exactly one of. Nothing stopped the bow cap, every bay
   of the first row and the whole bow strip all asking for a bridge, so a wide
   hull came out with four of them and the mirror pass doubled that again. A
   spent role stops being asked for, and tiles that answer it are scored down so
   a second one does not slip in on shape alone. */
const ROLE_LIMIT = {command: 1};
/* What counts against the limit is narrower than what answers the role. A
   hangar with a launch control in it is somewhere to steer a fighter from, not
   a second bridge, and counting it as one used the ship's allowance up on the
   wrong tile. */
const LIMIT_TEST = {command: t => /\bbridge\b/.test(t.search)};
let SPENT = {};

function overBudget(tile){
  let n = 0;
  for (const role in ROLE_LIMIT)
    if ((SPENT[role] || 0) >= ROLE_LIMIT[role] && LIMIT_TEST[role](tile)) n += 20;
  return n;
}
function spend(tile){
  for (const role in ROLE_LIMIT)
    if (LIMIT_TEST[role](tile)) SPENT[role] = (SPENT[role] || 0) + 1;
}

function bestFor(pool, slot, role, used){
  // Asking for what has already been fitted just wastes the slot.
  if (role && ROLE_LIMIT[role] && (SPENT[role] || 0) >= ROLE_LIMIT[role]) role = null;
  for (let relax = 0; relax <= 2; relax++){
    const scored = [];
    let top = -Infinity;
    for (const tile of pool){
      const f = fit(tile, slot, relax);
      if (!f) continue;
      const s = f.score + score(tile, role) * 3 - (used.has(tile.path) ? 4 : 0)
              - overBudget(tile);
      scored.push({tile, rot:f.rot, s, relax});
      if (s > top) top = s;
    }
    if (!scored.length) continue;
    /* Take one of the good ones, not the best one. Scores come in steps — three
       for the shape, three per role word, two per side of skin facing space — so
       a great many tiles tie, and picking the single maximum handed one tile
       every stern in the archive: 760, six seeds running. Anything within a
       point of the top answers the question just as well. */
    const near = scored.filter(c=>c.s >= top - 1.01);
    const chosen = near[Math.floor(rnd() * near.length)];
    used.add(chosen.tile.path);
    spend(chosen.tile);
    return chosen;
  }
  return null;
}

/* A dealer that walks a shuffled pool, so one plan repeats a tile
   only once every tile in the pool has been used. */
function dealer(list){
  let deck = shuffle(list), i = 0;
  /* With a role, look a little way down the deck and take the tile that best
     fits the job — a bridge forward, engineering aft — without abandoning the
     no-repeats walk. */
  return (role) => {
    if (!deck.length) return null;
    if (i >= deck.length){ deck = shuffle(list); i = 0; }
    if (!role) return deck[i++];
    let best = i, bestScore = -1;
    for (let k = i; k < Math.min(deck.length, i + 24); k++){
      const sc = score(deck[k], role);
      if (sc > bestScore){ best = k; bestScore = sc; }
      if (bestScore >= 2) break;
    }
    const t = deck[best];
    deck.splice(best, 1);
    deck.splice(i, 0, t);
    return deck[i++];
  };
}

/* ---------- layout ---------- */
function layout(input){
  const opts = Object.assign({
    seed:"SALVOR", beam:2, rows:3, hull:"ship", sets:"all",
    family:"", profile:"2-1-2", symmetric:true, caps:true, rim:"none", q:"", spin:false, mega:true, vehic:true,
  }, input || {});
  opts.seed = String(opts.seed).trim() || "SALVOR";
  SPENT = {};                       // one bridge to a ship, counted afresh
  opts.q = String(opts.q || "").trim().toLowerCase();
  const seed = opts.seed;
  RNG = mulberry32(hashStr(seed));
  // A room filter narrows the interior only — the hull still has to close.
  const narrow = list => {
    if (!opts.q) return list;
    const words = opts.q.split(/[,\s]+/).filter(Boolean);
    const hit = list.filter(t=>words.some(w=>t.search.includes(w)));
    return hit.length ? hit : list;
  };
  const deal = {
    core:   dealer(narrow(POOL.core)),
    end:    dealer(POOL.end),
    edge:   dealer(POOL.edge),
    corner: dealer(POOL.corner),
    mega:   dealer(narrow(POOL.megamorph)),
  };
  const put = [];
  /* Overlays are vehicles drawn on their parent tile — same code, same size,
     so they ride along with whatever rotation the parent got. */
  const place = (tile, x, y, w, h, rot) => {
    if (!tile) return null;
    const p = {tile, cx:x + w/2, cy:y + h/2, rot:rot||0, x, y, w, h};
    put.push(p);
    if (opts.vehic && tile.code){
      const ov = OVERLAYS.get(overlayKey(tile));
      /* How often a tile that has furniture gets some. The page draws vehicles
         as an occasional flourish; a game wants the rooms furnished every time,
         because the base tile on its own is a blank shell. */
      const chance = typeof opts.overlayChance === "number" ? opts.overlayChance : 0.75;
      /* Narrow to the overlays that actually fit before choosing one. Picking
         first and discarding afterwards meant a code with three overlays and
         one of the right size furnished the room a third of the time. */
      const fits = ov ? ov.filter(o=>o.px[0] === tile.px[0] && o.px[1] === tile.px[1]) : [];
      if (fits.length && rnd() < chance)
        put.push({tile:pick(fits), cx:p.cx, cy:p.cy, rot:p.rot, x, y, w, h});
    }
    return p;
  };

  /* Adventure Class is an optional extra download, so it never takes over on
     its own: ask for it in the Tiles list and you get Shipyard's own parts,
     otherwise the Mobius tiles build the ship. */
  const useAC = AC.ready && opts.sets === "AdventureClass";
  const built = opts.hull === "profile" ? layoutProfile(opts, deal, place)
              : opts.hull !== "ship" ? layoutDeck(opts, deal, place)
              : useAC ? layoutAdventureShip(opts, deal, place)
              : layoutShip(opts, deal, place);

  /* Ends can be wider than the hull they cap, so let the parts decide the
     drawing's extent rather than the other way round. */
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of put){
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h);
  }
  if (put.length){
    for (const p of put){ p.x -= minX; p.y -= minY; p.cx -= minX; p.cy -= minY; }
    built.W = maxX - minX; built.H = maxY - minY;
  }

  PLAN = Object.assign({seed, put, name: shipName(),
    tons: put.reduce((n,p)=>n + (p.tile.overlay ? 0 : p.tile.tons||0), 0) ||
          Math.round((built.W/5)*(built.H/5)/2)}, built, {hull: opts.hull});
  return PLAN;
}

/* Geomorph Shipyard's rollShip, in the Mobius page's frame: bow at the top
   rather than to the left. It picks one fore end, one hull centre, one aft end,
   and — on a coin flip — one pair of sides, mirrored, placed once and centred
   on the hull. HG and QG centres are drawn lengthwise, so they are turned; LG
   and Sh are drawn upright and are not. Then it rerolls unless the ship came
   out with both bridge and engineering space. */
function layoutAdventureShip(opts, deal, place){
  const famSel = opts.family || "";
  const long   = opts.rows > 1 || rnd() < 0.5;
  let winged   = famSel !== "none" && (AC.ls.length || AC.ss.length);
  if (winged && !famSel) winged = rnd() < 0.66;

  const centrePool = winged ? (long ? AC.hg : AC.qg) : (long ? AC.lg : AC.sh);
  const centres = centrePool.length ? centrePool : AC.sh.length ? AC.sh : AC.hg;
  const turned  = centres === AC.hg || centres === AC.qg;   // drawn lengthwise
  let wingPool = long ? AC.ls : AC.ss;
  if (famSel.startsWith("ac:")){
    const one = [...AC.ls, ...AC.ss].filter(f=>f.code === famSel.slice(3));
    if (one.length){ wingPool = one; winged = true; }
  }
  const wings = winged && wingPool.length ? wingPool : null;

  const sections = Math.max(1, opts.rows);
  let sel;
  for (let attempt = 0; attempt < 10; attempt++){
    sel = {
      head: pick(AC.fore),
      /* Every section has to be the same width or the hull gets notches, so the
         first pick sets the beam and the rest are drawn from that width only. */
      hull: (()=>{
        if (sections === 1) return [pick(centres)];
        /* rollShip uses a single centre, so any oddity in the pool — a spinal
           mount barrel, a half-length fragment — is just one part. Stacking
           needs sections that actually fill their box and agree on the beam,
           so take only full-length ones and hold the first pick's width. */
        const dimsOf = t => turned ? [t.h, t.w] : [t.w, t.h];
        const full = centres.filter(t=>dimsOf(t)[1] >= 100);
        const from = full.length ? full : centres;
        const first = pick(from);
        const same = from.filter(t=>dimsOf(t)[0] === dimsOf(first)[0]);
        const d = dealer(same.length ? same : [first]);
        return [first, ...Array.from({length: sections-1}, ()=>d())];
      })(),
      tail: pick(AC.aft),
      wing: wings ? pick(wings) : null,
    };
    const all = [sel.head, ...sel.hull, sel.tail, sel.wing && sel.wing.star].filter(Boolean);
    if (all.some(t=>score(t,"command")) && all.some(t=>score(t,"drive"))) break;
  }

  /* Sections are not all the same length, so stack them by their own lengths
     and hang everything off one centreline. */
  const dims = t => turned ? [t.h, t.w] : [t.w, t.h];
  const secW = Math.max(...sel.hull.map(t=>dims(t)[0]));
  const mid  = secW / 2;

  place(sel.head, mid - sel.head.w/2, -sel.head.h, sel.head.w, sel.head.h, 0);
  let y = 0;
  for (const t of sel.hull){
    const [w, h] = dims(t);
    place(t, mid - w/2, y, w, h, turned ? 90 : 0);
    y += h;
  }
  const body = y;
  place(sel.tail, mid - sel.tail.w/2, body, sel.tail.w, sel.tail.h, 0);

  if (sel.wing){
    const wy = Math.max(0, Math.round((body - sel.wing.h) / 100) * 50);
    place(sel.wing.port, mid - secW/2 - sel.wing.w, wy, sel.wing.w, sel.wing.h, 0);
    place(sel.wing.star, mid + secW/2,              wy, sel.wing.w, sel.wing.h, 0);
  }
  return {W:0, H:0, parts:"AdventureClass", beam:1, rows:sections,
    familyLabel: sel.wing ? sel.wing.code + " sides" : "no sides"};
}

/* A hull the way Geomorph Shipyard rolls one (src/lib/geomorphs/tinyRandomShip.js,
   GPL-3.0 — read, not copied): a ship is a head, a hull, a tail, and at most one
   mirrored wing pair centred on the hull. Its part library is split by how many
   connections a piece has and where, and rollShip picks exactly one of each,
   placing the wings once, centred on the hull's length rather than repeated down
   it. It then rerolls, up to ten times, unless the ship ended up with both bridge
   and engineering space.

   The Mobius archive has no SE/LS/HG parts, but the taxonomy finds the same
   roles in it by shape. A bow is a tile that joins on one side only, and that
   side faces aft; a stern is the same turned around — which is why the sterns
   come out of Custom-Tiles/Engineering and the bows out of the Bridge nose kits
   and the End folder, with nothing hard-coded to say so. */
function layoutShip(opts, deal, place){
  const SPINE = 100;
  const span  = opts.rows * 100;
  const famSel = opts.family || "";

  let fam = null;
  if (famSel === "none") fam = null;
  else if (famSel && !famSel.startsWith("ac:")) fam = FAMILIES.find(f=>f.key === famSel) || null;
  else if (!famSel){
    const fits = FAMILIES.filter(f=>f.h <= span && f.pairOK);
    if (fits.length && rnd() < 0.66) fam = pick(fits);
  }
  if (fam && fam.h > span) fam = null;

  const wingY = fam ? Math.max(0, Math.round((span - fam.h) / 100) * 50) : 0;
  const fw = fam ? fam.w : 0;
  const x0 = fw;

  /* Lay out the slots first, then let each one ask the library what fits.
     The bow slot is simply the one with open space on three sides. */
  const slots = [];
  const bow = {x:x0, y:-100, w:SPINE, h:100, role:"command", tag:"bow", want:"cap"};
  slots.push(bow);
  for (let j = 0; j < opts.rows; j++)
    slots.push({x:x0, y:j*100, w:SPINE, h:100, tag:"hull", want:"core",
      role: j === opts.rows-1 ? "drive" : j === 0 ? "quarters" : rnd() < 0.5 ? "bay" : "quarters"});
  slots.push({x:x0, y:span, w:SPINE, h:100, role:"drive", tag:"stern", want:"cap"});
  if (fam){
    slots.push({x:0,          y:wingY, w:fam.w, h:fam.h, role:"fuel", tag:"port"});
    slots.push({x:fw + SPINE, y:wingY, w:fam.w, h:fam.h, role:"fuel", tag:"star"});
  }
  neighbours(slots);

  /* Sides come in matched drawings, so pick the variant once and keep both
     halves of the pair in step. */
  const wingPair = fam ? (()=>{
    const i = Math.floor(rnd() * fam.port.length);
    const port = fam.port[i];
    const star = fam.star.find(t=>t.label === port.label) || fam.star[i % fam.star.length];
    return {port, star};
  })() : null;

  let relaxed = 0;
  const used = new Set();
  for (let attempt = 0; attempt < 6; attempt++){
    const picks = [];
    used.clear(); relaxed = 0;
    for (const slot of slots){
      // The wings are a matched pair, so they are placed as one decision.
      if (slot.tag === "port"){ picks.push({slot, tile:wingPair.port, rot:0}); continue; }
      if (slot.tag === "star"){ picks.push({slot, tile:wingPair.star, rot:0}); continue; }
      const c = bestFor(candidates(slot, slot.role), slot, slot.role, used);
      if (!c) continue;
      if (c.relax) relaxed++;
      picks.push({slot, tile:c.tile, rot:c.rot});
    }
    const tiles = picks.map(p=>p.tile);
    const good = tiles.some(t=>score(t,"command")) && tiles.some(t=>score(t,"drive"));
    if (good || attempt === 5){
      for (const p of picks) place(p.tile, p.slot.x, p.slot.y, p.slot.w, p.slot.h, p.rot);
      break;
    }
  }
  return {W:0, H:0, family: fam ? fam.key : null, relaxed,
    familyLabel: fam ? fam.label : "no wings", beam:1, rows:opts.rows};
}

/* A hull described by its sections: "2-1-2" is two bays wide, then one, then
   two — a waisted ship. Anything the tiles can close is allowed: "1-2-3" tapers,
   "3-1-3" pinches to a waist, "2" is a plain double hull.
 
   Bays are 100 ft and sit on the 50 ft grid the geomorph system is cut to, so a
   section whose width has the other parity is centred half a bay across from its
   neighbours — and the corridors still meet, because the connecting stubs are at
   the quarter points of every tile edge, 25 ft and 75 ft, and a 50 ft shift maps
   one onto the other. That is what makes 2-1-2 a legal hull rather than a hull
   with its middle third bricked up.
 
   The rim is not laid out by hand here. Every 50 ft cell touching the outline
   becomes a slot; straight runs merge into the 100x50 edge tiles that exist for
   them, turns stay 50x50 for the corner tiles, and the fit test rotates each to
   put its skin outward. Convex corner, inner corner where a section steps in,
   the flat of a beam — all the same rule, so the hull closes whatever shape the
   profile asks for. */
function parseProfile(text){
  const parts = String(text || "").split(/[^0-9]+/).filter(Boolean)
    .map(Number).filter(n=>n >= 1 && n <= 6);
  return parts.length ? parts.slice(0, 12) : [1];
}

function layoutProfile(opts, deal, place){
  const prof = parseProfile(opts.profile);
  const maxW = Math.max(...prof);
  const G = 50;                                   // the grid everything sits on

  const bays = [];
  prof.forEach((w, row)=>{
    const x0 = (maxW - w) * 50;                   // centred; half a bay is fine
    for (let i = 0; i < w; i++) bays.push({x:x0 + i*100, y:row*100, row});
  });
  const core = new Set();
  for (const b of bays)
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++)
      core.add((b.x/G + dx) + "," + (b.y/G + dy));
  const isCore = (gx, gy) => core.has(gx + "," + gy);

  /* A hull needs a front and a back. Rimming the whole outline the same way
     gives a ship walled in at both ends: an edge tile facing forward is a wall
     with a room behind it, never a nose, and the drives never appear because
     nothing ever asks for a piece that is only a stern. Cap the first and last
     sections instead — the same [100x100] ends ship mode uses, which is where
     the archive keeps its bridges and its engine rooms. */
  /* One bay wide, centred, whatever the section behind it. A wide end has to be
     built out of corner blocks, and the archive holds thirteen of those at
     100x100 with exactly one engine room in the lot — which is why every 2-bay
     stern came out as the same tile twice, six seeds running. A single bay is a
     cap, and there are seventy of those, twenty with a bridge and ten with
     drives. It also gives the hull a point at each end, which is what ships
     look like. */
  const caps = [];
  if (opts.caps !== false){
    const mid = (maxW - 1) * 50;
    caps.push({x:mid, y:-100, w:100, h:100, want:"cap", role:"command"});
    caps.push({x:mid, y:prof.length*100, w:100, h:100, want:"cap", role:"drive"});
  }
  const capped = new Set();
  for (const c of caps)
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++)
      capped.add((c.x/G + dx) + "," + (c.y/G + dy));

  /* What goes round the outside.

     A border of edge and corner tiles all the way round is not how a deck plan
     is drawn — the cores are closed compartments already — and the archive's
     corner pieces are mostly fuel scoops and gun positions, which is how intake
     scoops came to be on the back of a ship.

     But where the beam changes, a corner earns its place: a step is a right
     angle, and a piece whose hull line runs diagonally turns it into a taper.
     That is "steps", the default — the shoulder cells at a change of beam and
     nothing else. "sides" plates the flanks as well, "full" is all the way
     round, "none" leaves the hull bare. */
  const wantRim = opts.rim || "steps";

  /* Every cell that touches the hull from outside, corners included — except
     the shoulder of a step. At an inner corner the band would wrap a cell with
     hull on two sides and its own neighbours on the other two, and the archive
     has no such tile: at 50 ft it offers 437 pieces with one joinable side and
     345 with two, all of them hull, 4 with three and none with four. The
     interior module of this system is 100 ft and nothing smaller. Leaving the
     shoulder open costs a 50 ft recess in the outline and lets the pieces on
     either side be the corners they already are. */
  const rim = new Set();
  for (const key of core){
    const [gx, gy] = key.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
      const k = (gx + dx) + "," + (gy + dy);
      if (!core.has(k) && !capped.has(k)) rim.add(k);
    }
  }
  for (const key of [...rim]){
    const [gx, gy] = key.split(",").map(Number);
    const f = {n:isCore(gx,gy-1), s:isCore(gx,gy+1), w:isCore(gx-1,gy), e:isCore(gx+1,gy)};
    const on = ["n","s","w","e"].filter(k=>f[k]);
    if (on.length >= 3) rim.delete(key);       // a pocket no tile can furnish
  }

  /* Two rim cells along the same face are one edge tile; a cell that turns a
     corner is left alone for a corner tile. */
  const used = new Set();
  const slots = [...caps];
  const rows = prof.length;
  for (const b of bays)
    slots.push({x:b.x, y:b.y, w:100, h:100, want:"core",
      role: b.row === 0 ? "command" : b.row === rows-1 ? "drive"
          : rnd() < 0.5 ? "bay" : "quarters"});

  const faceOf = (gx, gy) => ({
    n: isCore(gx, gy-1), s: isCore(gx, gy+1),
    w: isCore(gx-1, gy), e: isCore(gx+1, gy),
  });
  const lastRow = prof.length * 2;              // in half-bay cells
  /* A shoulder: the cell in the notch where a narrow section meets a wide one,
     touching hull on two sides at right angles. Fill that with a tile whose
     hull line cuts the corner and the step reads as a taper. */
  const shoulder = key => {
    const [gx, gy] = key.split(",").map(Number);
    const f = {n:isCore(gx,gy-1), s:isCore(gx,gy+1), w:isCore(gx-1,gy), e:isCore(gx+1,gy)};
    const on = ["n","s","w","e"].filter(k=>f[k]);
    return on.length === 2 && !(f.n && f.s) && !(f.e && f.w);
  };
  for (const key of (wantRim === "none" ? [] : [...rim].sort())){
    if (used.has(key)) continue;
    const [kx, ky] = key.split(",").map(Number);
    if (wantRim === "steps" && !shoulder(key)) continue;
    // "sides" leaves the bow and stern faces to the caps.
    if (wantRim === "sides" && (ky < 0 || ky >= lastRow)) continue;
    const [gx, gy] = key.split(",").map(Number);
    const f = faceOf(gx, gy);
    const flat = ["n","s","w","e"].filter(k=>f[k]);
    if (flat.length === 1){
      const side = flat[0];
      const along = (side === "n" || side === "s") ? [1, 0] : [0, 1];
      const nk = (gx + along[0]) + "," + (gy + along[1]);
      const nf = faceOf(gx + along[0], gy + along[1]);
      if (rim.has(nk) && !used.has(nk) &&
          ["n","s","w","e"].filter(k=>nf[k]).length === 1 && nf[side]){
        used.add(key); used.add(nk);
        slots.push({x:gx*G, y:gy*G, w:along[0] ? 100 : 50, h:along[0] ? 50 : 100,
          want:"edge", aft: side === "n",
          role: side === "s" ? "command" : side === "n" ? "drive" : "weapon"});
        continue;
      }
    }
    used.add(key);
    /* A corner at the top or bottom of the ship is the shape of the hull; one
       part-way down is a change of beam, and that is where a chamfer helps. */
    const step = gy > 0 && gy < rows*2;
    /* No role on a shoulder. Asking for "fuel" as well as a diagonal handed all
       four corners of a hull to the same Fuel Deck tile; the shape is what
       matters here and the archive has seven pieces that can do it. */
    slots.push({x:gx*G, y:gy*G, w:50, h:50, want:"corner",
      role: wantRim === "steps" ? null : "fuel",
      chamfer:step, aft: gy >= lastRow});
  }
  /* Wings, if a form is chosen or the seed asks for one: a matched Port and
     Starboard pair hung on the flanks of the longest section of constant beam,
     centred on it, the same way ship mode does it. */
  const famSel = opts.family || "";
  let fam = null, station = {from:0, to:prof.length - 1};
  if (famSel && famSel !== "none" && !famSel.startsWith("ac:"))
    fam = FAMILIES.find(f=>f.key === famSel) || null;
  else if (!famSel){
    let best = {from:0, to:0, w:0};
    for (let i = 0; i < prof.length; i++){
      let j = i;
      while (j + 1 < prof.length && prof[j+1] === prof[i]) j++;
      if (j - i >= best.to - best.from){ best = {from:i, to:j, w:prof[i]}; }
      i = j;
    }
    const span = (best.to - best.from + 1) * 100;
    const fits = FAMILIES.filter(f=>f.h <= span && f.pairOK);
    if (fits.length && rnd() < 0.66) fam = pick(fits);
    station = best;
  }
  if (fam){
    const w = prof[station.from];
    const x0 = (maxW - w) * 50;
    const y = station.from*100 +
      Math.round(((station.to - station.from + 1)*100 - fam.h) / 100) * 50;
    const i = Math.floor(rnd() * fam.port.length);
    const port = fam.port[i];
    const star = fam.star.find(t=>t.label === port.label) || fam.star[i % fam.star.length];
    place(port, x0 - fam.w, y, fam.w, fam.h, 0);
    place(star, x0 + w*100, y, fam.w, fam.h, 0);
  }

  neighbours(slots);

  /* What shape a slot wants is not a guess — it is how many sides face another
     tile. One is a cap, two adjacent a corner, three an edge, four a core. A
     notch in the hull asks for a cap and gets one, which is why an inner corner
     closes as readily as an outer one. */
  for (const slot of slots){
    if (slot.want === "core" || slot.want === "cap") continue;
    const inside = SIDES.filter(k=>slot.inside[k]);
    slot.want = inside.length === 4 ? "core"
              : inside.length === 3 ? "edge"
              : inside.length === 1 ? "cap"
              : inside.length === 0 ? "island"
              : (inside[0] === "n" && inside[1] === "s") ||
                (inside[0] === "e" && inside[1] === "w") ? "spine" : "corner";
  }

  /* A hull the same width to port and starboard should look it. The fit test
     judges each slot alone, so the left and right corners come out as two
     unrelated pieces — correct, and obviously arbitrary. Pairing them costs
     nothing: pick for one side, then give the slot opposite the same tile,
     mirrored across the keel.

     Across the keel and nowhere else. A ship is symmetric side to side; bow and
     stern are not interchangeable, and mirroring a palindromic profile fore and
     aft would put the same piece at both ends of the ship. */
  const xs = slots.map(s=>s.x), xe = slots.map(s=>s.x + s.w);
  const cx = (Math.min(...xs) + Math.max(...xe)) / 2;
  const at = new Map(slots.map(s=>[s.x + "," + s.y + "," + s.w + "," + s.h, s]));
  const twin = s => at.get((2*cx - s.x - s.w) + "," + s.y + "," + s.w + "," + s.h);

  let relaxed = 0;
  const seen = new Set();
  const done = new Set();
  const fill = (slot, choice) => {
    done.add(slot);
    place(choice.tile, slot.x, slot.y, slot.w, slot.h, choice.rot);
  };
  const mirrorFill = (slot, choice) => { spend(choice.tile); fill(slot, choice); };
  for (const slot of slots){
    if (done.has(slot)) continue;
    const c = bestFor(candidates(slot, slot.role), slot, slot.role, seen);
    if (!c){ relaxed++; done.add(slot); continue; }
    if (c.relax) relaxed++;
    fill(slot, c);
    /* The hull is mirrored outright — a ship the same width to port and
       starboard should look it. The rooms behind it are a soft lock: mirrored
       most of the time, so the plan reads as one ship, but free often enough
       that the two sides are not a tracing of each other. "full" forces every
       bay, "hull" leaves the interior alone, "off" mirrors nothing. */
    const sym = opts.symmetric === true ? "full" : opts.symmetric || "soft";
    if (sym === "off") continue;
    if (slot.want === "core"){
      if (sym === "hull") continue;
      if (sym === "soft" && rnd() > 0.7) continue;
    }
    const other = twin(slot);
    if (!other || other === slot || done.has(other)) continue;
    const m = mirrored(c.tile, c.rot, other);
    /* Reflecting a bridge gives a ship two bridges. Where the mirror would
       spend a role the ship has already used up, leave that slot to the fit
       test — the hull stays symmetric, the pair of rooms does not. */
    if (m && !overBudget(m.tile)) mirrorFill(other, m);
  }
  return {W:(maxW*100) + 100, H:(rows*100) + 100 + (caps.length ? 200 : 0),
          beam:maxW, rows, relaxed, family: fam ? fam.key : null,
          profile: prof.join("-"),
          familyLabel: prof.join("-") + " hull" + (fam ? " · " + fam.code + " wings" : "")};
}

/* The same piece seen in a mirror. The archive draws many tiles twice, once
   [Mirror]ed, and that is the true reflection — same rotation, flipped artwork.
   Failing that, a rotation often lands on the reflected shape anyway: turning a
   corner whose skin is north-and-west by 90 degrees gives north-and-east, which
   is what a mirror would have given, only with the lettering the right way
   round. Where neither works the slot is left to the fit test. */
function mirrored(tile, rot, slot){
  const flip = {n:"n", s:"s", e:"w", w:"e"};       // across the keel
  const tax = taxOf(tile);
  const want = new Set([...turn(tax.skin, rot)].map(k=>flip[k]));
  const same = set => set.size === want.size && [...want].every(k=>set.has(k));
  const fits = (t, r) => {
    const [w, h] = tileFt(t, r);
    return w === slot.w && h === slot.h && same(turn(taxOf(t).skin, r));
  };
  const pair = LIB.find(t=>t !== tile && t.code && t.code === tile.code &&
    !!t.mirror !== !!tile.mirror && !t.overlay === !tile.overlay &&
    t.px[0] === tile.px[0] && t.px[1] === tile.px[1]);
  if (pair && fits(pair, rot)) return {tile:pair, rot};
  for (const r of [0, 90, 180, 270]) if (fits(tile, r)) return {tile, rot:r};
  return null;
}

/* The rectangular deck slab. Same engine: build the slots, let each one ask
   what fits. Nothing here knows that edge tiles are drawn with their hull to
   the north or that corners are drawn top-left — the rim slots simply have open
   space on their outward sides, and the fit test turns each tile to suit. That
   is what gets the mirrored corners right, which the hard-coded rotations did
   not. */
function layoutDeck(opts, deal, place){
  const {beam, rows, mega, hull} = opts;
  const rim = hull === "rimmed" ? 50 : 0;
  const cap = hull === "capped" ? 100 : 0;
  const W = beam*100 + rim*2;
  const H = rows*100 + rim*2 + cap*2;

  const slots = [];
  const roleFor = j => j === 0 ? "command" : j === rows-1 ? "drive"
                     : rnd() < 0.5 ? "bay" : "quarters";
  const taken = Array.from({length: rows}, ()=>new Array(beam).fill(false));
  for (let j = 0; j < rows; j++){
    for (let i = 0; i < beam; i++){
      if (taken[j][i]) continue;
      const x = rim + i*100, y = rim + cap + j*100;
      if (mega && i+1 < beam && !taken[j][i+1] && rnd() < 0.3){
        taken[j][i] = taken[j][i+1] = true;
        slots.push({x, y, w:200, h:100, role:roleFor(j), want:"core"});
      } else {
        taken[j][i] = true;
        slots.push({x, y, w:100, h:100, role:roleFor(j), want:"core"});
      }
    }
  }
  if (cap){
    for (let i = 0; i < beam; i++){
      slots.push({x:rim + i*100, y:0,     w:100, h:100, role:"command", want:"cap"});
      slots.push({x:rim + i*100, y:H-100, w:100, h:100, role:"drive", want:"cap"});
    }
  }
  if (rim){
    for (let i = 0; i < beam; i++){
      slots.push({x:50 + i*100, y:0,    w:100, h:50, role:"command", want:"edge"});
      slots.push({x:50 + i*100, y:H-50, w:100, h:50, role:"drive", want:"edge"});
    }
    for (let j = 0; j < rows; j++){
      slots.push({x:0,    y:50 + j*100, w:50, h:100, role:"weapon", want:"edge"});
      slots.push({x:W-50, y:50 + j*100, w:50, h:100, role:"weapon", want:"edge"});
    }
    slots.push({x:0,    y:0,    w:50, h:50, role:"fuel", want:"corner"});
    slots.push({x:W-50, y:0,    w:50, h:50, role:"fuel", want:"corner"});
    slots.push({x:W-50, y:H-50, w:50, h:50, role:"fuel", want:"corner"});
    slots.push({x:0,    y:H-50, w:50, h:50, role:"fuel", want:"corner"});
  }
  neighbours(slots);

  let relaxed = 0;
  const used = new Set();
  for (const slot of slots){
    const c = bestFor(candidates(slot, slot.role), slot, slot.role, used);
    if (!c) continue;
    if (c.relax) relaxed++;
    place(c.tile, slot.x, slot.y, slot.w, slot.h, c.rot);
  }
  return {W, H, beam, rows, relaxed};
}

/* Original names — nothing here comes from a licensed table. */
const NAME_A = ["Cold","Long","Quiet","Iron","Salt","Grey","Slow","Bright","Last","Deep","Hollow","Patient","Blunt","Far"];
const NAME_B = ["Anchor","Lantern","Ledger","Harrow","Tide","Meridian","Furnace","Vigil","Errand","Compass","Kettle","Argument","Winter","承"];
const NAME_C = ["Hauler","Tender","Cutter","Freighter","Liner","Monitor","Barque","Station","Hulk","Frigate","Scow","Prospector"];
function shipName(){
  const n = rnd() < 0.5 ? pick(NAME_A)+" "+pick(NAME_B) : pick(NAME_B);
  return n.replace("承","Ninth Hour") + " — " + pick(NAME_C);
}

/* ---------- loading tiles ---------- */
function probeSize(file){
  return new Promise(res=>{
    const u = URL.createObjectURL(file);
    const im = new Image();
    im.onload = ()=>{ res([im.naturalWidth, im.naturalHeight]); URL.revokeObjectURL(u); };
    im.onerror = ()=>{ res(null); URL.revokeObjectURL(u); };
    im.src = u;
  });
}
async function loadFromPicker(files, onProgress){
  const list = [...files].filter(f=>/\.png$/i.test(f.name));
  if (!list.length) return 0;
  if (onProgress) onProgress("Reading " + list.length + " tiles…");
  // Sizes come from the PNG header, which is far cheaper than decoding.
  const out = [];
  for (const f of list){
    const rel = (f.webkitRelativePath || f.name);
    const dims = await headerSize(f);
    if (!dims) continue;
    const t = parseTile(rel, dims[0], dims[1]);
    if (t){ t.file = f; out.push(t); }
  }
  LIB = out;
  return LIB.length;
}
async function headerSize(file){
  const buf = await file.slice(0,33).arrayBuffer();
  const b = new Uint8Array(buf);
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return probeSize(file);
  const dv = new DataView(buf);
  return [dv.getUint32(16), dv.getUint32(20)];
}
async function loadFromManifest(){
  try{
    const r = await fetch("geomorphs/geomorphs.manifest.json");
    if (!r.ok) throw 0;
    const m = await r.json();
    LIB = m.tiles.map(t=>{ t.base = "geomorphs/"; t.tag = t.tag || ""; t.tons = t.tons || 0;
      t.search = (t.label + " " + t.path).toLowerCase(); return t; });
    return LIB.length;
  } catch(e){ return 0; }
}
async function loadTaxonomy(){
  try{
    const r = await fetch("tiles.taxonomy.json");
    if (!r.ok) throw 0;
    const doc = await r.json();
    TAX = doc.tiles;
    let hit = 0;
    for (const t of LIB){ if (TAX[t.path]){ t.tax = TAX[t.path]; hit++; } }
    return hit;
  } catch(e){ return 0; }
}

/* ---------- tiles as images ----------
   A picked file becomes a blob URL, a manifest entry a relative path.
   Blob URLs are same-origin, which is what keeps canvas export working
   when the tiles were loaded from disk. */
function url(t){
  if (t._url) return t._url;
  t._url = t.file ? URL.createObjectURL(t.file) : encodeURI(t.base + t.path);
  return t._url;
}
function loadImage(src){
  return new Promise((res,rej)=>{
    const im = new Image();
    im.onload = ()=>res(im);
    im.onerror = ()=>rej(new Error("could not load " + src));
    im.src = src;
  });
}
/* ---------------------------------------------------------------------------
   Appended by scripts/sync-geomorph-core.mjs. Everything above is verbatim.

   The page feeds this module by fetching the manifest and the taxonomy; the
   game already has both as imported JSON, so it hands them over directly.
   --------------------------------------------------------------------------- */

export function setLibrary(tiles, taxonomy) {
  LIB = tiles.map((tile) => {
    const entry = Object.assign({}, tile);
    entry.base = entry.base || "geomorphs/";
    entry.tag = entry.tag || "";
    entry.tons = entry.tons || 0;
    entry.search = (entry.label + " " + entry.path).toLowerCase();
    return entry;
  });
  TAX = taxonomy;
  let matched = 0;
  for (const tile of LIB) {
    if (TAX && TAX[tile.path]) { tile.tax = TAX[tile.path]; matched++; }
  }
  return { tiles: LIB.length, classified: matched };
}

export { buildPools, layout, parseProfile };
