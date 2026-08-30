// Edge Function jobs: tareas diarias de la plataforma. La invoca n8n (cron) con x-internal-key.
// Acciones: bajas (recordatorio a los 23 días y eliminación al vencer), all.
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const internalKey = await secret("internal_key");
  if (!internalKey || req.headers.get("x-internal-key") !== internalKey) return json({ error: "No autorizado" }, 401);
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const action = body.action ?? "all";
  const result: Record<string, unknown> = { action, at: new Date().toISOString() };
  if (action === "bajas" || action === "all") result.bajas = await jobBajas(internalKey);
  return json(result);
});
