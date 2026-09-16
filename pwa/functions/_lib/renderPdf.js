// functions/_lib/renderPdf.js
// PrepGuide playbook → print-ready PDF via vendored pdf-lib.
// Letter (612x792). Dark cover, light printable content pages.
// No embedded fonts: Helvetica / Helvetica-Bold only.

import { PDFDocument, StandardFonts, rgb } from "./pdf-lib.esm.js";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

const AMBER = rgb(0.93, 0.58, 0.04);       // #ee940a-ish safety amber
const AMBER_DARK = rgb(0.72, 0.42, 0.02);
const INK = rgb(0.13, 0.11, 0.08);        // #211c14
const MUTED = rgb(0.42, 0.38, 0.32);
const COVER_BG = rgb(0.11, 0.10, 0.09);   // #1c1917
const BONE = rgb(0.96, 0.94, 0.89);       // #f4efe4
const RULE = rgb(0.88, 0.85, 0.78);

const FOOTER_TEXT =
  "Generated for you by PrepGuide · prepguide.mehyar.us — calm, practical preparedness. Not a substitute for local emergency guidance.";

function str(v, max) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return max ? s.slice(0, max) : s;
}

export async function renderPdf(playbook, meta) {
  const pb = playbook && typeof playbook === "object" ? playbook : {};
  const label = str(meta && meta.household_label, 200) || "Your household";
  const dateStr = str(meta && meta.date, 60) || new Date().toISOString().slice(0, 10);

  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // ── tiny layout engine ──
  let page = null;
  let y = 0;
  let pageNum = 0;
  const totalPagesGuess = { count: 0 }; // filled at end; page numbers drawn per page at footer time

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pageNum++;
    y = PAGE_H - MARGIN;
  }

  function footer() {
    page.drawLine({ start: { x: MARGIN, y: 46 }, end: { x: PAGE_W - MARGIN, y: 46 }, thickness: 0.75, color: RULE });
    const fs = 7.5;
    const w = helv.widthOfTextAtSize(FOOTER_TEXT, fs);
    page.drawText(FOOTER_TEXT, { x: (PAGE_W - w) / 2, y: 32, size: fs, font: helv, color: MUTED });
    const pn = String(pageNum);
    page.drawText(pn, {
      x: PAGE_W - MARGIN - helv.widthOfTextAtSize(pn, fs), y: 32, size: fs, font: helv, color: MUTED,
    });
  }

  function wrap(text, font, size, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) <= maxW) {
        line = t;
      } else {
        if (line) lines.push(line);
        // hard-break absurdly long single tokens
        let tok = w;
        while (font.widthOfTextAtSize(tok, size) > maxW && tok.length > 1) {
          let cut = tok.length;
          while (cut > 1 && font.widthOfTextAtSize(tok.slice(0, cut), size) > maxW) cut--;
          lines.push(tok.slice(0, cut));
          tok = tok.slice(cut);
        }
        line = tok;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function ensureSpace(h) {
    if (y - h < 58) {
      footer();
      newPage();
    }
  }

  function gap(h) {
    y -= h;
    ensureSpace(0);
  }

  function drawPara(text, { size = 10.5, font = helv, color = INK, indent = 0, lineH = null } = {}) {
    const lh = lineH || size * 1.45;
    for (const ln of wrap(text, font, size, CONTENT_W - indent)) {
      ensureSpace(lh);
      page.drawText(ln, { x: MARGIN + indent, y: y - size, size, font, color });
      y -= lh;
    }
  }

  function drawBullets(items, { bullet = "•", size = 10.5 } = {}) {
    const lh = size * 1.45;
    for (const it of items) {
      const text = typeof it === "string" ? it : str(it, 400);
      for (const ln of wrap(text, helv, size, CONTENT_W - 18)) {
        ensureSpace(lh);
        page.drawText(bullet, { x: MARGIN + 2, y: y - size, size, font: helvBold, color: AMBER_DARK });
        page.drawText(ln, { x: MARGIN + 18, y: y - size, size, font: helv, color: INK });
        y -= lh;
      }
      y -= 2;
    }
  }

  function sectionTitle(num, title) {
    ensureSpace(52);
    gap(10);
    // amber bar
    page.drawRectangle({ x: MARGIN, y: y - 28, width: 44, height: 5, color: AMBER });
    y -= 8;
    const label2 = `${num}.  ${title}`;
    page.drawText(label2, { x: MARGIN, y: y - 15, size: 15, font: helvBold, color: INK });
    y -= 30;
  }

  function subHead(text) {
    ensureSpace(30);
    gap(6);
    page.drawText(text, { x: MARGIN, y: y - 11, size: 11.5, font: helvBold, color: INK });
    y -= 22;
  }

  // ── cover ──
  newPage();
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: COVER_BG });
  // amber rules top/bottom
  page.drawRectangle({ x: 0, y: PAGE_H - 10, width: PAGE_W, height: 10, color: AMBER });
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 10, color: AMBER });

  let cy = PAGE_H - 170;
  const brand = "P R E P G U I D E";
  page.drawText(brand, { x: MARGIN, y: cy, size: 13, font: helvBold, color: AMBER });
  cy -= 34;
  for (const ln of wrap("Your Household Survival Playbook", helvBold, 40, CONTENT_W)) {
    page.drawText(ln, { x: MARGIN, y: cy - 40, size: 40, font: helvBold, color: BONE });
    cy -= 52;
  }
  cy -= 14;
  page.drawRectangle({ x: MARGIN, y: cy, width: 64, height: 4, color: AMBER });
  cy -= 30;
  for (const ln of wrap("Personalized for " + label, helv, 13, CONTENT_W)) {
    page.drawText(ln, { x: MARGIN, y: cy - 13, size: 13, font: helv, color: rgb(0.78, 0.74, 0.66) });
    cy -= 22;
  }
  cy -= 6;
  page.drawText("Prepared " + dateStr, { x: MARGIN, y: cy - 11, size: 11, font: helv, color: MUTED });
  // cover footer
  page.drawText("prepguide.mehyar.us", { x: MARGIN, y: 44, size: 10, font: helvBold, color: AMBER });
  const cfoot = "Calm. Practical. Specific. — no fear, just a plan.";
  page.drawText(cfoot, { x: MARGIN, y: 28, size: 9, font: helv, color: rgb(0.55, 0.52, 0.46) });

  // ── 1. 72-hour kit checklist ──
  newPage();
  sectionTitle(1, "72-Hour Kit Checklist");
  drawPara("Everything below is sized for your household. Check items off as you gather them — aim to complete this layer first.", { color: MUTED, size: 10 });
  gap(6);
  const cats = (((pb.checklist || {}).categories) || []);
  if (!cats.length) drawPara("Checklist data unavailable — contact info@mehyar.us and we'll regenerate your playbook.", { color: MUTED });
  for (const c of cats.slice(0, 8)) {
    subHead(str(c.name, 80) || "Supplies");
    const items = (c.items || []).slice(0, 12);
    const lh = 10.5 * 1.45;
    for (const it of items) {
      const item = str(it.item, 120);
      const qty = str(it.qty, 60);
      const note = str(it.note, 160);
      const line = qty ? `${item} — ${qty}` : item;
      for (const ln of wrap(line, helv, 10.5, CONTENT_W - 18)) {
        ensureSpace(lh);
        page.drawText("•", { x: MARGIN + 2, y: y - 10.5, size: 10.5, font: helvBold, color: AMBER_DARK });
        page.drawText(ln, { x: MARGIN + 18, y: y - 10.5, size: 10.5, font: helv, color: INK });
        y -= lh;
      }
      if (note) {
        for (const ln of wrap(note, helv, 9, CONTENT_W - 36)) {
          ensureSpace(9 * 1.4);
          page.drawText(ln, { x: MARGIN + 36, y: y - 9, size: 9, font: helv, color: MUTED });
          y -= 9 * 1.4;
        }
      }
      y -= 2;
    }
    gap(4);
  }

  // ── 2. Water ──
  newPage();
  sectionTitle(2, "Water: Your Numbers");
  const water = pb.water || {};
  const gpd = water.gallons_per_day != null ? str(water.gallons_per_day, 20) : "—";
  const g72 = water.gallons_72h != null ? str(water.gallons_72h, 20) : "—";
  // big number cards
  ensureSpace(110);
  const cardW = (CONTENT_W - 16) / 2;
  for (const [i, [big, small]] of [[gpd, "gallons per day"], [g72, "gallons for 72 hours"]].entries()) {
    const x = MARGIN + i * (cardW + 16);
    page.drawRectangle({ x, y: y - 92, width: cardW, height: 92, color: rgb(0.97, 0.95, 0.9) });
    page.drawRectangle({ x, y: y - 92, width: cardW, height: 4, color: AMBER });
    page.drawText(big, { x: x + 18, y: y - 52, size: 30, font: helvBold, color: INK });
    page.drawText(small, { x: x + 18, y: y - 72, size: 10, font: helv, color: MUTED });
  }
  y -= 108;
  drawPara("One gallon per person per day for drinking, plus half a gallon for sanitation. Pets add roughly half a gallon a day each for medium dogs — less for cats and small animals.", { color: MUTED, size: 10 });
  gap(6);
  subHead("Storage options");
  drawBullets((water.storage_options || []).slice(0, 6).map((o) =>
    `${str(o.option, 80)} — ${str(o.detail, 200)}`));
  subHead("Rotation tips");
  drawBullets((water.rotation_tips || []).slice(0, 6).map((t) => str(t, 220)));

  // ── 3. Food ──
  newPage();
  sectionTitle(3, "30-Day Food Plan");
  const food = pb.food || {};
  if (food.daily_calories_per_person) {
    drawPara(`Target: about ${str(food.daily_calories_per_person, 20)} calories per person per day. Shelf-stable, no-cook-friendly, rotated twice a year.`, { size: 10.5 });
    gap(4);
  }
  subHead("Staples — 30-day quantities");
  const lh3 = 10.5 * 1.45;
  for (const s of (food.staples || []).slice(0, 16)) {
    const line = `${str(s.item, 100)} — ${str(s.qty_30d, 80)}`;
    for (const ln of wrap(line, helv, 10.5, CONTENT_W - 18)) {
      ensureSpace(lh3);
      page.drawText("•", { x: MARGIN + 2, y: y - 10.5, size: 10.5, font: helvBold, color: AMBER_DARK });
      page.drawText(ln, { x: MARGIN + 18, y: y - 10.5, size: 10.5, font: helv, color: INK });
      y -= lh3;
    }
    y -= 1;
  }
  gap(4);
  subHead("Simple meal ideas");
  drawBullets((food.meal_ideas || []).slice(0, 10).map((m) => str(m, 220)));
  if (food.notes) {
    gap(4);
    drawPara(str(food.notes, 600), { color: MUTED, size: 10 });
  }

  // ── 4. Power outage ──
  newPage();
  sectionTitle(4, "Power-Outage Playbook");
  const power = pb.power || {};
  const phases = [["before", "Before — when an outage is likely"], ["during", "During — the power is out"], ["after", "After — power is back"]];
  let anyPhase = false;
  for (const [key, head] of phases) {
    const steps = (power[key] || []).slice(0, 10);
    if (!steps.length) continue;
    anyPhase = true;
    subHead(head);
    steps.forEach((s, i) => {
      const lines = wrap(`${i + 1}.  ${str(s, 240)}`, helv, 10.5, CONTENT_W - 6);
      for (const ln of lines) {
        ensureSpace(10.5 * 1.45);
        page.drawText(ln, { x: MARGIN + 6, y: y - 10.5, size: 10.5, font: helv, color: INK });
        y -= 10.5 * 1.45;
      }
      y -= 2;
    });
    gap(4);
  }
  if (!anyPhase) drawPara("Outage playbook data unavailable — contact info@mehyar.us and we'll regenerate your playbook.", { color: MUTED });

  // ── 5. Buy list ──
  newPage();
  sectionTitle(5, "Buy List — Prioritized for Your Budget");
  drawPara("Buy in order. Each tier builds on the last — stop when your budget runs out and you'll still have the highest-impact items first.", { color: MUTED, size: 10 });
  gap(6);
  const buys = (pb.buy_list || []).slice(0, 15);
  if (!buys.length) drawPara("Buy-list data unavailable — contact info@mehyar.us and we'll regenerate your playbook.", { color: MUTED });
  buys.forEach((b, i) => {
    ensureSpace(52);
    const n = `${i + 1}.`;
    const head = `${str(b.item, 110)} — ~$${str(b.est_cost_usd, 20)}`;
    page.drawText(n, { x: MARGIN, y: y - 11, size: 11, font: helvBold, color: AMBER_DARK });
    const nw = helvBold.widthOfTextAtSize(n, 11);
    for (const ln of wrap(head, helvBold, 11, CONTENT_W - nw - 10)) {
      page.drawText(ln, { x: MARGIN + nw + 8, y: y - 11, size: 11, font: helvBold, color: INK });
      y -= 16;
    }
    const why = str(b.why, 220);
    if (why) {
      for (const ln of wrap(why, helv, 9.5, CONTENT_W - (nw + 8))) {
        ensureSpace(14);
        page.drawText(ln, { x: MARGIN + nw + 8, y: y - 9.5, size: 9.5, font: helv, color: MUTED });
        y -= 14;
      }
    }
    y -= 8;
  });

  // ── 6. Region notes ──
  newPage();
  sectionTitle(6, "Notes for Your Region");
  const rnotes = (pb.region_notes || []).slice(0, 6);
  if (!rnotes.length) drawPara("Region notes unavailable — contact info@mehyar.us and we'll regenerate your playbook.", { color: MUTED });
  drawBullets(rnotes.map((n) => str(n, 260)));
  gap(14);
  ensureSpace(60);
  page.drawRectangle({ x: MARGIN, y: y - 44, width: CONTENT_W, height: 44, color: rgb(0.97, 0.95, 0.9) });
  page.drawText("You're more ready than you were an hour ago.", { x: MARGIN + 16, y: y - 22, size: 11, font: helvBold, color: INK });
  page.drawText("Review this playbook twice a year. Rotate food and water. You've got this.", { x: MARGIN + 16, y: y - 38, size: 9.5, font: helv, color: MUTED });
  y -= 60;

  footer();
  totalPagesGuess.count = pageNum;
  const bytes = await doc.save();
  return { bytes, pages: pageNum };
}
