// Edge Function convocatorias-documentos (US-848): documentos públicos de UNA convocatoria de Contrataciones Chihuahua.
//
// D14: nada se descarga a volumen. La app la llama sólo para la convocatoria que el usuario marcó «Me interesa» o en
// la que pulsó «Descargar documentos» / «Buscar documentos nuevos», un archivo a la vez y con pausas. El portal no
// manda cabeceras CORS, por eso el navegador no puede bajar los enlaces directo: esta función hace de paso y entrega
// el archivo tal cual; la APP lo sube al bucket `licitaciones` con su sesión (aquí no se guarda nada en el bucket).
//
// Cabecera x-obra-token (sesión de la app, nivel >= 80). POST {accion, convocatoria_id, ...}:
//   lista    {convocatoria_id}       → lee el detalle público /licitaciones/<id>/ (UNA petición), guarda la lista de
//                                       documentos en la convocatoria y responde {ok, documentos: [{id, tipo, fecha}]}
//   archivo  {convocatoria_id, id}   → baja ESE documento (el enlace se toma de la BD, nunca del cuerpo: sin SSRF) y
//                                       lo entrega: 200 con el binario y X-Archivo-Nombre (URI-encoded), o JSON de error.
//                                       Tope 50 MB (límite del bucket): más grande → 413 con el mensaje.
// Sólo lectura sobre el portal; sin reintentos.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { BASE, MAX_BYTES, conIds, nombreArchivo, parseDocumentos, urlPermitida } from "./documentos.mjs";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Archivo-Nombre, X-Archivo-Tipo, Content-Length, Content-Type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 ControlDeObra-Convocatorias/1.0";

async function sesion(t: string) {
  const { data } = await admin.rpc("validar_sesion", { p_token: t });
  return data && data.length ? data[0] as { user_id: string; empresa_id: number; nivel_acceso: number } : null;
}
async function pedir(url: string, ms: number) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9", Referer: BASE + "/" } });
  } finally { clearTimeout(t); }
}
type Conv = { id: number; fuente: string; url_detalle: string | null; documentos: Array<{ tipo: string; fecha: string; url: string }> };
async function convocatoria(id: number): Promise<Conv | null> {
  const { data, error } = await admin.rpc("convocatoria_para_documentos", { p_id: id });
  if (error) throw new Error(error.message);
  return data as Conv | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const s = await sesion(req.headers.get("x-obra-token") ?? "");
  if (!s) return json({ ok: false, error: "Tu sesión expiró. Entra otra vez." }, 401);
  if (Number(s.nivel_acceso) < 80) return json({ ok: false, error: "Sólo un administrador o un gerente de obra puede bajar documentos." }, 403);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "JSON inválido" }, 400); }
  const id = Number(b.convocatoria_id);
  if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "convocatoria_id requerido" }, 400);
  let c: Conv | null;
  try { c = await convocatoria(id); } catch (e) { return json({ ok: false, error: (e as Error).message }, 500); }
  if (!c) return json({ ok: false, error: "La convocatoria no existe." }, 404);
  if (c.fuente !== "chihuahua") return json({ ok: false, error: "Esta función sólo baja documentos de Contrataciones Chihuahua (los de ComprasMX los baja el conector de tu computadora)." }, 400);

  if (b.accion === "lista") {
    const url = String(c.url_detalle || "");
    if (!url.startsWith(BASE + "/licitaciones/")) return json({ ok: false, error: "La convocatoria no tiene una página de detalle válida." }, 400);
    try {
      const r = await pedir(url, 30000);
      if (!r.ok) return json({ ok: false, error: `El portal respondió ${r.status} al abrir el detalle.` }, 502);
      const docs = conIds(parseDocumentos(await r.text())).filter((d) => urlPermitida(d.url));
      await admin.rpc("convocatoria_documentos_actualizar", { p_id: id, p_documentos: docs.map(({ tipo, fecha, url }) => ({ tipo, fecha, url })) });
      return json({ ok: true, documentos: docs.map(({ id: did, tipo, fecha }) => ({ id: did, tipo, fecha })) });
    } catch (e) {
      return json({ ok: false, error: (e as Error).name === "AbortError" ? "El portal tardó demasiado en responder." : (e as Error).message }, 502);
    }
  }

  if (b.accion === "archivo") {
    const did = String(b.id ?? "");
    const doc = conIds(c.documentos || []).find((d) => d.id === did);
    if (!doc) return json({ ok: false, error: "Ese documento ya no está en el detalle: vuelve a pedir la lista." }, 404);
    if (!urlPermitida(doc.url)) return json({ ok: false, error: "Enlace no permitido." }, 400);
    let r: Response;
    try { r = await pedir(doc.url, 120000); } catch (e) {
      return json({ ok: false, error: (e as Error).name === "AbortError" ? "El portal tardó demasiado en entregar el archivo." : (e as Error).message }, 502);
    }
    if (!r.ok || !r.body) return json({ ok: false, error: `El portal respondió ${r.status} al bajar «${doc.tipo}».` }, 502);
    const tipo = (r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    if (tipo.startsWith("text/html")) return json({ ok: false, error: `El portal no entregó el archivo de «${doc.tipo}» (respondió una página).` }, 502);
    const largo = Number(r.headers.get("content-length") || 0);
    if (largo > MAX_BYTES) {
      try { await r.body.cancel(); } catch { /* nada */ }
      return json({ ok: false, error: `«${doc.tipo}» pesa ${(largo / 1048576).toFixed(1)} MB: más de 50 MB, bájalo del portal.`, demasiado_grande: true, tamano: largo }, 413);
    }
    // Se pasa el cuerpo tal cual (sin cargarlo en memoria); si no trae largo, se corta al pasar de 50 MB.
    let n = 0;
    const corte = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) { n += chunk.byteLength; if (n > MAX_BYTES) ctl.error(new Error("más de 50 MB")); else ctl.enqueue(chunk); },
    });
    const nombre = nombreArchivo(doc.tipo, doc.fecha, r.headers.get("content-disposition"), tipo);
    return new Response(r.body.pipeThrough(corte), { status: 200, headers: {
      ...CORS, "Content-Type": tipo, ...(largo ? { "Content-Length": String(largo) } : {}),
      "X-Archivo-Nombre": encodeURIComponent(nombre), "X-Archivo-Tipo": encodeURIComponent(doc.tipo || ""), "Cache-Control": "no-store" } });
  }
  return json({ ok: false, error: "acción no válida" }, 400);
});
