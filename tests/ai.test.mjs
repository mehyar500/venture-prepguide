// ai.test.mjs — runJson handles Workers AI's pre-parsed object AND string responses.
import { runJson, parseJson } from "../pwa/functions/_lib/ai.js";

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name); }
}

const payload = { headline: "You're ready", water_gallons_72h: 9, categories: [] };

// Case 1: pre-parsed object (llama-3.3-70b-instruct-fp8-fast json_object real shape)
const envObj = { AI: { run: async () => ({ response: payload }) } };
// Case 2: plain string (other models / older shape)
const envStr = { AI: { run: async () => ({ response: JSON.stringify(payload) }) } };
// Case 3: bare string return
const envBare = { AI: { run: async () => JSON.stringify(payload) } };

const validate = (d) => (d && typeof d.headline === "string" && typeof d.water_gallons_72h === "number") || "bad_shape";

const r1 = await runJson(envObj, "sys", "user", { validate, retries: 0, label: "t1" });
t("pre-parsed object parses", r1.parsed.headline === "You're ready" && r1.parsed.water_gallons_72h === 9);

const r2 = await runJson(envStr, "sys", "user", { validate, retries: 0, label: "t2" });
t("string response parses", r2.parsed.headline === "You're ready");

const r3 = await runJson(envBare, "sys", "user", { validate, retries: 0, label: "t3" });
t("bare string parses", r3.parsed.headline === "You're ready");

// parseJson edge cases
t("parseJson fence", parseJson('```json\n{"a":1}\n```').a === 1);
t("parseJson garbage null", parseJson("not json at all") === null);
t("parseJson empty null", parseJson("") === null);
t("parseJson single-quoted", parseJson("{'a': 1}").a === 1);

// retry + throw on persistent failure
let calls = 0;
const envBad = { AI: { run: async () => { calls++; return { response: "garbage{{{" }; } } };
let threw = false;
try {
  await runJson(envBad, "sys", "user", { validate, retries: 1, label: "t4" });
} catch { threw = true; }
t("throws after retries", threw === true);
t("retried (2 attempts)", calls === 2);

// missing AI binding throws immediately
let threw2 = false;
try { await runJson({}, "sys", "user", { retries: 0 }); } catch { threw2 = true; }
t("missing AI binding throws", threw2 === true);

// Regression: the live model returns a 1-item Water category (natural answer).
// validateTeaser must accept it — this exact shape 500'd every live teaser call.
import { validateTeaser } from "../pwa/functions/api/prepguide/teaser.js";
const liveShape = {
  headline: "You're preparing for 3!",
  water_gallons_72h: 7.5,
  categories: [
    { name: "Water", items: [{ item: "Drinking water", qty: "7.5 gallons" }] },
    { name: "Food", items: [{ item: "Rice", qty: "10 lbs" }, { item: "Beans", qty: "5 lbs" }, { item: "Peanut butter", qty: "2 jars" }] },
    { name: "Light & Power", items: [{ item: "Flashlight", qty: "2" }, { item: "Batteries", qty: "1 pack" }, { item: "Lantern", qty: "1" }] },
  ],
};
t("live 1-item Water category passes validation", validateTeaser(liveShape) === true);
t("7 categories accepted (prompt lists 7 to cover)", validateTeaser({
  headline: "x", water_gallons_72h: 9,
  categories: ["Water","Food","Light & Power","Warmth & Shelter","Health & Hygiene","Documents & Cash","Kids / Pets"].map(n => ({ name: n, items: [{ item: "a", qty: "1" }, { item: "b", qty: "2" }] })),
}) === true);
t("8 categories still rejected", validateTeaser({
  headline: "x", water_gallons_72h: 9,
  categories: Array.from({length: 8}, (_, i) => ({ name: "C"+i, items: [{ item: "a", qty: "1" }] })),
}) === "bad_categories");
t("empty category still rejected", validateTeaser({ headline: "x", water_gallons_72h: 1, categories: [
  { name: "Water", items: [] },
  { name: "Food", items: [{ item: "Rice", qty: "1 lb" }, { item: "Beans", qty: "1 lb" }] },
  { name: "Light", items: [{ item: "Flashlight", qty: "1" }, { item: "Batteries", qty: "1" }] },
] }) === "bad_category_items");

// Regression: live teaser returned Water item "7.5 gallons" while deterministic
// water math for the same household is 13.5 gallons. alignWaterItems must make
// the bulk-water qty agree with the deterministic number, and teaserUser must
// pin the exact number in the prompt so the model can't recompute it.
import { alignWaterItems, waterMath } from "../pwa/functions/_lib/validate.js";
import { teaserUser } from "../pwa/functions/api/prepguide/teaser.js";

const drifted = [
  { name: "Water", items: [
    { item: "Drinking water", qty: "7.5 gallons" },
    { item: "Water filter", qty: "1 portable filter" },
  ]},
  { name: "Food", items: [{ item: "Rice", qty: "10 lbs" }] },
];
const aligned = alignWaterItems(drifted, 13.5);
t("bulk water qty overridden to deterministic", aligned[0].items[0].qty === "13.5 gallons");
t("treatment item untouched", aligned[0].items[1].qty === "1 portable filter");
t("non-water category untouched", aligned[1].items[0].qty === "10 lbs");
t("input not mutated", drifted[0].items[0].qty === "7.5 gallons");
t("no Water category passes through", alignWaterItems([{ name: "Food", items: [{ item: "Rice", qty: "1 lb" }] }], 13.5)[0].items[0].qty === "1 lb");

const prompt = teaserUser({ adults: 2, kids: 1, pets: 0, home_type: "house", region: "southeast", budget_tier: "practical", persons: 3 });
t("prompt pins exact 13.5 verbatim", prompt.includes("exactly 13.5 gallons") && prompt.includes('"water_gallons_72h": 13.5'));

console.log(`ai: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
