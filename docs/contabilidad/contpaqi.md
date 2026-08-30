# Pólizas para CONTPAQi Contabilidad y Aspel COI

Control de Obra genera en **Contabilidad › Cierres › Descargar pólizas** dos archivos por mes:

| Archivo | Para qué sirve |
|---|---|
| `polizas_AAAA-MM.xlsx` | Hoja "Pólizas" con una fila por movimiento (Fecha, Tipo, Número, Concepto póliza, Cuenta, Nombre cuenta, Cargo, Abono, Referencia, UUID, Concepto movimiento) y hoja "Resumen". Es la plantilla para **Aspel COI** (Hoja de cálculo › Importar pólizas) y para revisar en Excel. |
| `polizas_AAAA-MM_contpaqi.txt` | Formato ASCII de carga de pólizas de **CONTPAQi Contabilidad** (Pólizas › Cargar pólizas). |

Las cuentas salen del catálogo de **Configuración › Contabilidad** (`cuentas_contables`, migración 044). Si falta una cuenta, la app avisa qué rol falta y deja la cuenta vacía en el archivo para que se capture antes de importar.

## Cómo se arman las pólizas

| Origen | Tipo | Cargo | Abono |
|---|---|---|---|
| Cobro registrado (`pagos_recibidos`) | 1 Ingresos | Bancos (o Caja si el método es efectivo) | Clientes |
| Aportación de socio | 1 Ingresos | Bancos | Aportaciones de socios |
| Pago a proveedor (`pagos_proveedores`) | 2 Egresos | Proveedores | Bancos / Caja |
| Nómina pagada (`nomina`) | 2 Egresos | Sueldos y salarios | Bancos |
| Retiro, gasto personal o utilidad pagada a socio | 2 Egresos | Retiros de socios | Bancos |
| Factura emitida (`cfdis_emitidos`) | 3 Diario | Clientes (total) | Ingresos (subtotal) e IVA trasladado |
| Gasto devengado (`gastos`, excepto destino socio) | 3 Diario | Costo de obra por categoría (o indirectos) e IVA acreditable si está facturado | Proveedores; si lo pagó un socio, Aportaciones de socios |

Los gastos sin factura se registran sin IVA acreditable (el total va al costo). Los gastos con destino "socio" no generan póliza (no son de la empresa).

## Formato del TXT (CONTPAQi)

Una línea `P` por póliza y una línea `M` por movimiento; después de un movimiento con UUID se agrega una línea `CFDI` con el folio fiscal. Los campos van separados por dos espacios y con ancho fijo:

```
P  AAAAMMDD  T  NNNNNN  C  Concepto (100)  S  I  A
M  Cuenta (20)  Referencia (10)  D  Importe (20, 2 decimales)  Diario (5)  Concepto (100)
CFDI  UUID
```

- `T`: 1 ingresos, 2 egresos, 3 diario. `NNNNNN`: consecutivo por tipo dentro del mes. `C` (clase): 0. `S I A` (sistema origen, impresa, ajuste): 0 0 0.
- `D`: 0 cargo, 1 abono. El importe siempre es positivo.
- Codificación Windows-1252 y fin de línea CRLF, que es lo que espera CONTPAQi.

**Pendiente de validar con el contador de Supernova** en un mes real (US-241, criterio 4): la posición exacta de las columnas puede variar según la versión de CONTPAQi; si la carga rechaza el archivo, ajustar `Contabilidad.contpaqi()` en `src/js/contabilidad.js` y anotar la versión en `docs/contabilidad/validacion.md`.
