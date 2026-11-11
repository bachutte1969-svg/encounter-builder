/**
 * Encounter Builder — Foundry VTT v13/v14 module (Castles & Crusades)
 * Builds encounters by Hit Dice versus Average Party Level (APL).
 *
 * Benchmarks used:
 *  - Groups: total effective HD vs the party's total levels
 *      Easy 25-50%, Fair 50-100%, Hard 100-150%, Deadly 150-200% (editable in settings)
 *  - Solo boss: effective HD vs APL
 *      Easy APL-2..APL, Fair APL+1..+2, Hard APL+3..+4, Deadly APL+5..+7
 *  - Hordes: outnumbering the party multiplies the threat (action economy)
 *  - Dangerous abilities (level drain, paralysis, breath weapon, magic resistance...)
 *      count as +2 effective HD, or +3 if the monster has two or more.
 *
 * Open from the button at the top of the Actors sidebar, or with a macro:
 *   game.modules.get("encounter-builder").api.open();
 */

const MODULE_ID = "encounter-builder";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const getProp = foundry.utils.getProperty;

/* -------------------------------------------- */
/*  Data tables                                 */
/* -------------------------------------------- */

const BIOMES = {
  any: { label: "Any biome", keywords: [] },
  arctic: { label: "Arctic / Cold", keywords: ["arctic", "cold", "frozen", "tundra", "glacier", "polar", "ice", "snow"] },
  desert: { label: "Desert", keywords: ["desert", "arid", "dune", "sand", "waste"] },
  forest: { label: "Forest", keywords: ["forest", "wood", "woods", "woodland", "woodlands"] },
  grassland: { label: "Grassland / Plains", keywords: ["plain", "plains", "grassland", "steppe", "savanna", "prairie", "meadow"] },
  hills: { label: "Hills", keywords: ["hill", "hills", "highland", "highlands", "moor", "moors"] },
  mountains: { label: "Mountains", keywords: ["mountain", "mountains", "peak", "peaks", "alpine", "crag"] },
  swamp: { label: "Swamp / Marsh", keywords: ["swamp", "marsh", "bog", "fen", "wetland", "wetlands", "mire"] },
  jungle: { label: "Jungle / Tropical", keywords: ["jungle", "tropical", "rainforest"] },
  subterranean: { label: "Subterranean / Dungeon", keywords: ["subterranean", "underground", "cavern", "caverns", "cave", "caves", "underdark", "dungeon", "dungeons", "deep"] },
  aquatic: { label: "Aquatic / Coastal", keywords: ["aquatic", "sea", "seas", "ocean", "water", "lake", "lakes", "river", "rivers", "coast", "coastal", "underwater", "marine"] },
  urban: { label: "Urban / Ruins", keywords: ["urban", "city", "cities", "town", "towns", "settlement", "settled", "ruin", "ruins"] }
};

const STYLES = {
  mixed: "Mixed group",
  solo: "Solo boss",
  boss: "Boss + minions",
  horde: "Horde (low-HD swarm)"
};

// Solo boss: effective HD relative to APL, per challenge level (by position).
const SOLO_OFFSETS = [
  { lo: -2, hi: 0 },  // Easy: HD = APL is an easy-to-moderate fight
  { lo: 1, hi: 2 },   // Fair
  { lo: 3, hi: 4 },   // Hard: APL+2 to +4 is a serious threat
  { lo: 5, hi: 7 }    // Deadly
];

// Places the module looks for each value. The first one that has data wins.
const PATHS = {
  hd: ["system.hitDice.number", "system.hitDice.value", "system.hd.value", "system.hd"],
  hdText: ["system.hdSize.value", "system.hitDice.formula"],
  xp: ["system.xp.value", "system.xp", "system.experience.value", "system.experience"],
  hp: ["system.hitPoints.max", "system.hitPoints.value", "system.attributes.hp.max"],
  type: ["system.type.value", "system.type", "system.creatureType", "system.monsterType", "system.details.type.value", "system.details.type"],
  climate: ["system.climate", "system.terrain", "system.climateTerrain", "system.environment", "system.habitat"],
  encountered: ["system.numberEncountered", "system.noEncountered", "system.encountered"],
  special: ["system.special.value", "system.special", "system.specialAbilities", "system.details.special"],
  text: ["system.description.value", "system.description", "system.biography.value", "system.biography", "system.notes.value", "system.notes"],
  level: ["system.level.value", "system.level", "system.details.level.value", "system.details.level", "system.attributes.level.value"]
};

const DEFAULT_TIERS = "Easy:25-50, Fair:50-100, Hard:100-150, Deadly:150-200";
const DEFAULT_DANGEROUS = "level drain, energy drain, paralysis, paralyze, paralyzation, breath weapon, magic resistance, spell resistance, SR, petrification, petrify, turn to stone, swallow whole, disease, charm, fear, regeneration, death gaze, gaze, poison";

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });
  reg("monsterFolder", { name: "Monster folder", hint: "Actor folder that holds your monsters (subfolders included).", type: String, default: "Monsters" });
  reg("partyFolder", { name: "Party folder", hint: "Actor folder that holds the player characters (used by 'Read party').", type: String, default: "Players" });
  reg("tiers", {
    name: "Challenge levels (% of party's total levels)",
    hint: "Name:low-high pairs. Effective monster HD as a percentage of the party's combined levels. Solo bosses use APL offsets instead (Easy APL-2..APL, then +1..+2, +3..+4, +5..+7).",
    type: String, default: DEFAULT_TIERS
  });
  reg("dangerous", {
    name: "Dangerous abilities",
    hint: "Comma-separated words found in a monster's special ability Items or SPECIAL line. These punch above their HD.",
    type: String, default: DEFAULT_DANGEROUS
  });
  reg("dangerBonus1", { name: "Effective HD bonus: one dangerous ability", type: Number, default: 2 });
  reg("dangerBonus2", { name: "Effective HD bonus: two or more dangerous abilities", type: Number, default: 3 });
  reg("hordeMultiplier", {
    name: "Action economy multiplier",
    hint: "When monsters outnumber the party: up to 2 per PC x1.25, up to 3 per PC x1.5, more than 3 per PC x2.",
    type: Boolean, default: true
  });
  reg("maxCreatures", { name: "Maximum creatures per encounter", type: Number, default: 24 });
  reg("xpPath", {
    name: "XP field (optional)",
    hint: "Leave blank to find XP automatically. If XP still shows as unknown, run api.inspect(\"Monster Name\") and enter the path it lists, e.g. system.xp.value",
    type: String, default: ""
  });
  game.settings.register(MODULE_ID, "lastCriteria", { scope: "client", config: false, type: Object, default: {} });

  game.modules.get(MODULE_ID).api = {
    open: () => EncounterBuilderApp.open(),
    inspect: (actorOrName) => inspect(actorOrName),
    buildIndex: () => buildMonsterIndex(),
    setBiomes: async (actorOrName, biomes) => {
      const actor = resolveActor(actorOrName);
      if (!actor) return ui.notifications.warn(`Encounter Builder: actor "${actorOrName}" not found.`);
      await actor.setFlag(MODULE_ID, "biomes", biomes);
      ui.notifications.info(`Encounter Builder: ${actor.name} biomes set to ${biomes.join(", ")}.`);
    }
  };
});

Hooks.on("renderActorDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const header = root?.querySelector(".header-actions") ?? root?.querySelector(".directory-header");
  if (!header || header.querySelector(".eb-open")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("eb-open");
  btn.innerHTML = `<i class="fas fa-dragon"></i> Encounter Builder`;
  btn.addEventListener("click", () => EncounterBuilderApp.open());
  header.append(btn);
});

/* -------------------------------------------- */
/*  Reading monster data                        */
/* -------------------------------------------- */

function firstValue(doc, paths) {
  for (const p of paths) {
    let v = getProp(doc, p);
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) v = v.value;
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object" && !Array.isArray(v)) continue;
    return v;
  }
  return undefined;
}

function stripHTML(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
}

function actorText(actor) {
  const parts = [];
  for (const p of PATHS.text) {
    let v = getProp(actor, p);
    if (v && typeof v === "object" && "value" in v) v = v.value;
    if (typeof v === "string") parts.push(stripHTML(v));
  }
  return parts.join("\n");
}

/** Reads "LABEL: value" from stat-block text; stops at the next "LABEL:". */
function statLine(text, labelRegex) {
  const re = new RegExp(`(?:^|\\n|\\s)(?:${labelRegex})\\s*[:.]\\s*([^\\n]+)`, "i");
  const m = text.match(re);
  if (!m) return undefined;
  return m[1].split(/\s(?=[A-Z][A-Za-z.\/ ]{1,25}\s*:)/)[0].replace(/[,;]\s*$/, "").trim();
}

function parseNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const frac = v.match(/(\d+)\s*\/\s*(\d+)/);
  if (frac && frac.index === v.search(/\d/)) return Number(frac[1]) / Number(frac[2]);
  const m = v.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function readHD(actor, text) {
  let hd = parseNumber(firstValue(actor, PATHS.hd));
  if (!Number.isFinite(hd)) hd = parseNumber(firstValue(actor, PATHS.hdText));
  if (!Number.isFinite(hd)) hd = parseNumber(statLine(text, "HD|Hit Dice") ?? "");
  return Number.isFinite(hd) ? hd : null;
}

/** True when a value carries a real XP figure (not empty, not a default 0). */
function hasXP(v) {
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") return /[1-9]/.test(v);
  return false;
}

/** Every field under actor.system whose name looks like XP, e.g. system.xp, system.monsterXP.value. */
function findXPFields(actor) {
  const out = [];
  const walk = (obj, path, depth) => {
    if (!obj || typeof obj !== "object" || depth > 4) return;
    for (const [k, v] of Object.entries(obj)) {
      const p = `${path}.${k}`;
      const xpish = /xp|experience/i.test(p.replace(/^system/, ""));
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p, depth + 1);
      else if (xpish && !/next|level|bonus|percent|mod/i.test(k)) out.push({ path: p, value: v });
    }
  };
  walk(actor.system, "system", 0);
  return out;
}

/** Turns "15+1", "XP 15 + 1/hp", 250 or "1,200" into a number, using average HP for the per-HP part. */
function xpFromRaw(raw, actor, hd) {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const m = stripHTML(raw).replace(/,/g, "").match(/(\d+)\s*(?:\+\s*(\d+))?/);
  if (!m) return null;
  const perHP = m[2] ? Number(m[2]) : 0;
  const hp = Number(firstValue(actor, PATHS.hp)) || Math.max(1, Math.round((hd ?? 1) * 4.5));
  return Number(m[1]) + perHP * hp;
}

/**
 * C&C "XP: 15+1" = 15 plus 1 per hit point. Looks in, in order:
 * the "XP field" setting, the usual paths, any XP-named field, then the stat-block text.
 */
function readXP(actor, text, hd) {
  const override = game.settings.get(MODULE_ID, "xpPath")?.trim();
  if (override) {
    let v = getProp(actor, override);
    if (v && typeof v === "object" && "value" in v) v = v.value;
    if (hasXP(v)) return xpFromRaw(v, actor, hd);
  }
  for (const p of PATHS.xp) {
    let v = getProp(actor, p);
    if (v && typeof v === "object" && "value" in v) v = v.value;
    if (hasXP(v)) return xpFromRaw(v, actor, hd);
  }
  const found = findXPFields(actor).find((f) => hasXP(f.value));
  if (found) return xpFromRaw(found.value, actor, hd);
  const line = statLine(text, "XP|Experience Points|Experience");
  if (hasXP(line)) return xpFromRaw(line, actor, hd);
  return null;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function readType(actor, text) {
  let raw = firstValue(actor, PATHS.type);
  // "TYPE:" but not "TREASURE TYPE:"
  if (typeof raw !== "string" || !raw.trim()) raw = text.match(/(?:^|\n|\s)(?<!Treasure\s)Type\s*[:.]\s*([^\n]+)/i)?.[1];
  if (typeof raw !== "string" || !raw.trim()) return null;
  const main = raw.split(/[(,;]/)[0].split(/\s(?=[A-Z][A-Za-z.\/ ]{1,25}\s*:)/)[0].replace(/[.\s]+$/, "").trim();
  return main ? titleCase(main) : null;
}

function biomesFromString(str) {
  const s = ` ${str.toLowerCase()} `;
  if (/\bany\b/.test(s)) return ["any"];
  const found = [];
  for (const [id, b] of Object.entries(BIOMES)) {
    if (id !== "any" && b.keywords.some((k) => new RegExp(`\\b${k}\\b`).test(s))) found.push(id);
  }
  return found;
}

function readBiomes(actor, text) {
  const flagged = actor.getFlag?.(MODULE_ID, "biomes");
  if (Array.isArray(flagged) && flagged.length) return flagged;
  const field = firstValue(actor, PATHS.climate);
  if (typeof field === "string" && field.trim()) return biomesFromString(field);
  const line = statLine(text, "Climate\\s*\\/\\s*Terrain|Climate|Terrain|Habitat|Environment");
  return line ? biomesFromString(line) : [];
}

function readMaxEncountered(actor, text) {
  let raw = firstValue(actor, PATHS.encountered);
  if (raw === undefined) raw = statLine(text, "No\\.?\\s*Encountered|Number Encountered");
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  let max = 0;
  for (const m of raw.matchAll(/(\d+)\s*d\s*(\d+)/gi)) max = Math.max(max, Number(m[1]) * Number(m[2]));
  for (const m of raw.replace(/\d+\s*d\s*\d+/gi, " ").matchAll(/\d+/g)) max = Math.max(max, Number(m[0]));
  return max || null;
}

function dangerousKeywords() {
  return (game.settings.get(MODULE_ID, "dangerous") || DEFAULT_DANGEROUS)
    .split(",").map((s) => s.trim()).filter(Boolean);
}

/** Dangerous abilities from special-ability Item names and the SPECIAL line. */
function readDangerous(actor, text) {
  const sources = actor.items.map((i) => i.name);
  const field = firstValue(actor, PATHS.special);
  if (typeof field === "string") sources.push(stripHTML(field));
  const line = statLine(text, "Special|Special Abilities");
  if (line) sources.push(line);
  const hay = ` ${sources.join(" | ")} `;
  const found = new Set();
  for (const kw of dangerousKeywords()) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Short all-caps abbreviations (SR) match case-sensitively.
    const flags = kw.length <= 3 && kw === kw.toUpperCase() ? "" : "i";
    if (new RegExp(`\\b${esc}`, flags).test(hay)) found.add(titleCase(kw));
  }
  // "paralysis" and "paralyze" are the same ability.
  return dedupeAbilities([...found]);
}

function dedupeAbilities(list) {
  // "Gaze" inside "Death Gaze" is one ability, not two.
  list = list.filter((a) => !list.some((b) => b !== a && b.toLowerCase().includes(a.toLowerCase())));
  const roots = new Map();
  for (const a of list) {
    const root = a.toLowerCase().replace(/(ysis|yze|yzation|ification|ify)$/, "").slice(0, 6);
    if (!roots.has(root)) roots.set(root, a);
  }
  return [...roots.values()];
}

function resolveActor(actorOrName) {
  if (!actorOrName) return null;
  if (actorOrName instanceof Actor) return actorOrName;
  return game.actors.get(actorOrName) ?? game.actors.getName(actorOrName) ?? null;
}

function findFolder(name, type = "Actor") {
  const all = game.folders.filter((f) => f.type === type && f.name === name);
  return all.find((f) => !f.folder) ?? all[0] ?? null;
}

function inFolderTree(doc, root) {
  if (!root || !doc.folder) return false;
  return doc.folder === root || doc.folder.ancestors?.includes(root);
}

function describeMonster(actor) {
  const text = actorText(actor);
  const hd = readHD(actor, text);
  const dangerous = readDangerous(actor, text);
  const bonus = dangerous.length >= 2
    ? Number(game.settings.get(MODULE_ID, "dangerBonus2")) || 0
    : dangerous.length === 1 ? Number(game.settings.get(MODULE_ID, "dangerBonus1")) || 0 : 0;
  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    hd,
    dangerous,
    bonus,
    effHD: hd === null ? null : hd + bonus,
    xp: readXP(actor, text, hd),
    type: readType(actor, text),
    biomes: readBiomes(actor, text),
    maxEncountered: readMaxEncountered(actor, text)
  };
}

function buildMonsterIndex() {
  const folderName = game.settings.get(MODULE_ID, "monsterFolder");
  const root = findFolder(folderName);
  if (!root) console.warn(`${MODULE_ID} | Folder "${folderName}" not found; using all non-character actors.`);
  const actors = root ? game.actors.filter((a) => inFolderTree(a, root)) : game.actors.filter((a) => a.type !== "character");
  return actors.map(describeMonster).filter((m) => m.hd !== null && m.hd > 0);
}

function inspect(actorOrName) {
  const actor = resolveActor(actorOrName);
  if (!actor) return ui.notifications.warn(`Encounter Builder: actor "${actorOrName}" not found.`);
  const i = describeMonster(actor);
  console.log(`${MODULE_ID} | ${actor.name}`, i, actor.system);
  console.log(`${MODULE_ID} | XP-like fields on ${actor.name}:`, findXPFields(actor));
  ui.notifications.info(
    `${i.name}: HD ${i.hd ?? "?"}, effective HD ${i.effHD ?? "?"}, XP ${i.xp ?? "?"}, type ${i.type ?? "?"}, ` +
    `biomes ${i.biomes.join("/") || "none"}, dangerous ${i.dangerous.join(", ") || "none"}, max #${i.maxEncountered ?? "?"}. Details in console (F12).`
  );
  return i;
}

/* -------------------------------------------- */
/*  Encounter math                              */
/* -------------------------------------------- */

function parseTiers() {
  const parse = (raw) => raw.split(",").map((s) => {
    const [label, range] = s.split(":").map((x) => x?.trim());
    const [lo, hi] = (range ?? "").split("-").map((n) => Number(n));
    return { label, lo: lo / 100, hi: hi / 100 };
  }).filter((t) => t.label && Number.isFinite(t.lo) && Number.isFinite(t.hi) && t.hi > t.lo);
  const tiers = parse(game.settings.get(MODULE_ID, "tiers") || DEFAULT_TIERS);
  return (tiers.length ? tiers : parse(DEFAULT_TIERS)).map((t, i) => ({ ...t, solo: SOLO_OFFSETS[Math.min(i, SOLO_OFFSETS.length - 1)] }));
}

/** Action economy: monsters outnumbering the party hit above their HD. */
function hordeMultiplier(count, partySize) {
  if (!game.settings.get(MODULE_ID, "hordeMultiplier")) return 1;
  const ratio = count / Math.max(1, partySize);
  if (ratio <= 1) return 1;
  if (ratio <= 2) return 1.25;
  if (ratio <= 3) return 1.5;
  return 2;
}

function evaluate(groups, partySize) {
  const total = groups.reduce((n, g) => n + g.count, 0);
  const rawHD = groups.reduce((s, g) => s + g.monster.hd * g.count, 0);
  const effSum = groups.reduce((s, g) => s + g.monster.effHD * g.count, 0);
  const mult = hordeMultiplier(total, partySize);
  const xpKnown = groups.every((g) => g.monster.xp !== null);
  const xp = groups.reduce((s, g) => s + (g.monster.xp ?? 0) * g.count, 0);
  return { total, rawHD, effSum, mult, effective: effSum * mult, xp, xpKnown };
}

function filterPool(index, c) {
  return index.filter((m) => {
    if (c.biome !== "any") {
      const ok = m.biomes.includes(c.biome) || m.biomes.includes("any");
      if (!ok && !(c.includeUnknownBiome && m.biomes.length === 0)) return false;
    }
    if (c.type !== "any" && m.type !== c.type) return false;
    if (Number.isFinite(c.hdMin) && m.hd < c.hdMin) return false;
    if (Number.isFinite(c.hdMax) && c.hdMax > 0 && m.hd > c.hdMax) return false;
    return true;
  });
}

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const weightedPick = (arr, weightFn) => {
  const w = arr.map(weightFn);
  let roll = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < arr.length; i++) if ((roll -= w[i]) <= 0) return arr[i];
  return arr.at(-1);
};

/**
 * Grows `groups` toward [lo, hi] effective HD by adding creatures from `extras`
 * (new kinds) or more of the kinds already present (`growable`).
 */
function fill(groups, { lo, hi, extras, maxKinds, partySize, cap, maxCreatures, growable }) {
  for (let guard = 0; guard < 200; guard++) {
    const v = evaluate(groups, partySize);
    if (v.effective >= lo || v.total >= maxCreatures) break;
    const options = [];
    for (const g of groups) if (growable(g) && g.count < cap(g.monster)) options.push(() => g.count++);
    if (groups.length < maxKinds) {
      const used = new Set(groups.map((g) => g.monster.id));
      const fresh = extras.filter((m) => !used.has(m.id));
      if (fresh.length) options.push(() => groups.push({ monster: rand(fresh), count: 1 }));
    }
    if (!options.length) break;
    const snapshot = groups.map((g) => ({ ...g }));
    rand(options)();
    if (evaluate(groups, partySize).effective > hi) {
      groups.splice(0, groups.length, ...snapshot);
      break;
    }
  }
  return groups;
}

function buildEncounter(pool, tier, c) {
  const partySize = c.partySize;
  const apl = c.avgLevel;
  const totalLevels = partySize * apl;
  const maxCreatures = Number(game.settings.get(MODULE_ID, "maxCreatures")) || 24;
  const cap = (m) => (c.respectEncountered && m.maxEncountered ? m.maxEncountered : maxCreatures);

  // Solo boss: a single monster judged against APL, not total levels.
  if (c.style === "solo") {
    const lo = apl + tier.solo.lo, hi = apl + tier.solo.hi;
    const inRange = pool.filter((m) => m.effHD >= lo && m.effHD <= hi);
    const pick = inRange.length ? rand(inRange)
      : [...pool].sort((a, b) => Math.abs(a.effHD - (lo + hi) / 2) - Math.abs(b.effHD - (lo + hi) / 2))[0];
    if (!pick) return null;
    const groups = [{ monster: pick, count: 1, role: "Boss" }];
    return { groups, ...evaluate(groups, partySize), target: `effective HD ${lo}–${hi} (APL ${signed(tier.solo.lo)} to ${signed(tier.solo.hi)})`, inRange: inRange.length > 0 };
  }

  const lo = totalLevels * tier.lo, hi = totalLevels * tier.hi, mid = (lo + hi) / 2;
  const minionMax = Math.max(1, Math.floor(apl / 2));
  const good = [];
  let best = null;

  for (let attempt = 0; attempt < 400 && good.length < 25; attempt++) {
    let groups;
    if (c.style === "boss") {
      // Leader at or above APL; minions at no more than half APL.
      // Boss uses the solo-boss range for this tier (minus 1, since minions add to the threat).
      const bLo = apl + tier.solo.lo - 1, bHi = apl + tier.solo.hi;
      let leaders = pool.filter((m) => m.effHD >= Math.max(bLo, minionMax + 0.5) && m.effHD <= bHi && m.effHD <= hi);
      if (!leaders.length) leaders = pool.filter((m) => m.effHD > minionMax && m.effHD <= hi);
      const minions = pool.filter((m) => m.hd <= minionMax);
      if (!leaders.length || !minions.length) return null;
      const leader = rand(leaders);
      groups = [{ monster: leader, count: 1, role: "Boss" }];
      const minion = rand(minions.filter((m) => m.id !== leader.id).length ? minions.filter((m) => m.id !== leader.id) : minions);
      groups.push({ monster: minion, count: 1, role: "Minion" });
      fill(groups, { lo: mid, hi, extras: minions.filter((m) => m.id !== leader.id), maxKinds: 1 + c.maxKinds, partySize, cap, maxCreatures, growable: (g) => g.role !== "Boss" });
      for (const g of groups) g.role ??= "Minion";
    } else if (c.style === "horde") {
      const swarm = pool.filter((m) => m.hd <= minionMax);
      if (!swarm.length) return null;
      groups = [{ monster: rand(swarm), count: 1 }];
      fill(groups, { lo: mid, hi, extras: swarm, maxKinds: c.maxKinds, partySize, cap, maxCreatures, growable: () => true });
    } else {
      const fits = pool.filter((m) => m.effHD <= hi);
      if (!fits.length) return null;
      // Stronger leads are more likely, so harder tiers get bigger monsters, not just more of them.
      groups = [{ monster: weightedPick(fits, (m) => Math.sqrt(m.effHD)), count: 1 }];
      fill(groups, { lo: mid * (0.85 + Math.random() * 0.3), hi, extras: fits, maxKinds: c.maxKinds, partySize, cap, maxCreatures, growable: () => true });
    }

    const v = evaluate(groups, partySize);
    const result = { groups, ...v, target: `${round(lo)}–${round(hi)} effective HD (${Math.round(tier.lo * 100)}–${Math.round(tier.hi * 100)}% of ${totalLevels} levels)` };
    const inRange = v.effective >= lo && v.effective <= hi;
    result.inRange = inRange;
    result.score = Math.abs(v.effective - mid) / mid;
    if (!best || result.score < best.score) best = result;
    if (inRange) good.push(result);
  }
  return good.length ? rand(good) : best;
}

const round = (n) => Math.round(n * 10) / 10;
const signed = (n) => (n > 0 ? `+${n}` : n === 0 ? "+0" : `${n}`);

/** Plain-language warnings for the GM. */
function encounterNotes(enc, c) {
  const notes = [];
  const ratio = enc.total / c.partySize;
  if (ratio > 1) notes.push(`Outnumbers the party ${round(ratio)}:1 — expect a lot of attacks per round, rough on low-AC characters.`);
  const danger = [...new Set(enc.groups.flatMap((g) => g.monster.dangerous))];
  if (danger.length) notes.push(`Dangerous abilities: ${danger.join(", ")}.`);
  if (c.style !== "solo" && enc.groups.length === 1 && enc.total === 1) {
    const diff = enc.groups[0].monster.effHD - c.avgLevel;
    notes.push(`Single monster at APL ${signed(round(diff))}.`);
  }
  if (!enc.inRange) notes.push("Closest match available — nothing landed inside the target range with these filters.");
  return notes;
}

/* -------------------------------------------- */
/*  Application                                 */
/* -------------------------------------------- */

class EncounterBuilderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  static open() {
    if (!game.user.isGM) return ui.notifications.warn("Encounter Builder is for the GM.");
    // Fit the window on smaller screens so the resize handle stays reachable.
    this.#instance ??= new EncounterBuilderApp({
      position: {
        width: Math.min(800, window.innerWidth - 60),
        height: Math.min(760, window.innerHeight - 80),
        top: 40
      }
    });
    this.#instance.render({ force: true });
    return this.#instance;
  }

  static DEFAULT_OPTIONS = {
    id: "encounter-builder",
    tag: "form",
    classes: ["encounter-builder"],
    window: { title: "Encounter Builder", icon: "fas fa-dragon", resizable: true },
    position: { width: 800, height: 760 },
    form: { handler: EncounterBuilderApp.#onFormChange, submitOnChange: true, closeOnSubmit: false },
    actions: {
      generate: EncounterBuilderApp.#onGenerate,
      reset: EncounterBuilderApp.#onReset,
      reroll: EncounterBuilderApp.#onReroll,
      readParty: EncounterBuilderApp.#onReadParty,
      rescan: EncounterBuilderApp.#onRescan,
      place: EncounterBuilderApp.#onPlace,
      journal: EncounterBuilderApp.#onJournal,
      chat: EncounterBuilderApp.#onChat,
      openActor: EncounterBuilderApp.#onOpenActor
    }
  };

  static DEFAULT_CRITERIA = Object.freeze({
    partySize: 4, avgLevel: 3, biome: "any", type: "any", hdMin: null, hdMax: null,
    style: "mixed", maxKinds: 2, respectEncountered: true, includeUnknownBiome: true, placeHidden: true
  });

  static async #onReset() {
    this.criteria = { ...EncounterBuilderApp.DEFAULT_CRITERIA };
    this.results = [];
    await game.settings.set(MODULE_ID, "lastCriteria", {});
    this.render();
  }

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/encounter-builder.hbs` }
  };

  constructor(options) {
    super(options);
    this.index = buildMonsterIndex();
    this.results = [];
    this.criteria = foundry.utils.mergeObject(EncounterBuilderApp.DEFAULT_CRITERIA,
      game.settings.get(MODULE_ID, "lastCriteria") ?? {}, { inplace: false });
    if (!(this.criteria.style in STYLES)) this.criteria.style = "mixed";
  }

  get pool() {
    return filterPool(this.index, this.criteria);
  }

  _summaryText() {
    const c = this.criteria;
    return `APL ${c.avgLevel} · ${c.partySize * c.avgLevel} total levels`;
  }

  async _prepareContext() {
    const types = [...new Set(this.index.map((m) => m.type).filter(Boolean))].sort();
    return {
      c: this.criteria,
      typeOptions: { any: "Any type", ...Object.fromEntries(types.map((t) => [t, t])) },
      biomeOptions: Object.fromEntries(Object.entries(BIOMES).map(([k, v]) => [k, v.label])),
      styleOptions: STYLES,
      monsterCount: this.index.length,
      noBiomeCount: this.index.filter((m) => !m.biomes.length).length,
      matchCount: this.pool.length,
      summary: this._summaryText(),
      results: this.results.map((r, i) => ({ ...r, index: i }))
    };
  }

  static async #onFormChange(event, form, formData) {
    const d = formData.object;
    const num = (v, fallback = null) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v));
    Object.assign(this.criteria, {
      partySize: Math.max(1, num(d.partySize, 1)),
      avgLevel: Math.max(1, num(d.avgLevel, 1)),
      biome: d.biome ?? "any",
      type: d.type ?? "any",
      hdMin: num(d.hdMin),
      hdMax: num(d.hdMax),
      style: d.style ?? "mixed",
      maxKinds: Math.max(1, num(d.maxKinds, 1)),
      respectEncountered: !!d.respectEncountered,
      includeUnknownBiome: !!d.includeUnknownBiome,
      placeHidden: !!d.placeHidden
    });
    game.settings.set(MODULE_ID, "lastCriteria", this.criteria);
    const el = this.element;
    el.querySelector(".eb-match-count").textContent = this.pool.length;
    el.querySelector(".eb-apl").textContent = this._summaryText();
  }

  _buildTier(tier) {
    const enc = buildEncounter(this.pool, tier, this.criteria);
    if (!enc) return { tier, label: tier.label, empty: true, groups: [] };
    return {
      tier,
      label: tier.label,
      empty: false,
      target: enc.target,
      total: enc.total,
      rawHD: round(enc.rawHD),
      effSum: round(enc.effSum),
      effective: round(enc.effective),
      mult: enc.mult,
      xp: enc.xp.toLocaleString(),
      xpKnown: enc.xpKnown,
      xpLabel: enc.xpKnown ? `${enc.xp.toLocaleString()} XP`
        : enc.xp > 0 ? `at least ${enc.xp.toLocaleString()} XP (some monsters have no XP)` : "XP unknown",
      inRange: enc.inRange,
      notes: encounterNotes(enc, this.criteria),
      groups: enc.groups.map((g) => ({
        ...g.monster,
        count: g.count,
        role: g.role,
        xpEach: g.monster.xp,
        xpTotal: g.monster.xp === null ? null : (g.monster.xp * g.count).toLocaleString(),
        dangerText: g.monster.dangerous.join(", "),
        biomeLabel: g.monster.biomes.map((b) => BIOMES[b]?.label ?? b).join(", ") || "—"
      }))
    };
  }

  static #onGenerate() {
    if (!this.pool.length) return ui.notifications.warn("No monsters match those filters.");
    this.results = parseTiers().map((t) => this._buildTier(t));
    this.render();
  }

  static #onReroll(event, target) {
    const i = Number(target.dataset.index);
    if (!this.results[i]) return;
    this.results[i] = this._buildTier(this.results[i].tier);
    this.render();
  }

  static #onRescan() {
    this.index = buildMonsterIndex();
    ui.notifications.info(`Encounter Builder: ${this.index.length} monsters indexed.`);
    this.render();
  }

  static #onReadParty() {
    const folderName = game.settings.get(MODULE_ID, "partyFolder");
    const root = findFolder(folderName);
    const pcs = root ? game.actors.filter((a) => inFolderTree(a, root)) : game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    if (!pcs.length) return ui.notifications.warn(`No characters found in "${folderName}".`);
    const levels = pcs.map((a) => parseNumber(firstValue(a, PATHS.level))).filter(Number.isFinite);
    this.criteria.partySize = pcs.length;
    if (levels.length) this.criteria.avgLevel = Math.max(1, Math.round(levels.reduce((a, b) => a + b, 0) / levels.length));
    else ui.notifications.warn("Couldn't read character levels; set the APL by hand.");
    game.settings.set(MODULE_ID, "lastCriteria", this.criteria);
    this.render();
  }

  static #onOpenActor(event, target) {
    game.actors.get(target.dataset.actorId)?.sheet.render(true);
  }

  static async #onPlace(event, target) {
    const r = this.results[Number(target.dataset.index)];
    if (!r || r.empty) return;
    const scene = canvas.scene;
    if (!scene) return ui.notifications.warn("Open a scene first.");
    const grid = canvas.grid.size;
    const total = r.groups.reduce((n, g) => n + g.count, 0);
    const perRow = Math.ceil(Math.sqrt(total));
    const startX = canvas.stage.pivot.x - (perRow * grid) / 2;
    const startY = canvas.stage.pivot.y - (Math.ceil(total / perRow) * grid) / 2;
    const data = [];
    let n = 0;
    for (const g of r.groups) {
      const actor = game.actors.get(g.id);
      if (!actor) continue;
      for (let i = 0; i < g.count; i++, n++) {
        let pt = { x: startX + (n % perRow) * grid, y: startY + Math.floor(n / perRow) * grid };
        if (canvas.grid.getSnappedPoint) pt = canvas.grid.getSnappedPoint(pt, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX });
        const td = await actor.getTokenDocument({ x: pt.x, y: pt.y, hidden: this.criteria.placeHidden });
        data.push(td.toObject());
      }
    }
    await scene.createEmbeddedDocuments("Token", data);
    ui.notifications.info(`Placed ${data.length} tokens (${r.label}).`);
  }

  _encounterHTML(r) {
    const c = this.criteria;
    const rows = r.groups.map((g) =>
      `<tr><td>${g.count} &times; @UUID[${g.uuid}]{${g.name}}${g.role ? ` <em>(${g.role})</em>` : ""}</td>` +
      `<td>${g.hd}${g.bonus ? ` (eff ${g.effHD})` : ""}</td><td>${g.xpTotal ?? "—"}</td><td>${g.dangerText || "—"}</td></tr>`
    ).join("");
    const notes = r.notes.length ? `<ul>${r.notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : "";
    return `<h2>${r.label} — ${STYLES[c.style]}</h2>
<p><strong>Party:</strong> ${c.partySize} characters, APL ${c.avgLevel} (${c.partySize * c.avgLevel} total levels)<br>
<strong>Biome:</strong> ${BIOMES[c.biome]?.label ?? c.biome} &nbsp; <strong>Type:</strong> ${c.type === "any" ? "Any" : c.type}<br>
<strong>Target:</strong> ${r.target}<br>
<strong>Built:</strong> ${r.total} creatures, ${r.rawHD} HD (${r.effSum} effective${r.mult > 1 ? `, &times;${r.mult} action economy = ${r.effective}` : ""})<br>
<strong>Total XP:</strong> ${r.xpLabel}</p>
<table><thead><tr><th>Monster</th><th>HD</th><th>XP</th><th>Dangerous</th></tr></thead><tbody>${rows}</tbody></table>${notes}`;
  }

  static async #onJournal(event, target) {
    const r = this.results[Number(target.dataset.index)];
    if (!r || r.empty) return;
    const folder = findFolder("Encounters", "JournalEntry") ?? await Folder.create({ name: "Encounters", type: "JournalEntry" });
    const name = `${r.label} ${STYLES[this.criteria.style]} — ${BIOMES[this.criteria.biome]?.label ?? "Any"} (${new Date().toLocaleDateString()})`;
    const entry = await JournalEntry.create({
      name, folder: folder.id,
      pages: [{ name: r.label, type: "text", text: { content: this._encounterHTML(r) } }]
    });
    ui.notifications.info(`Saved journal "${name}".`);
    entry?.sheet.render(true);
  }

  static async #onChat(event, target) {
    const r = this.results[Number(target.dataset.index)];
    if (!r || r.empty) return;
    await ChatMessage.create({ content: this._encounterHTML(r), whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id) });
  }
}
