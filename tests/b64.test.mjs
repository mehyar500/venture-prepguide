// b64.test.mjs — regression test for the chunked-base64 bug class:
// btoa() per chunk with a chunk length NOT divisible by 3 emits "=" padding
// mid-string; a single atob() then decodes only the first chunk (truncated PDF).
// The encoder must chunk in multiples of 3 so padding appears only at the end.
import { b64encodeChunked } from "../pwa/functions/api/prepguide/generate.js";

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name); }
}

// deterministic pseudo-random bytes (no Math.random: reproducible)
function pseudoBytes(n) {
  const b = new Uint8Array(n);
  let x = 123456789;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    b[i] = x & 0xff;
  }
  return b;
}

for (const n of [0, 1, 2, 3, 5, 100, 99999, 100000, 100001, 250000, 300000]) {
  const bytes = pseudoBytes(n);
  const b64 = b64encodeChunked(bytes);
  // no mid-string padding: "=" may only appear at the very end (max 2 chars)
  const stripped = b64.replace(/=+$/, "");
  t(`n=${n} no mid-string padding`, !stripped.includes("="));
  // full round-trip through a single atob-equivalent
  const back = Buffer.from(b64, "base64");
  t(`n=${n} round-trip length`, back.length === n);
  let same = back.length === n;
  if (same) {
    for (let i = 0; i < n; i++) {
      if (back[i] !== bytes[i]) { same = false; break; }
    }
  }
  t(`n=${n} round-trip bytes`, same);
}

console.log(`b64: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
