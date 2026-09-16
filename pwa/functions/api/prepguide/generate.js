// functions/api/prepguide/generate.js
// POST /api/prepguide/generate — build the FULL paid playbook PDF.
// Body: { order_token: "<prepguide_orders.access_token>" }
//
// Auth: the order's access_token is the capability. Idempotent: a 'ready'
// order returns the stored PDF meta without re-spending AI. Concurrent
// double-POSTs are serialized via a status='generating' guard so the AI
// budget is spent once.

import { runJson } from "../../_lib/ai.js";
import { renderPdf } from "../../_lib/renderPdf.js";
import { validateIntake, householdLabel, waterMath, alignWaterItems, REGIONS, BUDGET_TIERS } from "../../_lib/validate.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const FULL_SYSTEM = `You are a calm, practical emergency-preparedness advisor writing a personalized household playbook. Audience: ordinary families, not survivalists. Tone: steady, specific, reassuring — NEVER fear-mongering, never dramatic, never apocalyptic. All costs in USD. Quantities must be scaled to the household size given. Output ONLY the JSON object described. No prose, no markdown fences. No medical advice beyond a basic first-aid kit. No guarantees of safety — practical readiness only.`;

// NOTE (2026-09-16): @cf/meta/llama-3.3-70b-instruct-fp8-fast caps output at
// 4096 tokens on Workers AI. The original single-call playbook (max_tokens
// 6000) blew past that and failed validation on every retry. Generation is
// therefore split into TWO calls (kitchen/water/food, then power/buy/region),
// each comfortably under the cap, merged before PDF render.

function part1User(intake) {
  const region = REGIONS[intake.region];
  const wm = waterMath(intake);
  const kidBit = intake.kids > 0 ? `${intake.kids} kid(s)` : "no kids";
  const petBit = intake.pets > 0 ? `${intake.pets} pet(s)` : "no pets";
  return `Write PART 1 of a personalized survival-preparedness playbook for: ${intake.adults} adult(s), ${kidBit}, ${petBit}, living in a ${intake.home_type} in the ${region.label} region (main hazards: ${region.hazards}).

Water math (use these exact numbers): ${wm.gallons_per_day} gallons/day total, ${wm.gallons_72h} gallons for 72 hours.

Respond with ONLY this JSON object:
{
  "checklist": {"categories": [{"name": "...", "items": [{"item": "...", "qty": "...", "note": "..."}]}]},
  "water": {"gallons_per_day": ${wm.gallons_per_day}, "gallons_72h": ${wm.gallons_72h},
    "storage_options": [{"option": "...", "detail": "..."}],
    "rotation_tips": ["..."]},
  "food": {"daily_calories_per_person": <number>, "staples": [{"item": "...", "qty_30d": "..."}], "meal_ideas": ["..."], "notes": "..."}
}
Rules:
- checklist: 5-7 categories, 4-8 items each, quantities scaled to THIS household, notes brief and practical.
- water: 3-5 storage options suited to a ${intake.home_type} (apartments can't store 55-gal drums), 3-5 rotation tips.
- food: 10-16 staples with 30-day quantities for THIS household, 5-8 no-cook-friendly meal ideas, shelf-stable focus.
- Practical, brand-agnostic, calm. No fear-mongering.`; }

function part2User(intake) {
  const region = REGIONS[intake.region];
  const budget = BUDGET_TIERS[intake.budget_tier];
  const kidBit = intake.kids > 0 ? `${intake.kids} kid(s)` : "no kids";
  const petBit = intake.pets > 0 ? `${intake.pets} pet(s)` : "no pets";
  return `Write PART 2 of a personalized survival-preparedness playbook for: ${intake.adults} adult(s), ${kidBit}, ${petBit}, living in a ${intake.home_type} in the ${region.label} region (main hazards: ${region.hazards}). Budget tier: "${budget.label}" (${budget.range}) — the buy list must be realistic for this budget and ordered by impact-per-dollar.

Respond with ONLY this JSON object:
{
  "power": {"before": ["..."], "during": ["..."], "after": ["..."]},
  "buy_list": [{"priority": 1, "item": "...", "est_cost_usd": <number>, "why": "..."}],
  "region_notes": ["..."]
}
Rules:
- power: 5-8 steps each for before/during/after an outage, specific to ${intake.home_type} living.
- buy_list: at most 15 items, priority 1 = highest impact first, est_cost_usd realistic US prices, total roughly within the ${budget.label} tier (${budget.range}).
- region_notes: 3-5 notes specific to ${region.hazards} in the ${region.label} region.
- Practical, brand-agnostic, calm. No fear-mongering.`; }

function validPart1(d) {
  if (!d || typeof d !== "object") return "not_an_object";
  const cats = d.checklist && d.checklist.categories;
  if (!Array.isArray(cats) || cats.length < 4 || cats.length > 8) return "bad_checklist";
  for (const c of cats) {
    if (!c.name || !Array.isArray(c.items) || c.items.length < 3 || c.items.length > 9) return "bad_checklist_items";
    for (const it of c.items) if (!it.item || !it.qty) return "bad_checklist_item";
  }
  const w = d.water || {};
  if (typeof w.gallons_per_day !== "number" || typeof w.gallons_72h !== "number") return "bad_water";
  if (!Array.isArray(w.storage_options) || w.storage_options.length < 2) return "bad_water_storage";
  const f = d.food || {};
  if (!Array.isArray(f.staples) || f.staples.length < 6) return "bad_food_staples";
  if (!Array.isArray(f.meal_ideas) || f.meal_ideas.length < 3) return "bad_food_meals";
  return true;
}

function validPart2(d) {
  if (!d || typeof d !== "object") return "not_an_object";
  const p = d.power || {};
  for (const k of ["before", "during", "after"]) {
    if (!Array.isArray(p[k]) || p[k].length < 3) return "bad_power_" + k;
  }
  if (!Array.isArray(d.buy_list) || d.buy_list.length < 3 || d.buy_list.length > 15) return "bad_buy_list";
  for (const b of d.buy_list) {
    if (!b.item || typeof b.est_cost_usd !== "number") return "bad_buy_item";
  }
  if (!Array.isArray(d.region_notes) || d.region_notes.length < 2) return "bad_region_notes";
  return true;
}

export function b64encodeChunked(bytes) {
  // btoa on one giant string can blow arg limits; chunk it.
  // CRITICAL: chunk length must be a multiple of 3, otherwise btoa emits
  // "=" padding mid-string and a single atob() on the result decodes only
  // the first chunk. 98304 = 3 * 32768 → padding appears only at the very end.
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  let out = "";
  const B64_CHUNK = 98304;
  for (let i = 0; i < bin.length; i += B64_CHUNK) out += btoa(bin.slice(i, i + B64_CHUNK));
  return out;
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env && env.LEADS_DB;
    if (!db || typeof db.prepare !== "function") return json({ ok: false, error: "no_db" }, 503);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }
    const orderToken = String((body && body.order_token) || "").trim();
    if (!orderToken || orderToken.length < 16) return json({ ok: false, error: "missing_token" }, 400);

    const order = await db
      .prepare("SELECT * FROM prepguide_orders WHERE access_token = ?")
      .bind(orderToken)
      .first();
    if (!order) return json({ ok: false, error: "unknown_order" }, 404);

    // Idempotent replay: already built → return stored meta, no AI spend.
    if (order.status === "ready" && order.output_json) {
      let meta = {};
      try {
        meta = JSON.parse(order.output_json);
      } catch {}
      return json({ ok: true, replay: true, pages: meta.pages || null });
    }
    if (!["paid", "failed"].includes(order.status)) {
      return json({ ok: false, error: order.status === "generating" ? "in_progress" : "order_not_payable", status: order.status }, 409);
    }

    // Serialize concurrent builds: only one worker may flip paid/failed → generating.
    const claim = await db
      .prepare(`UPDATE prepguide_orders SET status='generating' WHERE id=? AND status IN ('paid','failed')`)
      .bind(order.id)
      .run();
    const claimed = claim && claim.meta && claim.meta.changes === 1;
    if (!claimed) {
      const cur = await db.prepare("SELECT status FROM prepguide_orders WHERE id=?").bind(order.id).first();
      if (cur && cur.status === "ready") return json({ ok: true, replay: true });
      return json({ ok: false, error: "in_progress" }, 409);
    }

    const fail = async (err) => {
      console.error("prepguide/generate failed", err);
      await db.prepare(`UPDATE prepguide_orders SET status='failed' WHERE id=?`).bind(order.id).run();
      return json({ ok: false, error: "build_failed" }, 500);
    };

    // Intake: checkout stores body.params FLAT as metadata_json; accept wrapped too.
    let rawMeta = {};
    try {
      const pay = await db.prepare("SELECT metadata_json FROM billing_payments WHERE id=?").bind(order.payment_id).first();
      rawMeta = JSON.parse((pay && pay.metadata_json) || "{}");
    } catch {}
    const intakeRaw = (rawMeta && typeof rawMeta === "object" && rawMeta.inputs) || rawMeta || {};
    let storedInputs = {};
    try {
      storedInputs = JSON.parse(order.inputs_json || "{}").inputs || {};
    } catch {}
    const v = validateIntake({ ...storedInputs, ...intakeRaw });
    if (!v.ok) return fail("invalid_intake:" + v.error);
    const intake = v.intake;

    // ── AI: full playbook JSON, in two under-the-cap calls ──
    let p1, p2;
    try {
      ({ parsed: p1 } = await runJson(env, FULL_SYSTEM, part1User(intake), {
        max_tokens: 3200, temperature: 0.5, retries: 2, label: "playbook-part1", validate: validPart1,
      }));
      ({ parsed: p2 } = await runJson(env, FULL_SYSTEM, part2User(intake), {
        max_tokens: 2600, temperature: 0.5, retries: 2, label: "playbook-part2", validate: validPart2,
      }));
    } catch (e) {
      return fail(String((e && e.message) || e).slice(0, 160));
    }
    const parsed = {
      checklist: p1.checklist,
      water: p1.water,
      food: p1.food,
      power: p2.power,
      buy_list: p2.buy_list,
      region_notes: p2.region_notes,
    };

    // ── render PDF ──
    // Keep the paid checklist's Water quantities consistent with the
    // deterministic water section (same class of model-math drift as teaser).
    const wm = waterMath(intake);
    if (parsed.checklist && Array.isArray(parsed.checklist.categories)) {
      parsed.checklist.categories = alignWaterItems(parsed.checklist.categories, wm.gallons_72h);
    }
    let pdf;
    try {
      pdf = await renderPdf(parsed, {
        household_label: householdLabel(intake),
        date: new Date().toISOString().slice(0, 10),
      });
    } catch (e) {
      return fail("pdf_render_failed:" + String((e && e.message) || e).slice(0, 120));
    }
    // Size backstop: measured renders — empty playbook 4.6KB (rejected by
    // validPlaybook before render), minimal-valid 5.4KB, complete fixture
    // 10.8KB. Floor 5000 catches catastrophic render failures without
    // rejecting legitimate lean-but-valid playbooks.
    if (!pdf.bytes || pdf.bytes.length < 5000 || pdf.bytes.length > 2 * 1024 * 1024) {
      return fail("pdf_size_suspect:" + (pdf.bytes ? pdf.bytes.length : 0));
    }

    const output = {
      pdf_b64: b64encodeChunked(pdf.bytes),
      generated_at: new Date().toISOString(),
      model: "llama-3.3-70b-instruct-fp8-fast",
      pages: pdf.pages,
      intake,
    };
    await db
      .prepare(`UPDATE prepguide_orders SET status='ready', output_json=?, ready_at=${nowSql} WHERE id=?`)
      .bind(JSON.stringify(output), order.id)
      .run();
    return json({ ok: true, pages: pdf.pages });
  } catch (e) {
    console.error("prepguide/generate threw", e && e.message);
    return json({ ok: false, error: "build_failed" }, 500);
  }
}
