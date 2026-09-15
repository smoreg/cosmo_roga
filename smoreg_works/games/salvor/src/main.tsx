import { mountReact } from "./ui/react/mount.js";
import { seedFromUrl } from "./ui/title.js";

const host = document.getElementById("game");
if (host === null) throw new Error("#game mount point missing from index.html");

/* ?seed=123 reproduces a voyage exactly — the cheapest bug-report channel there
   is, and the reason a run is (seed, inputs) and nothing else. */
const seed = seedFromUrl(window.location.search) ?? ((Math.random() * 0xffffffff) >>> 0);
mountReact(host, seed);
