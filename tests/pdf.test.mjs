// pdf.test.mjs — renderPdf smoke test with a fixture playbook.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFArray } from "../pwa/functions/_lib/pdf-lib.esm.js";
import { renderPdf } from "../pwa/functions/_lib/renderPdf.js";

// Extract text via pdf-lib's own parser: load the doc, walk each page's
// content streams, inflate, and decode hex-string Tj operands. Robust
// against line-wrapped hex and binary stream data.
async function pdfText(bytes) {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (let i = 0; i < doc.getPageCount(); i++) {
    const contents = doc.getPage(i).node.get(PDFName.of("Contents"));
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of refs) {
      const stream = doc.context.lookup(ref);
      let data = Buffer.from(stream.getContents());
      try { data = inflateSync(data); } catch { /* not flate */ }
      out += data.toString("latin1") + "\n";
    }
  }
  out = out.replace(/\r?\n/g, "");
  const hexRe = /<([0-9a-fA-F]+)>/g;
  let h, decoded = "";
  while ((h = hexRe.exec(out)) !== null) {
    decoded += Buffer.from(h[1], "hex").toString("latin1") + " ";
  }
  return { decoded, pages: doc.getPageCount() };
}

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name); }
}

const fixture = JSON.parse(readFileSync(new URL("./fixture-playbook.json", import.meta.url), "utf8"));

const { bytes, pages } = await renderPdf(fixture, {
  household_label: "2 adults · 1 kid · 1 pet · House · Southeast",
  date: "2026-09-15",
});
const { decoded, pages: parsedPages } = await pdfText(bytes);

const header = Buffer.from(bytes.slice(0, 5)).toString();
t("starts with %PDF", header === "%PDF-");
t("pages >= 5 (got " + pages + ")", pages >= 5);
t("parsed pages >= 5 (got " + parsedPages + ")", parsedPages >= 5);
t("size >= 5KB (got " + bytes.length + ")", bytes.length >= 5 * 1024);
t("size <= 2MB (got " + bytes.length + ")", bytes.length <= 2 * 1024 * 1024);

// Key section titles present as text (also proves content streams decode).
const TITLES = ["72-Hour Kit Checklist", "Water: Your Numbers", "30-Day Food Plan", "Power-Outage Playbook", "Buy List", "Notes for Your Region", "prepguide.mehyar.us"];
for (const s of TITLES) {
  t("contains " + JSON.stringify(s), decoded.includes(s));
}

// robustness: empty playbook must not throw
const r2 = await renderPdf({}, { household_label: "x", date: "2026-09-15" });
t("empty playbook renders", r2.bytes.length > 1000 && r2.pages >= 5);

console.log(`pdf: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
