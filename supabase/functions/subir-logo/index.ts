// Edge Function subir-logo: guarda el logotipo de la empresa en el bucket `logos`.
//
// La app entra a Supabase como `anon` (el login es propio, por `x-obra-token`), y las políticas de
// storage.objects sólo dejan escribir al rol `authenticated`: por eso la subida desde Configuración
// fallaba en silencio y quedaba una URL apuntando a un archivo que nunca se creó. Aquí la sesión se
// valida con `validar_sesion` y la escritura la hace la llave de servicio.
//
// POST multipart/form-data, cabecera x-obra-token:
//   archivo  (File)                 el logotipo; sin él la acción es borrar
//   slot     'logo' | 'iso'         'logo' = logotipo completo (PDF y recibos) → empresas.logo_url
//                                   'iso'  = versión cuadrada (barras)          → empresas.logo_iso_url
// Responde { ok, slot, url } o { ok:false, error }.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const BUCKET = "logos";
const MAX = 2 * 1024 * 1024;                       // 2 MB, lo que promete el formulario
const NIVEL_MINIMO = 80;                           // el mismo que muestra el botón «Editar» en Configuración
const COLUMNA = { logo: "logo_url", iso: "logo_iso_url" } as const;

type Sesion = { user_id: string; nombre: string; email: string; empresa_id: number; nivel_acceso: number };
async function sesion(req: Request): Promise<Sesion | null> {
  const t = req.headers.get("x-obra-token") ?? "";
  if (!t) return null;
  const { data } = await admin.rpc("validar_sesion", { p_token: t });
  return data && data.length ? data[0] : null;
}

// El tipo se decide por los bytes, no por lo que diga el navegador.
function tipoReal(b: Uint8Array): { ext: string; mime: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

// Ruta dentro del bucket de una URL pública nuestra (para borrar el archivo que se reemplaza).
function rutaDeUrl(url: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(new RegExp(`/storage/v1/object/public/${BUCKET}/(.+)$`));
  return m ? decodeURIComponent(m[1].split("?")[0]) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const s = await sesion(req);
  if (!s) return json({ ok: false, error: "Tu sesión expiró. Entra otra vez." }, 401);
  if (Number(s.nivel_acceso) < NIVEL_MINIMO) return json({ ok: false, error: "No tienes permiso para cambiar el logotipo." }, 403);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ ok: false, error: "No se recibió el archivo." }, 400); }

  const slot = String(form.get("slot") ?? "logo") === "iso" ? "iso" : "logo";
  const columna = COLUMNA[slot];

  const { data: emp } = await admin.schema("control_obra").from("empresas").select("logo_url,logo_iso_url").eq("id", s.empresa_id).maybeSingle();
  const anterior = rutaDeUrl((emp?.[columna] as string) ?? null);

  const archivo = form.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    // Sin archivo: quitar el logotipo
    await admin.schema("control_obra").from("empresas").update({ [columna]: null }).eq("id", s.empresa_id);
    if (anterior) await admin.storage.from(BUCKET).remove([anterior]);
    return json({ ok: true, slot, url: null });
  }
  if (archivo.size > MAX) return json({ ok: false, error: "El archivo pesa más de 2 MB. Guárdalo más chico e inténtalo de nuevo." }, 413);

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const tipo = tipoReal(bytes);
  if (!tipo) return json({ ok: false, error: "El archivo no es una imagen PNG, JPG o WEBP." }, 415);

  const ruta = `empresa_${s.empresa_id}/${slot}-${Date.now()}.${tipo.ext}`;
  const { error: errSubida } = await admin.storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo.mime, upsert: false, cacheControl: "3600" });
  if (errSubida) return json({ ok: false, error: "No se pudo guardar el logotipo. Inténtalo de nuevo." }, 500);

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(ruta);
  const url = pub.publicUrl;

  const { error: errBase } = await admin.schema("control_obra").from("empresas").update({ [columna]: url }).eq("id", s.empresa_id);
  if (errBase) {
    await admin.storage.from(BUCKET).remove([ruta]);          // no dejar el archivo huérfano
    return json({ ok: false, error: "No se pudo guardar el logotipo. Inténtalo de nuevo." }, 500);
  }
  if (anterior && anterior !== ruta) await admin.storage.from(BUCKET).remove([anterior]);
  return json({ ok: true, slot, url });
});
