// validate.test.mjs — intake validation unit tests.
import { validateIntake, householdLabel, waterMath } from "../pwa/functions/_lib/validate.js";

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name); }
}

const good = { adults: 2, kids: 1, pets: 1, home_type: "house", region: "southeast", budget_tier: "practical" };

// happy path
let v = validateIntake(good);
t("valid intake ok", v.ok === true);
t("persons = adults+kids", v.intake.persons === 3);
t("household label", householdLabel(v.intake) === "2 adults · 1 kid · 1 pet · House · Southeast");

// water math: 1 gal/person/day drinking + 0.5 sanitation
const wm = waterMath(v.intake);
t("water per day", wm.gallons_per_day === 4.5);
t("water 72h", wm.gallons_72h === 13.5);

// string-number coercion (form posts may send strings)
v = validateIntake({ ...good, adults: "2", kids: "0" });
t("string ints coerce", v.ok === true && v.intake.adults === 2);

// rejects
t("adults 0 rejected", validateIntake({ ...good, adults: 0 }).ok === false);
t("adults 11 rejected", validateIntake({ ...good, adults: 11 }).ok === false);
t("kids -1 rejected", validateIntake({ ...good, kids: -1 }).ok === false);
t("pets 99 rejected", validateIntake({ ...good, pets: 99 }).ok === false);
t("bad home_type", validateIntake({ ...good, home_type: "yurt" }).ok === false);
t("bad region", validateIntake({ ...good, region: "narnia" }).ok === false);
t("bad budget", validateIntake({ ...good, budget_tier: "yolo" }).ok === false);
t("missing adults", validateIntake({ kids: 0, pets: 0, home_type: "house", region: "west", budget_tier: "shoestring" }).ok === false);
t("null input", validateIntake(null).ok === false);
t("empty object", validateIntake({}).ok === false);

// region slugs all valid
for (const r of ["northeast", "southeast", "midwest", "south", "west", "mountain"]) {
  t("region " + r, validateIntake({ ...good, region: r }).ok === true);
}
// case-insensitive normalization
t("region uppercase ok", validateIntake({ ...good, region: "West" }).ok === true);
t("apartment label", householdLabel(validateIntake({ ...good, home_type: "apartment", kids: 0, pets: 0 }).intake) === "2 adults · Apartment · Southeast");

console.log(`validate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
