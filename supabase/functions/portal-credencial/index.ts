// Edge Function portal-credencial (US-854, D11 y D15): boleto de un solo uso para que el conector local de la PC
// obtenga la credencial de un portal SIN que la contraseña pase por el navegador.
//
//   emitir     cabecera x-obra-token (sesión de la app, nivel >= 80) · {portal, proposito?: 'probar'|'buscar'}
//              → {ok, boleto, expira_at, portal, usuario}. El boleto son 256 bits aleatorios (base64url); en la BD sólo
//              queda su SHA-256 (control_obra.portal_boletos, migración 112). Vive 120 s, sirve una vez, ligado a
//              empresa y portal. No se emite si el acceso no existe o está en «fallo» (409 con el mensaje).
//   canjear    cabecera x-convocatorias-secret (el secreto de ingesta que ya tiene el conector) · {boleto}
//              → {ok, usuario, password, empresa_id, portal, proposito}. Boleto usado, vencido o desconocido → 401
//              sin detalle. ÚNICO lugar donde sale la contraseña, y sólo hacia quien tiene el secreto de servidor.
//   resultado  cabecera x-convocatorias-secret · {boleto, estado: 'correcto'|'fallo', mensaje?}
//              → {ok, estado, probado_at, ultimo_error}; actualiza empresa_portales. Boleto sin canjear o ya
//              informado → 401.
//
// Nunca registra cuerpos ni credenciales en la bitácora. Una petición con sesión de usuario jamás recibe la contraseña.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const NO_AUT = () => json({ ok: false, error: "No autorizado" }, 401);
// Portales con inicio de sesión automatizado en el conector (por ahora sólo ComprasMX).
const PORTALES_LOGIN = new Set(["comprasmx"]);
const BOLETO_RE = /^[A-Za-z0-9_-]{43}$/;

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function base64url(bytes: Uint8Array) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function servidor(req: Request) {
  const cs = req.headers.get("x-convocatorias-secret") ?? "";
  if (cs.length < 32) return false;
  const { data } = await admin.from("app_secrets").select("value").eq("key", "convocatorias_ingesta_sha256").maybeSingle();
  const h = data?.value ?? "";
  return !!h && igual(await sha256Hex(cs), h);
}
async function sesion(t: string) {
  if (!t) return null;
  const { data } = await admin.rpc("validar_sesion", { p_token: t });
  return data && data.length ? data[0] as { user_id: string; empresa_id: number; nivel_acceso: number } : null;
}
const co = () => admin.schema("control_obra");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "JSON inválido" }, 400); }

  if (b.accion === "emitir") {
    const s = await sesion(req.headers.get("x-obra-token") ?? "");
    if (!s) return json({ ok: false, error: "Tu sesión expiró. Entra otra vez." }, 401);
    if (Number(s.nivel_acceso) < 80) return json({ ok: false, error: "Sólo un administrador o un gerente de obra puede usar el acceso a los portales." }, 403);
    const portal = String(b.portal ?? "");
    if (!PORTALES_LOGIN.has(portal)) return json({ ok: false, error: "Ese portal no admite inicio de sesión desde el conector." }, 400);
    const proposito = b.proposito === "buscar" ? "buscar" : "probar";
    const boleto = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const { data, error } = await co().rpc("portal_boleto_emitir", {
      p_empresa: s.empresa_id, p_portal: portal, p_user: s.user_id, p_sha256: await sha256Hex(boleto), p_proposito: proposito });
    if (error) {
      const c = (error as { code?: string }).code;
      const st = c === "P0002" ? 404 : c === "55000" || c === "55006" ? 409 : c === "54000" ? 429 : 500;
      return json({ ok: false, error: st === 500 ? "No se pudo preparar el acceso." : error.message, codigo: c }, st);
    }
    const d = data as { expira_at: string; portal: string; usuario: string };
    return json({ ok: true, boleto, expira_at: d.expira_at, portal: d.portal, usuario: d.usuario });
  }

  if (b.accion === "canjear" || b.accion === "resultado") {
    if (!(await servidor(req))) return NO_AUT();
    const boleto = String(b.boleto ?? "");
    if (!BOLETO_RE.test(boleto)) return NO_AUT();
    const h = await sha256Hex(boleto);
    if (b.accion === "canjear") {
      const { data, error } = await co().rpc("portal_boleto_canjear", { p_sha256: h });
      if (error) return json({ ok: false, error: "No se pudo leer el acceso." }, 500);
      const d = data as { usuario?: string; password?: string; empresa_id?: number; portal?: string; proposito?: string } | null;
      if (!d || !d.usuario || !d.password) return NO_AUT();
      return json({ ok: true, usuario: d.usuario, password: d.password, empresa_id: d.empresa_id, portal: d.portal, proposito: d.proposito });
    }
    const estado = String(b.estado ?? "");
    if (estado !== "correcto" && estado !== "fallo") return json({ ok: false, error: "estado: correcto o fallo" }, 400);
    const mensaje = b.mensaje == null ? null : String(b.mensaje).slice(0, 500);
    const { data, error } = await co().rpc("portal_boleto_resultado", { p_sha256: h, p_estado: estado, p_mensaje: mensaje });
    if (error) return json({ ok: false, error: "No se pudo guardar el resultado." }, 500);
    if (!data) return NO_AUT();
    const d = data as { estado: string; probado_at: string; ultimo_error: string | null };
    return json({ ok: true, estado: d.estado, probado_at: d.probado_at, ultimo_error: d.ultimo_error });
  }
  return json({ ok: false, error: "acción no válida" }, 400);
});
