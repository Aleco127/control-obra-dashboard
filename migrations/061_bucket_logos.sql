-- 061: el bucket `logos` sólo se escribe desde la Edge Function `subir-logo`
--
-- La app entra a Supabase como `anon` (login propio por `x-obra-token`), pero las políticas del bucket
-- daban la escritura al rol `authenticated`: la subida desde Configuración › Datos de la empresa fallaba
-- y guardaba una URL apuntando a un archivo que nunca se creó. Ahora la subida pasa por la Edge Function
-- `subir-logo`, que valida la sesión (nivel >= 80), revisa los bytes del archivo y escribe con la llave de
-- servicio, así que aquí sólo queda la lectura pública.
--
-- El bucket ya se marcó público (los logotipos son material de marca; sus URLs viven en empresas.logo_url
-- y empresas.logo_iso_url, y se pintan en el portal del cliente sin sesión).

update storage.buckets
   set public = true,
       file_size_limit = 2097152,                                              -- 2 MB, lo que promete el formulario
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'logos';

-- Nadie de esta app entra como `authenticated` (el login es propio). Dejar esas políticas permitiría a
-- cualquier usuario autenticado de otro proyecto del mismo Supabase escribir en el bucket.
drop policy if exists "Authenticated can upload logos" on storage.objects;
drop policy if exists "Authenticated can update logos" on storage.objects;
drop policy if exists "Authenticated can delete logos" on storage.objects;
drop policy if exists "Authenticated can view logos" on storage.objects;
