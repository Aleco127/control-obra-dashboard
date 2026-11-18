-- 075 · Bucket de fotos privado (17-nov-2026)
-- Con el bucket público, quien tuviera la URL de una foto la veía sin sesión. Ahora sólo se sirven con enlace firmado:
--   · la app los pide con su sesión (política de lectura por empresa de la migración 071) — FotoUrl en index.html;
--   · el portal del cliente los pide a la función de borde portal-archivo ({fotos:true, obra_id}), que valida el acceso.
-- fotos_obra.url_foto conserva la forma /storage/v1/object/public/fotos/<ruta>: de ahí se saca la ruta a firmar.
UPDATE storage.buckets SET public = false WHERE id = 'fotos';
