// Edge Function openpay-webhook: recibe eventos de Openpay (cargos de suscripción) y actualiza empresa_subscriptions. US-216/US-217.
// Seguridad: Basic Auth configurada al dar de alta el webhook en Openpay (app_secrets.openpay_webhook_user / openpay_webhook_pass).
// Eventos: verification (alta del webhook), charge.succeeded, charge.failed, subscription.charge.failed, charge.refunded.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const FN_URL = Deno.env.get("SUPABASE_URL")! + "/functions/v1";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function secrets(): Promise<Record<string, string>> {
  const { data } = await admin.from("app_secrets").select("key,value").in("key", ["openpay_webhook_user", "openpay_webhook_pass", "internal_key"]);
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}
function basicOk(req: Request, user: string, pass: string): boolean {
  if (!user || !pass) return false;
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Basic ")) return false;
  try { const [u, p] = atob(h.slice(6)).split(":"); return u === user && p === pass; } catch { return false; }
}
async function enviar(internalKey: string, to: string, template: string, data: Record<string, unknown>, empresa_id: number) {
  await fetch(FN_URL + "/send-email", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": internalKey }, body: JSON.stringify({ to, template, data, empresa_id }) }).catch(() => {});
}
async function adminEmpresa(empresa_id: number) {
  const { data } = await admin.from("obra_usuarios").select("email,nombre").eq("empresa_id", empresa_id).eq("es_admin_empresa", true).order("created_at").limit(1).maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let ev: any = {}; try { ev = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const s = await secrets();
  // Alta del webhook: Openpay manda un evento de verificación antes de exigir credenciales
  if (ev.type === "verification") {
    await admin.from("app_secrets").upsert({ key: "openpay_webhook_verification", value: String(ev.verification_code ?? ""), updated_at: new Date().toISOString() });
    return json({ ok: true });
  }
  if (!basicOk(req, s.openpay_webhook_user, s.openpay_webhook_pass)) return json({ error: "No autorizado" }, 401);

  const tx = ev.transaction ?? {};
  const customerId = tx.customer_id ?? tx.customer?.id ?? null;
  const subscriptionId = tx.subscription_id ?? null;
  if (!customerId && !subscriptionId) return json({ ok: true, ignorado: "sin cliente" });
  const { data: subs } = await admin.rpc("suscripcion_por_openpay", { p_customer_id: customerId, p_subscription_id: subscriptionId });
  const sub = subs && subs.length ? subs[0] : null;
  if (!sub) return json({ ok: true, ignorado: "empresa no encontrada" });

  const tipo = String(ev.type ?? "");
  const monto = Number(tx.amount ?? 0);
  if (tipo === "charge.succeeded") {
    const { data: r } = await admin.rpc("aplicar_pago_suscripcion", { p_empresa_id: sub.empresa_id, p_charge_id: tx.id, p_subscription_id: subscriptionId, p_monto: monto, p_estado: "pagado", p_descripcion: tx.description ?? "Suscripción Control de Obra", p_raw: tx });
    // CFDI del cobro (US-217): lo intenta la función cfdi-suscripcion; si falla queda cfdi_error y se reintenta en jobs
    if (r && r.payment_id && !r.duplicado) {
      fetch(FN_URL + "/cfdi-suscripcion", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": s.internal_key }, body: JSON.stringify({ payment_id: r.payment_id }) }).catch(() => {});
    }
    return json({ ok: true, aplicado: r });
  }
  if (tipo === "charge.failed" || tipo === "subscription.charge.failed") {
    const { data: r } = await admin.rpc("aplicar_pago_suscripcion", { p_empresa_id: sub.empresa_id, p_charge_id: tx.id ?? ("fail-" + Date.now()), p_subscription_id: subscriptionId, p_monto: monto, p_estado: "fallido", p_descripcion: tx.error_message ?? "Cobro rechazado", p_raw: tx });
    const a = await adminEmpresa(sub.empresa_id);
    if (a?.email) {
      const { data: plan } = await admin.from("subscription_plans").select("nombre").eq("id", sub.plan_id).maybeSingle();
      await enviar(s.internal_key, a.email, "cobro_fallido", { nombre: a.nombre, monto: new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(monto), plan: plan?.nombre ?? "" }, sub.empresa_id);
    }
    return json({ ok: true, aplicado: r });
  }
  if (tipo === "charge.refunded") {
    await admin.from("subscription_payments").update({ estado: "reembolsado" }).eq("openpay_charge_id", tx.id);
    return json({ ok: true });
  }
  return json({ ok: true, ignorado: tipo });
});
