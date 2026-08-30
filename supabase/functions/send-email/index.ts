// Edge Function send-email: envía correos transaccionales de Control de Obra por Resend.
// Autenticación (una de dos):
//   - x-obra-token: sesión válida de la app (validar_sesion); sólo puede mandar a correos de su empresa o al propio.
//   - x-internal-key: llave interna (app_secrets.internal_key) para jobs (n8n) y otras Edge Functions.
// Secretos: public.app_secrets (sólo service_role). Bitácora: public.email_log.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { TEMPLATES, esc } from "./templates.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function secrets(keys: string[]): Promise<Record<string, string>> {
  const { data, error } = await admin.from("app_secrets").select("key,value").in("key", keys);
  if (error) throw new Error("app_secrets: " + error.message);
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

type Session = { user_id: string; nombre: string; empresa_id: number; empresa_nombre: string; nivel_acceso: number } | null;

async function sessionFromToken(token: string): Promise<Session> {
  if (!token) return null;
  const { data, error } = await admin.rpc("validar_sesion", { p_token: token });
  if (error || !data || !data.length) return null;
  return data[0];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body: { to?: string; template?: string; data?: Record<string, unknown>; empresa_id?: number; usuario_id?: string; unsubscribe_url?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const to = String(body.to ?? "").trim().toLowerCase();
  const template = String(body.template ?? "generico");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: "Correo destino inválido" }, 400);
  const tpl = TEMPLATES[template];
  if (!tpl) return json({ error: "Plantilla desconocida: " + template }, 400);

  // Autenticación
  const sec = await secrets(["internal_key", "resend_api_key", "email_from"]);
  const internal = req.headers.get("x-internal-key") ?? "";
  let session: Session = null;
  let modo = "";
  if (internal && sec.internal_key && internal === sec.internal_key) {
    modo = "internal";
  } else {
    session = await sessionFromToken(req.headers.get("x-obra-token") ?? "");
    if (!session) return json({ error: "No autorizado" }, 401);
    modo = "sesion";
    // Un usuario sólo manda a correos de su empresa o al suyo; plantillas de plataforma quedan reservadas
    if (["recuperar_password", "verificar_correo", "cobro_fallido", "baja_recordatorio"].includes(template)) {
      return json({ error: "Plantilla reservada a la plataforma" }, 403);
    }
    const { data: u } = await admin.from("obra_usuarios").select("id").eq("empresa_id", session.empresa_id).eq("email", to).maybeSingle();
    const { data: c } = await admin.from("clientes").select("id").eq("empresa_id", session.empresa_id).eq("email", to).maybeSingle();
    if (!u && !c) return json({ error: "Sólo puedes enviar a usuarios o clientes de tu empresa" }, 403);
  }

  if (!sec.resend_api_key) return json({ error: "Resend no configurado (app_secrets.resend_api_key)" }, 500);

  // Datos escapados para HTML (las URLs se dejan tal cual pero validadas)
  const raw = body.data ?? {};
  const d: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    d[k] = k === "url" || k === "cuerpo" ? String(v ?? "") : esc(v);
  }
  if (d.url && !/^https:\/\/(app\.supernovarquitectos\.com|obra\.srv1090924\.hstgr\.cloud)\//.test(d.url)) {
    return json({ error: "URL fuera del dominio de la app" }, 400);
  }
  if (session && !d.empresa) d.empresa = session.empresa_nombre ?? "";
  const msg = tpl(d);
  const unsub = body.unsubscribe_url ? `<br><a href="${esc(body.unsubscribe_url)}" style="color:#64748b">Dejar de recibir estos correos</a>` : "";
  const html = msg.html.replace("{{UNSUB}}", unsub);
  const from = sec.email_from || "Control de Obra <noreply@zook.mx>";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${sec.resend_api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: msg.subject, html, text: msg.text, reply_to: "soporte@supernovarquitectos.com" }),
  });
  const rj = await r.json().catch(() => ({}));
  const ok = r.ok && rj.id;
  await admin.from("email_log").insert({
    empresa_id: body.empresa_id ?? session?.empresa_id ?? null,
    usuario_id: body.usuario_id ?? session?.user_id ?? null,
    to_email: to, template, subject: msg.subject,
    provider_id: ok ? rj.id : null,
    status: ok ? "enviado" : "error",
    error: ok ? null : JSON.stringify(rj).slice(0, 500),
  });
  if (!ok) return json({ error: "Resend rechazó el envío", detail: rj }, 502);
  return json({ ok: true, id: rj.id, modo });
});
