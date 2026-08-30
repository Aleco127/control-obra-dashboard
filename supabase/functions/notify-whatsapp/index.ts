// Edge Function notify-whatsapp (US-240): avisos urgentes por WhatsApp usando la cuenta de Twilio de Zook
// (decisión Q7: WhatsApp desde Zook). Sólo la llama el job diario con x-internal-key.
// Acciones: {action:'enviar', to, template:'cobro_vencido'|'aprobacion', vars:{1:..,2:..,3:..}} y {action:'estado'} que consulta la
// aprobación de las plantillas en Twilio Content y guarda app_secrets.wa_tpl_estado ('approved' | 'pending' | 'rejected' | 'none').
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
async function secret(key: string): Promise<string> { const { data } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle(); return data?.value ?? ""; }
async function setSecret(key: string, value: string) { await admin.from("app_secrets").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" }); }
const TEMPLATES: Record<string, string> = { cobro_vencido: "wa_tpl_cobro_vencido", aprobacion: "wa_tpl_aprobacion" };

async function twilio(path: string, method = "GET", body?: URLSearchParams) {
  const sid = await secret("twilio_account_sid"), tok = await secret("twilio_auth_token");
  if (!sid || !tok) throw new Error("Twilio no configurado (secrets-sync.sh)");
  const r = await fetch(path, { method, headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Twilio ${r.status}`);
  return j;
}

async function estado() {
  const out: Record<string, string> = {};
  let global = "none";
  for (const [k, key] of Object.entries(TEMPLATES)) {
    const csid = await secret(key);
    if (!csid) { out[k] = "none"; continue; }
    try {
      const j = await twilio(`https://content.twilio.com/v1/Content/${csid}/ApprovalRequests`);
      const st = String(j?.whatsapp?.status || "unsubmitted").toLowerCase();
      out[k] = st;
    } catch (e) { out[k] = "error: " + (e as Error).message; }
  }
  const vals = Object.values(out);
  if (vals.length && vals.every((v) => v === "approved")) global = "approved";
  else if (vals.some((v) => v === "rejected")) global = "rejected";
  else if (vals.some((v) => v === "pending" || v === "received" || v === "approved")) global = "pending";
  await setSecret("wa_tpl_estado", global);
  return { plantillas: out, estado: global };
}

async function enviar(to: string, template: string, vars: Record<string, string>) {
  const csid = await secret(TEMPLATES[template] || "");
  if (!csid) throw new Error("Plantilla sin registrar: " + template);
  const from = await secret("twilio_whatsapp_from");
  const sid = await secret("twilio_account_sid");
  const body = new URLSearchParams({ To: "whatsapp:" + to, From: from.startsWith("whatsapp:") ? from : "whatsapp:" + from, ContentSid: csid, ContentVariables: JSON.stringify(vars) });
  const j = await twilio(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, "POST", body);
  return { sid: j.sid, status: j.status };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const internalKey = await secret("internal_key");
  if (!internalKey || req.headers.get("x-internal-key") !== internalKey) return json({ error: "No autorizado" }, 401);
  let b: { action?: string; to?: string; template?: string; vars?: Record<string, string> } = {};
  try { b = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  try {
    if (b.action === "estado") return json(await estado());
    if (b.action === "enviar") {
      if ((await secret("wa_tpl_estado")) !== "approved") return json({ error: "Plantillas sin aprobar" }, 409);
      if (!b.to || !b.template) return json({ error: "Faltan to/template" }, 400);
      return json(await enviar(b.to, b.template, b.vars || {}));
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
