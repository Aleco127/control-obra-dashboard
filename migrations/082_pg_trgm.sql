-- 082_pg_trgm.sql (US-803) — Extensión para la búsqueda difusa del banco de precios (buscar_insumos).
-- Va en el esquema `extensions` (no en public: el advisor marca «extension in public»). Las funciones que la usan
-- ponen `extensions` en su search_path.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
