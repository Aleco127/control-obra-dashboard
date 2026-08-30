// Edge Function jobs: tareas diarias de la plataforma. La invoca n8n (cron 8:00 America/Chihuahua) con x-internal-key.
// Acciones: bajas (recordatorio y eliminación), suscripciones (estados + correos de la prueba), all.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const FN_URL = Deno.env.get("SUPABASE_URL")! + "/functions/v1";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function secret(key: string): Promise<string> {
  const { data } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? "";
}
async function enviar(internalKey: string, to: string, template: string, data: Record<string, unknown>, empresa_id: number) {
  const r = await fetch(FN_URL + "/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
    body: JSON.stringify({ to, template, data, empresa_id }),
  });
  return r.ok;
}
// Evita repetir una plantilla a la misma empresa
async function yaEnviado(empresa_id: number, template: string): Promise<boolean> {
  const { count } = await admin.from("email_log").select("id", { count: "exact", head: true }).eq("empresa_id", empresa_id).eq("template", template).eq("status", "enviado");
  return (count ?? 0) > 0;
}
const fmtFecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Chihuahua" });

async function jobBajas(internalKey: string) {
  const out: Record<string, unknown>[] = [];
  const { data, error } = await admin.rpc("bajas_pendientes");
  if (error) return [{ error: error.message }];
  const now = Date.now();
  for (const b of data ?? []) {
    const vence = new Date(b.baja_programada_at).getTime();
    const dias = Math.ceil((vence - now) / 86400000);
    if (vence <= now) {
      const { data: r, error: e } = await admin.rpc("eliminar_empresa_definitivo", { p_empresa_id: b.empresa_id });
      out.push({ empresa: b.nombre, accion: "eliminada", resultado: e ? e.message : r });
    } else if (dias <= 7 && !b.baja_recordatorio_at && b.admin_email) {
      const ok = await enviar(internalKey, b.admin_email, "baja_recordatorio", { nombre: b.admin_nombre, empresa: b.nombre, fecha: fmtFecha(b.baja_programada_at) }, b.empresa_id);
      if (ok) await admin.rpc("marcar_baja_recordatorio", { p_empresa_id: b.empresa_id });
      out.push({ empresa: b.nombre, accion: "recordatorio", enviado: ok });
    } else {
      out.push({ empresa: b.nombre, accion: "espera", dias });
    }
  }
  return out;
}

async function jobSuscripciones(internalKey: string) {
  const out: Record<string, unknown> = {};
  const { data: est, error: e1 } = await admin.rpc("actualizar_estados_suscripcion");
  out.estados = e1 ? e1.message : est;
  const { data: subs, error } = await admin.rpc("suscripciones_para_correos");
  if (error) { out.correos = error.message; return out; }
  const enviados: Record<string, unknown>[] = [];
  for (const s of subs ?? []) {
    if (!s.admin_email) continue;
    const d = s.dias_desde_registro ?? 0;
    const base = { nombre: s.admin_nombre, empresa: s.empresa, fecha: s.trial_ends_at ? fmtFecha(s.trial_ends_at) : "" };
    const candidatos: Array<[string, boolean]> = [
      ["prueba_dia3", s.estado === "trial" && d >= 3],
      ["prueba_dia7", s.estado === "trial" && d >= 7],
      ["prueba_dia25", s.estado === "trial" && d >= 25],
      ["notificacion", s.estado === "vencida"],
    ];
    for (const [tpl, aplica] of candidatos) {
      if (!aplica) continue;
      const clave = tpl === "notificacion" ? "prueba_vencida" : tpl;
      if (await yaEnviado(s.empresa_id, clave)) continue;
      const data = tpl === "notificacion"
        ? { subject: "Tu prueba terminó: elige un plan", titulo: "Tu prueba terminó", cuerpo: `<p>Hola ${s.admin_nombre}. La prueba de <strong>${s.empresa}</strong> terminó. Tienes hasta el <strong>${fmtFecha(s.gracia_hasta)}</strong> para elegir un plan; después la cuenta pasa a modo lectura (tus datos se conservan).</p>`, url: "https://app.supernovarquitectos.com/?m=z", cta: "Elegir plan", ...base }
        : base;
      const ok = await enviar(internalKey, s.admin_email, tpl, data, s.empresa_id);
      if (ok && tpl === "notificacion") await admin.from("email_log").insert({ empresa_id: s.empresa_id, to_email: s.admin_email, template: "prueba_vencida", subject: "marca", status: "enviado" });
      enviados.push({ empresa: s.empresa, plantilla: clave, ok });
      break; // una plantilla por día por empresa
    }
  }
  out.correos = enviados;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const internalKey = await secret("internal_key");
  if (!internalKey || req.headers.get("x-internal-key") !== internalKey) return json({ error: "No autorizado" }, 401);
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const action = body.action ?? "all";
  const result: Record<string, unknown> = { action, at: new Date().toISOString() };
  if (action === "bajas" || action === "all") result.bajas = await jobBajas(internalKey);
  if (action === "suscripciones" || action === "all") result.suscripciones = await jobSuscripciones(internalKey);
  return json(result);
});
