// functions/_lib/validate.js
// PrepGuide intake validation — pure logic, no runtime deps.
// Shared by teaser.js + generate.js; unit-tested in ~/workspace/prepguide/tests/.

export const HOME_TYPES = ["house", "apartment"];

export const REGIONS = {
  northeast: { label: "Northeast", hazards: "ice storms and blizzards" },
  southeast: { label: "Southeast", hazards: "hurricanes" },
  midwest: { label: "Midwest", hazards: "tornadoes and ice storms" },
  south: { label: "South", hazards: "extreme heat and hurricanes" },
  west: { label: "West", hazards: "wildfires and earthquakes" },
  mountain: { label: "Mountain", hazards: "blizzards and wildfires" },
};

export const BUDGET_TIERS = {
  shoestring: { label: "Shoestring", range: "under $150" },
  practical: { label: "Practical", range: "$150–$500" },
  stocked: { label: "Stocked", range: "$500–$1,500" },
  fortress: { label: "Fortress", range: "$1,500+" },
};

function intInRange(v, min, max) {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Validate a raw intake object. Returns { ok:true, intake } with normalized
 * values, or { ok:false, error } naming the first problem.
 */
export function validateIntake(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const adults = intInRange(r.adults, 1, 10);
  if (adults === null) return { ok: false, error: "invalid_adults" };
  const kids = intInRange(r.kids, 0, 10);
  if (kids === null) return { ok: false, error: "invalid_kids" };
  const pets = intInRange(r.pets, 0, 10);
  if (pets === null) return { ok: false, error: "invalid_pets" };
  const home_type = String(r.home_type || "").toLowerCase().trim();
  if (!HOME_TYPES.includes(home_type)) return { ok: false, error: "invalid_home_type" };
  const region = String(r.region || "").toLowerCase().trim();
  if (!REGIONS[region]) return { ok: false, error: "invalid_region" };
  const budget_tier = String(r.budget_tier || "").toLowerCase().trim();
  if (!BUDGET_TIERS[budget_tier]) return { ok: false, error: "invalid_budget_tier" };
  const persons = adults + kids;
  return {
    ok: true,
    intake: { adults, kids, pets, home_type, region, budget_tier, persons },
  };
}

/** Human-readable household label, e.g. "2 adults, 1 kid · House · Southeast". */
export function householdLabel(intake) {
  const parts = [];
  parts.push(intake.adults + (intake.adults === 1 ? " adult" : " adults"));
  if (intake.kids > 0) parts.push(intake.kids + (intake.kids === 1 ? " kid" : " kids"));
  if (intake.pets > 0) parts.push(intake.pets + (intake.pets === 1 ? " pet" : " pets"));
  parts.push(intake.home_type === "house" ? "House" : "Apartment");
  parts.push(REGIONS[intake.region].label);
  return parts.join(" · ");
}

/** Deterministic water math: 1 gal/person/day drinking + 0.5 sanitation. */
export function waterMath(intake) {
  const perDay = Math.round((intake.persons * 1.5) * 10) / 10;
  return {
    gallons_per_day: perDay,
    gallons_72h: Math.round(perDay * 3 * 10) / 10,
    gallons_14d: Math.round(perDay * 14 * 10) / 10,
  };
}

/**
 * Post-process AI-generated checklist categories so the bulk-water item in a
 * "Water" category agrees with deterministic water math (the source of truth).
 * The model sometimes does its own water math and gets it wrong (live case:
 * said "7.5 gallons" for a household whose deterministic total is 13.5).
 * Only the first bulk-water item is overridden; treatment items (filters,
 * tablets, bleach) are left alone.
 */
export function alignWaterItems(categories, gallons) {
  const target = `${gallons} gallons`;
  return (categories || []).map((c) => {
    if (!c || !/water/i.test(String(c.name || ""))) return c;
    let replaced = false;
    const items = (c.items || []).map((it) => {
      const text = `${it.item || ""} ${it.qty || ""}`;
      const isBulk = /gallon|drinking water|water storage|store water|bottled water/i.test(text);
      const isTreatment = /filter|purif|tablet|boil|bleach|treatment|test strip/i.test(text);
      if (!replaced && isBulk && !isTreatment) {
        replaced = true;
        return { ...it, qty: target };
      }
      return it;
    });
    return { ...c, items };
  });
}
