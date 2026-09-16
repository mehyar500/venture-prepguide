// functions/_lib/ai.js
// PrepGuide Workers AI helpers. No secrets — everything via env.AI.
//
// Baked-in lesson: @cf/meta/llama-3.3-70b-instruct-fp8-fast with
// response_format:{type:"json_object"} returns result.response PRE-PARSED
// as a JS object, not a string. aiText() serializes objects back so the
// JSON path works either way.

export const MODELS = {
  text: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
};

function aiText(out) {
  if (typeof out === "string") return out;
  const r = out && out.response;
  if (r == null) return "";
  return typeof r === "string" ? r : JSON.stringify(r);
}

/** Parse model output as JSON; tolerates fences and single-quoted dicts. Returns null. */
export function parseJson(s) {
  if (!s) return null;
  const candidates = [s];
  const m = /```(?:json)?\s*([\s\S]+?)\s*```/i.exec(s);
  if (m) candidates.push(m[1]);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(s.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {}
    const norm = normalizePyDict(c);
    if (norm !== c) {
      try {
        return JSON.parse(norm);
      } catch {}
    }
  }
  return null;
}

function normalizePyDict(s) {
  return s
    .replace(/\\'/g, "__APOS__")
    .replace(/([{,\s])'([^'\n]*?)'(\s*:)/g, '$1"$2"$3')
    .replace(/([:\[,\]\s])'([^'\n]*?)'(\s*[,}\]])/g, '$1"$2"$3')
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/__APOS__/g, "'");
}

/**
 * runJson(env, system, user, opts) — JSON-mode text call with schema
 * validation and bounded retries. validate(parsed) returns true | false | string.
 * Returns { parsed, attempts }. Throws after retries are exhausted.
 */
export async function runJson(env, system, user, opts = {}) {
  const { max_tokens = 3000, temperature = 0.5, retries = 2, validate = null, label = "json" } = opts;
  if (!env || !env.AI || typeof env.AI.run !== "function") {
    throw new Error("runJson: env.AI binding missing");
  }
  const base = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let msgs = base;
  let lastErr = "unknown";
  for (let attempt = 0; attempt <= retries; attempt++) {
    let text = "";
    try {
      const out = await env.AI.run(MODELS.text, {
        messages: msgs,
        response_format: { type: "json_object" },
        max_tokens,
        temperature,
      });
      text = aiText(out).trim();
    } catch (e) {
      lastErr = "ai_call_failed: " + String((e && e.message) || e).slice(0, 120);
      continue;
    }
    const parsed = parseJson(text);
    if (!parsed) {
      lastErr = "parse_failed";
    } else if (validate) {
      const v = validate(parsed);
      if (v === true) return { parsed, attempts: attempt + 1 };
      lastErr = typeof v === "string" && v ? v : "schema_validation_failed";
    } else {
      return { parsed, attempts: attempt + 1 };
    }
    const why = lastErr === "parse_failed"
      ? "was not valid JSON"
      : lastErr === "schema_validation_failed"
        ? "did not match the required schema"
        : lastErr;
    msgs = [
      ...base,
      { role: "user", content: `Your last response ${why}. Reply with ONLY a corrected JSON object matching the schema — no prose, no fences, no apologies.` },
    ];
  }
  throw new Error(`runJson(${label}) failed after ${retries + 1} attempts: ${lastErr}`);
}
