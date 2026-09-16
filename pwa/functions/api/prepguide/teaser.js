// functions/api/prepguide/teaser.js
// POST /api/prepguide/teaser — FREE personalized 72-hour checklist teaser.
// Body: { adults, kids, pets, home_type, region, budget_tier }
//
// Abuse control: D1-backed per-IP daily cap (10/day), fail-open on DB errors.

import { runJson } from "../../_lib/ai.js";
import { validateIntake, householdLabel, waterMath, alignWaterItems, REGIONS, BUDGET_TIERS } from "../../_lib/validate.js";

const RL_CAP = 10; // teasers per IP per day

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(env, request) {
  // Fail open: if the DB isn't there, the funnel stays up.
  if (!env || !env.LEADS_DB || typeof env.LEADS_DB.prepare !== "function") return { ok: true };
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = await sha256Hex(ip + "|" + day);
  try {
    const row = await env.LEADS_DB.prepare(
      "SELECT count FROM prepguide_teaser_hits WHERE ip_hash = ? AND day = ?"
    ).bind(ipHash, day).first();
    const count = row ? Number(row.count) : 0;
    if (count >= RL_CAP) return { ok: false };
    await env.LEADS_DB.prepare(
      "INSERT INTO prepguide_teaser_hits (ip_hash, day, count) VALUES (?, ?, 1) " +
      "ON CONFLICT(ip_hash, day) DO UPDATE SET count = count + 1"
    ).bind(ipHash, day).run();
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

const TEASER_SYSTEM = `You are a calm, practical emergency-preparedness advisor. You write for ordinary households, not survivalists. Tone: steady, specific, reassuring — never fear-mongering, never dramatic. Output ONLY the JSON object described. No prose, no markdown fences.`;

export function teaserUser(intake) {
  const region = REGIONS[intake.region];
  const budget = BUDGET_TIERS[intake.budget_tier];
  const wm = waterMath(intake);
  const kidBit = intake.kids > 0 ? `, ${intake.kids} kid(s)` : "";
  const petBit = intake.pets > 0 ? `, ${intake.pets} pet(s)` : "";
  return `Build a personalized 72-HOUR emergency kit checklist for a household of ${intake.adults} adult(s)${kidBit}${petBit} living in a ${intake.home_type} in the ${region.label} region (main hazards: ${region.hazards}). Their preparedness budget tier is "${budget.label}" (${budget.range}) — keep item suggestions realistic for that budget.

IMPORTANT — water total is precomputed, use it verbatim, do NOT recompute: this household needs exactly ${wm.gallons_72h} gallons for 72 hours. Write exactly ${wm.gallons_72h} in "water_gallons_72h" below, and make the Water category's drinking-water item quantity exactly "${wm.gallons_72h} gallons".

Respond with ONLY this JSON object:
{
  "headline": "one encouraging sentence, specific to this household (max 120 chars)",
  "water_gallons_72h": ${wm.gallons_72h},
  "categories": [
    {"name": "category name", "items": [{"item": "item name", "qty": "quantity for THIS household, e.g. '${wm.gallons_72h} gallons' or '3 per person'"}]}
  ]
}
Rules: at most 7 categories, at most 7 items per category. Quantities MUST be scaled to this household's size. Categories should cover: Water, Food, Light & Power, Warmth & Shelter, Health & Hygiene, Documents & Cash, and (if kids/pets) Kids / Pets as needed. Practical brand-agnostic items. No fear-mongering. No medical advice beyond a basic first-aid kit.`;
}

export function validateTeaser(d) {
  if (!d || typeof d !== "object") return "not_an_object";
  if (!Array.isArray(d.categories) || d.categories.length < 3 || d.categories.length > 7) return "bad_categories";
  for (const c of d.categories) {
    if (!c.name || !Array.isArray(c.items) || c.items.length < 1 || c.items.length > 7) return "bad_category_items";
    for (const it of c.items) {
      if (!it.item || !it.qty) return "bad_item";
    }
  }
  if (typeof d.water_gallons_72h !== "number" || d.water_gallons_72h <= 0) return "bad_water";
  return true;
}

export async function onRequestPost({ request, env }) {
  try {
    const rl = await checkRateLimit(env, request);
    if (!rl.ok) return json({ ok: false, error: "rate_limited" }, 429);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }
    const v = validateIntake(body);
    if (!v.ok) return json({ ok: false, error: v.error }, 400);
    const intake = v.intake;

    const { parsed } = await runJson(env, TEASER_SYSTEM, teaserUser(intake), {
      max_tokens: 2200, temperature: 0.5, retries: 2, label: "teaser", validate: validateTeaser,
    });

    // Deterministic water math is the source of truth; the model value is advisory.
    // Belt and suspenders: the prompt already pins the exact number verbatim,
    // and alignWaterItems fixes any Water-category quantity the model invents.
    const wm = waterMath(intake);
    const checklist = alignWaterItems(parsed.categories, wm.gallons_72h);
    return json({
      ok: true,
      headline: String(parsed.headline || "").slice(0, 140),
      water_gallons_72h: wm.gallons_72h,
      checklist: checklist.map((c) => ({
        name: String(c.name).slice(0, 60),
        items: c.items.map((it) => ({
          item: String(it.item).slice(0, 120),
          qty: String(it.qty).slice(0, 60),
        })),
      })),
      household_label: householdLabel(intake),
      note: "Free preview — the full $37 playbook adds your water-storage math, 30-day food plan, power-outage playbook, and a prioritized buy list for your budget.",
    });
  } catch (e) {
    console.error("prepguide/teaser failed", e && e.message);
    return json({ ok: false, error: "teaser_failed" }, 500);
  }
}
