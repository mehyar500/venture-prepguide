// functions/api/_shared/fulfillPrepguide.js
// Standalone ES module: Stripe fulfillment for fulfillment='prepguide' products.
// Called from the shared /api/pay/webhook in mehyar-web.
//
// Contract: fulfillPrepguide({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (mehyar_leads_prod; has prepguide_orders)
//   env       — worker env (PREPGUIDE_BASE_URL optional, defaults to prod)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, access_token,
//               metadata_json}. metadata_json = checkout params FLAT
//               (adults, kids, pets, home_type, region, budget_tier).
//
// Behavior:
//   1. Idempotent: exactly one prepguide_orders row per payment.id
//      (UNIQUE index idx_prepguide_orders_payment). Replays return early.
//   2. ONE token everywhere: the order reuses payment.access_token, which is
//      already baked into the Stripe success_url (?token=). No token swap,
//      so success.html, /api/pay/status, and the product's own
//      status/deliverable endpoints all gate on the same token.
//   3. Background: POST PREPGUIDE_BASE_URL/api/prepguide/generate
//      {order_token}. The product endpoint runs Workers AI, renders the PDF
//      with pdf-lib, stores it, and marks the order ready/failed itself.
//      On ok: email the buyer the success link. On failure: mark failed,
//      do NOT email — success.html shows live status + a retry button.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function baseUrl(env) {
  return String(env.PREPGUIDE_BASE_URL || "https://prepguide.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until prepguide.mehyar.us is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.PREPGUIDE_FROM_EMAIL || "team@mehyar.us",
    fromName: "PrepGuide",
  };
}

export async function fulfillPrepguide({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillPrepguide: bad args");

  const productId = payment.product_id;
  const token = payment.access_token;
  if (!token || token.length < 16) throw new Error("fulfillPrepguide: bad payment token");

  let meta = {};
  try {
    meta = JSON.parse(payment.metadata_json || "{}");
  } catch {}
  // The centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json. Accept both the flat shape and a wrapped {inputs:{...}}.
  const intakeInputs = (meta && typeof meta === "object" && meta.inputs) || meta || {};

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status FROM prepguide_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  const inputsJson = JSON.stringify({ inputs: intakeInputs });
  const ins = await db
    .prepare(
      "INSERT INTO prepguide_orders (payment_id, product_id, email, inputs_json, status, access_token) " +
        "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, payment.email, inputsJson, token)
    .run();
  const orderId = ins.meta.last_row_id;

  const { from, fromName } = fromAddress(env);

  // ── background generation, then email ──
  const run = async () => {
    try {
      const genResp = await fetch(`${baseUrl(env)}/api/prepguide/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_token: token }),
      });
      const genData = await genResp.json().catch(() => ({}));
      if (!genResp.ok || !genData.ok) {
        throw new Error("generate:" + String((genData && genData.error) || genResp.status));
      }

      const successUrl = `${baseUrl(env)}/success.html?token=${token}`;
      const subject = "Your PrepGuide playbook is ready";
      const text =
        `Thanks for your purchase!\n\n` +
        `Your personalized PrepGuide survival playbook is ready — built for your household, your home, and your region:\n${successUrl}\n\n` +
        `Inside: your 72-hour kit checklist, water-storage math, 30-day food plan, power-outage playbook, and your prioritized buy list.\n\n` +
        `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n-- ${fromName}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your personalized <strong>PrepGuide survival playbook</strong> is ready — built for your household, your home, and your region.</p>` +
        `<p><a href="${successUrl}" style="display:inline-block;background:#b45309;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Download your playbook</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${successUrl}">${successUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Inside: your 72-hour kit checklist, water-storage math, 30-day food plan, power-outage playbook, and your prioritized buy list.</p>` +
        `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
        `<p>-- ${fromName}</p>`;
      const result = await sendEmail(env, { from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
      if (!result.ok) console.error("fulfillPrepguide email failed", productId, result.error);
      return { ok: true, order_id: orderId, email_ok: !!result.ok, pages: genData.pages || null };
    } catch (e) {
      console.error("fulfillPrepguide background generate failed", productId, e && e.message);
      try {
        await db.prepare("UPDATE prepguide_orders SET status='failed' WHERE id=? AND status IN ('paid','generating')")
          .bind(orderId).run();
      } catch {}
      // No email on failure: the buyer lands on success.html?token= from
      // Stripe, which shows live status + a retry button that re-POSTs
      // /api/prepguide/generate with their token.
      return { ok: false, order_id: orderId, error: String((e && e.message) || e).slice(0, 120) };
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId };
}
