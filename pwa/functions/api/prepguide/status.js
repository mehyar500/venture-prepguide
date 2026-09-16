// functions/api/prepguide/status.js
// GET /api/prepguide/status?token= — order status for the success page poll.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  const token = (new URL(request.url).searchParams.get("token") || "").trim();
  if (!token || token.length < 16) return json({ ok: false, error: "invalid_token" }, 403);
  const db = env && env.LEADS_DB;
  if (!db || typeof db.prepare !== "function") return json({ ok: false, error: "no_db" }, 503);
  const order = await db
    .prepare("SELECT status, email, product_id, ready_at FROM prepguide_orders WHERE access_token = ?")
    .bind(token)
    .first();
  if (!order) return json({ ok: false, error: "unknown_order" }, 404);
  return json({
    ok: true,
    status: order.status,
    email: order.email,
    product_id: order.product_id,
    ready: order.status === "ready",
    ready_at: order.ready_at || null,
  });
}
