// functions/api/prepguide/deliverable.js
// GET /api/prepguide/deliverable?token= — serves the playbook PDF.
// The access token is the capability; nothing else is needed.

function b64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

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
    .prepare("SELECT status, output_json FROM prepguide_orders WHERE access_token = ?")
    .bind(token)
    .first();
  if (!order) return json({ ok: false, error: "unknown_order" }, 404);
  if (order.status !== "ready") {
    const err = order.status === "failed" ? "failed" : "not_ready";
    return json({ ok: false, error: err, status: order.status }, 409);
  }
  let out = null;
  try {
    out = JSON.parse(order.output_json || "{}");
  } catch {
    return json({ ok: false, error: "deliverable_corrupt" }, 500);
  }
  if (!out.pdf_b64) return json({ ok: false, error: "deliverable_corrupt" }, 500);
  const bytes = b64ToBytes(out.pdf_b64);
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="prepguide-playbook.pdf"',
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
    },
  });
}
