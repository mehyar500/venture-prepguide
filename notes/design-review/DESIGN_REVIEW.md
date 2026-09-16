# PrepGuide — Design Review (product-build skill, references/design-review.md)

Two full passes. Screenshots preserved in this folder.

## Pass 1 (2026-09-16 ~02:56 UTC, desktop viewport)

Screens: landing hero, intake form, final CTA, footer, success page.

### 5-second test (hero)
1. What is this product? Personalized emergency-preparedness playbook. PASS
2. Who is it for? Households. PASS
3. What do I get for free? Free personalized 72-hour checklist. PASS
4. What does paid add? Full playbook $37 one-time. PASS
5. What do I click next? "Build my free checklist". PASS

### Buyer monologue
- "I came here because I want my household prepared without the doom."
- "The first thing I notice is the calm dark hero and the lantern photo."
- "I'm confused by the bottom of the page — I'm ready to pay $37 and the only button sends me back to the free checklist."
- "I'd pay if I could see what the PDF actually looks like."
- "I'm leaving because I can't find the buy button."

### Fix list (both shipped in commit 1c8a0b0, deployed, repo e89f3cf9)
1. **No direct path to purchase.** The buy form only appeared after completing the free teaser; nav "Get my playbook" and the final CTA both dead-ended at the intake. FIXED: final CTA is now a real paywall (email + "Get my playbook — $37", wired via generalized `wireBuyForm` for all `form.buy-form`); nav CTA + mobile sticky CTA jump to `#buy`.
2. **No sample deliverable visuals.** FIXED: "Sample pages from a real playbook" — 3 real rendered pages from a generated PDF (cover, 72-hour checklist, water math), labeled with the household they were built for.
3. Note: browser task misreported the hero headline in its text report; verified against source + screenshot — actual headline is "When the lights go out, you'll know exactly what to do."

## Pass 2 (2026-09-16 ~03:13 UTC, desktop viewport)

Screens: samples block, final paywall.

### Buyer monologue
- "I came here because I want my household prepared."
- "The first thing I notice is the sample pages — real pages, looks legit."
- "I'm confused by ___." Nothing material.
- "I'd pay if the samples look worth $37 — they do."
- "I'm leaving because ___." No real answer.

### Verdict: SHIP

## Known limitation
Managed-browser tooling cannot set a 390px viewport (no CDP/resize exposed), and
sandbox Chromium --screenshot never writes a file. Mobile verified via CSS audit:
mobile-first stylesheet, single-column below 720px, intake grid 2-col below
520px, nav collapses below 560px, sticky CTA mobile-only, 48px touch targets on
coarse pointers, no fixed-width containers. No horizontal-scroll sources found.
