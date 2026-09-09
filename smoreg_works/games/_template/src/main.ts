import { Game } from "@jamrog/engine";
import { CONTENT } from "./content/pack.js";
import { App } from "./ui/app.js";

const mount = document.getElementById("game");
if (!mount) throw new Error("#game mount point missing from index.html");

// ?seed=123 reproduces a run exactly — the cheapest bug-report channel there is.
const fromUrl = new URLSearchParams(window.location.search).get("seed");
const seed = fromUrl !== null && /^\d+$/.test(fromUrl) ? Number(fromUrl) >>> 0 : (Math.random() * 0xffffffff) >>> 0;

new App(mount, () => new Game({ seed, content: CONTENT }));
