// Edge Function openpay: suscripciones de Control de Obra con Openpay (cuenta de Zook, decisión Q3). US-215.
// Acciones (sesión de empresa nivel >= 100 por x-obra-token):
//   preparar                       → llave pública, merchant, sandbox y planes (para Openpay.js)
//   suscribir {plan_slug, periodicidad, token_id, device_session_id, datos_fiscales}
//   cambiar_tarjeta {token_id, device_session_id}
//   cancelar                       → cancela al fin del periodo (cancel_at_period_end)
// Secretos en app_secrets: openpay_merchant_id, openpay_private_key, openpay_public_key, openpay_sandbox ('true'/'false').
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function secrets(): Promise<Record<string, string>> {
  const { data } = await admin.from("app_secrets").select("key,value").like("key", "openpay_%");
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}
type Session = { user_id: string; nombre: string; email: string; empresa_id: number; empresa_nombre: string; nivel_acceso: number };
async function session(req: Request): Promise<Session | null> {
  const t = req.headers.get("x-obra-token") ?? "";
  if (!t) return null;
  const { data } = await admin.rpc("validar_sesion", { p_token: t });
  return data && data.length ? data[0] : null;
}

class Openpay {
  base: string; auth: string; merchant: string; sandbox: boolean;
  constructor(s: Record<string, string>) {
    this.sandbox = String(s.openpay_sandbox) === "true";
    this.merchant = s.openpay_merchant_id;
    this.base = (this.sandbox ? "https://sandbox-api.openpay.mx" : "https://api.openpay.mx") + "/v1/" + this.merchant;
    this.auth = "Basic " + btoa(s.openpay_private_key + ":");
  }
  async call(method: string, path: string, body?: unknown) {
    const r = await fetch(this.base + path, { method, headers: { Authorization: this.auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text(); let j: any = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
    if (!r.ok) throw new Error(`Openpay ${r.status}: ${j.description || j.error_code || txt.slice(0, 200)}`);
    return j;
  }
}

const MESES: Record<string, number> = { mensual: 1, anual: 12 };
function humano(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/3001|3002|3003|3004|3005|declin|rechaz/i.test(m)) return "El banco rechazó la tarjeta. Prueba con otra o llama a tu banco.";
  if (/3006|fondos|insufficient/i.test(m)) return "La tarjeta no tiene fondos suficientes.";
  if (/expir|vencid/i.test(m)) return "La tarjeta está vencida.";
  if (/cvv|cvv2|security code/i.test(m)) return "El código de seguridad es incorrecto.";
  return m.replace(/^Openpay \d+: /, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let body: any = {}; try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const ses = await session(req);
  if (!ses) return json({ error: "No autorizado" }, 401);
  if ((ses.nivel_acceso ?? 0) < 100) return json({ error: "Sólo el administrador de la empresa puede administrar el plan" }, 403);
  const s = await secrets();
  if (!s.openpay_merchant_id || !s.openpay_private_key) return json({ error: "Openpay no configurado" }, 500);
  const op = new Openpay(s);
  const action = body.action ?? "";
  try {
    if (action === "preparar") {
      const { data: planes } = await admin.from("subscription_plans").select("slug,nombre,precio_mensual,precio_anual").eq("activo", true).order("orden");
      const { data: sub } = await admin.from("empresa_subscriptions").select("estado,periodicidad,card_last4,card_brand,datos_fiscales,current_period_end").eq("empresa_id", ses.empresa_id).maybeSingle();
      return json({ ok: true, merchant_id: op.merchant, public_key: s.openpay_public_key, sandbox: op.sandbox, planes, sub });
    }

    if (action === "suscribir" || action === "cambiar_plan") {
      const slug = String(body.plan_slug ?? ""); const per = body.periodicidad === "anual" ? "anual" : "mensual";
      const { data: plan } = await admin.from("subscription_plans").select("*").eq("slug", slug).eq("activo", true).maybeSingle();
      if (!plan || Number(plan.precio_mensual) <= 0) return json({ error: "Plan inválido" }, 400);
      const monto = per === "anual" ? Number(plan.precio_anual) : Number(plan.precio_mensual);
      // 1) Plan en Openpay (uno por slug+periodicidad+entorno)
      let { data: opPlan } = await admin.from("openpay_planes").select("*").eq("slug", slug).eq("periodicidad", per).eq("sandbox", op.sandbox).maybeSingle();
      if (!opPlan) {
        const creado = await op.call("POST", "/plans", { name: `Control de Obra ${plan.nombre} ${per}`, amount: monto, currency: "MXN", repeat_every: per === "anual" ? 12 : 1, repeat_unit: "month", retry_times: 3, status_after_retry: "unpaid", trial_days: 0 });
        await admin.from("openpay_planes").insert({ slug, periodicidad: per, openpay_plan_id: creado.id, monto, sandbox: op.sandbox });
        opPlan = { openpay_plan_id: creado.id };
      }
      // 2) Cliente en Openpay (uno por empresa)
      const { data: subActual } = await admin.from("empresa_subscriptions").select("*").eq("empresa_id", ses.empresa_id).maybeSingle();
      let customerId = subActual?.openpay_customer_id as string | null;
      if (!customerId) {
        const c = await op.call("POST", "/customers", { name: ses.nombre, email: ses.email, external_id: "obra-empresa-" + ses.empresa_id, requires_account: false });
        customerId = c.id;
      }
      // 3) Tarjeta (token de Openpay.js + device_session_id antifraude)
      if (!body.token_id || !body.device_session_id) return json({ error: "Falta la tarjeta" }, 400);
      const card = await op.call("POST", `/customers/${customerId}/cards`, { token_id: body.token_id, device_session_id: body.device_session_id });
      // 4) Cancelar suscripción anterior si cambia de plan
      if (subActual?.openpay_subscription_id) {
        try { await op.call("DELETE", `/customers/${customerId}/subscriptions/${subActual.openpay_subscription_id}`); } catch (_) { /* puede no existir */ }
      }
      // 5) Suscripción (cobra de inmediato con trial_days 0)
      const sub = await op.call("POST", `/customers/${customerId}/subscriptions`, { plan_id: opPlan.openpay_plan_id, card_id: card.id });
      const fin = new Date(); fin.setMonth(fin.getMonth() + MESES[per]);
      const datos = body.datos_fiscales ?? subActual?.datos_fiscales ?? null;
      const { data: act, error } = await admin.rpc("activar_suscripcion_openpay", { p_empresa_id: ses.empresa_id, p_plan_slug: slug, p_periodicidad: per, p_customer_id: customerId, p_subscription_id: sub.id, p_card_last4: card.card_number?.slice(-4) ?? null, p_card_brand: card.brand ?? null, p_datos_fiscales: datos, p_period_end: fin.toISOString().slice(0, 10) });
      if (error) return json({ error: "Suscripción creada en Openpay pero no se pudo registrar: " + error.message }, 500);
      // Primer cargo: si Openpay ya lo hizo, lo registramos (el webhook lo confirmará y no duplica por charge_id)
      if (sub.charge_id || sub.status === "active") {
        await admin.rpc("aplicar_pago_suscripcion", { p_empresa_id: ses.empresa_id, p_charge_id: sub.charge_id ?? ("sub-" + sub.id + "-inicial"), p_subscription_id: sub.id, p_monto: monto, p_estado: "pagado", p_descripcion: `Plan ${plan.nombre} ${per}`, p_raw: sub });
      }
      return json({ ok: true, subscription_id: sub.id, status: sub.status, periodo_fin: fin.toISOString().slice(0, 10) });
    }

    if (action === "cambiar_tarjeta") {
      const { data: subActual } = await admin.from("empresa_subscriptions").select("*").eq("empresa_id", ses.empresa_id).maybeSingle();
      if (!subActual?.openpay_customer_id || !subActual?.openpay_subscription_id) return json({ error: "No hay suscripción activa" }, 400);
      const card = await op.call("POST", `/customers/${subActual.openpay_customer_id}/cards`, { token_id: body.token_id, device_session_id: body.device_session_id });
      await op.call("PUT", `/customers/${subActual.openpay_customer_id}/subscriptions/${subActual.openpay_subscription_id}`, { card_id: card.id, cancel_at_period_end: false });
      await admin.from("empresa_subscriptions").update({ card_last4: card.card_number?.slice(-4) ?? null, card_brand: card.brand ?? null, estado: subActual.estado === "pago_fallido" ? "activa" : subActual.estado, gracia_hasta: null, updated_at: new Date().toISOString() }).eq("empresa_id", ses.empresa_id);
      return json({ ok: true, last4: card.card_number?.slice(-4) });
    }

    if (action === "cancelar") {
      const { data: subActual } = await admin.from("empresa_subscriptions").select("*").eq("empresa_id", ses.empresa_id).maybeSingle();
      if (subActual?.openpay_customer_id && subActual?.openpay_subscription_id) {
        await op.call("PUT", `/customers/${subActual.openpay_customer_id}/subscriptions/${subActual.openpay_subscription_id}`, { cancel_at_period_end: true });
      }
      await admin.from("empresa_subscriptions").update({ cancelada_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("empresa_id", ses.empresa_id);
      return json({ ok: true });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: humano(e) }, 502);
  }
});
