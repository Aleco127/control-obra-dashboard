// Edge Function auth: recuperación de contraseña y verificación de correo (US-209, US-210).
// Pública (sin sesión): solicitar_recuperacion, aplicar_recuperacion, verificar_correo, enviar_verificacion.
// Nunca revela si un correo existe. Tokens hasheados en control_obra.tokens_correo (auth_crear_token / auth_consumir_token).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const FN_URL = Deno.env.get("SUPABASE_URL")! + "/functions/v1";
const APP = "https://app.supernovarquitectos.com";

async function internalKey(): Promise<string> {
  const { data } = await admin.from("app_secrets").select("value").eq("key", "internal_key").maybeSingle();
  return data?.value ?? "";
}
async function enviar(to: string, template: string, data: Record<string, unknown>, empresa_id: number | null) {
  const r = await fetch(FN_URL + "/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": await internalKey() },
    body: JSON.stringify({ to, template, data, empresa_id }),
  });
  return r.ok;
}
const GENERICO = { ok: true, mensaje: "Si el correo está registrado, en unos minutos recibirás instrucciones." };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let body: { action?: string; email?: string; token?: string; password?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const action = body.action ?? "";

  if (action === "solicitar_recuperacion" || action === "enviar_verificacion") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Escribe un correo válido" }, 400);
    const tipo = action === "solicitar_recuperacion" ? "reset" : "verificar";
    const { data, error } = await admin.rpc("auth_crear_token", { p_email: email, p_tipo: tipo, p_horas: tipo === "reset" ? 1 : 48, p_ip: ip });
    if (error) return json({ error: "No se pudo procesar la solicitud" }, 500);
    if (data?.ok) {
      const url = `${APP}/?${tipo === "reset" ? "reset" : "verificar"}=${data.token}`;
      await enviar(data.email, tipo === "reset" ? "recuperar_password" : "verificar_correo", { nombre: data.nombre, url }, data.empresa_id ?? null);
    }
    // Respuesta idéntica exista o no el correo (salvo límite, que sí se informa)
    if (data?.motivo === "limite") return json({ ok: false, error: "Ya enviamos 3 correos en la última hora. Revisa tu bandeja o intenta más tarde." }, 429);
    if (data?.motivo === "ya_verificado") return json({ ok: true, mensaje: "Ese correo ya está verificado." });
    return json(GENERICO);
  }

  if (action === "aplicar_recuperacion" || action === "verificar_correo") {
    const token = String(body.token ?? "");
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "Enlace inválido" }, 400);
    const tipo = action === "aplicar_recuperacion" ? "reset" : "verificar";
    const { data, error } = await admin.rpc("auth_consumir_token", { p_token: token, p_tipo: tipo, p_password: body.password ?? null });
    if (error) return json({ error: "No se pudo procesar la solicitud" }, 500);
    if (!data?.ok) {
      const m: Record<string, string> = { invalido: "El enlace no es válido.", usado: "Este enlace ya se usó.", expirado: "El enlace venció. Solicita uno nuevo.", password_corta: "La contraseña debe tener al menos 8 caracteres." };
      return json({ ok: false, error: m[data?.motivo] ?? "No se pudo procesar" }, 400);
    }
    return json({ ok: true, email: data.email, nombre: data.nombre });
  }

  return json({ error: "Acción desconocida" }, 400);
});
