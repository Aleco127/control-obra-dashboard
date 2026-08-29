# Socios registrados como proveedores (29 de agosto de 2026)

Consulta: `gastos.proveedor_id IN (proveedores "Ricardo Alejandro Corral Garcia", "Daniel Fernando Loera Sandoval")`.

**Resultado: 63 gastos entre diciembre de 2025 y junio de 2026 (Ricardo 38, Daniel 24 tras excluir el gasto migrado en 016).** Ninguno es un pago de honorarios: son compras de obra que el socio pagó con su dinero (gasolina y vueltas a Delicias y Meoqui, comida de cuadrilla, tornillos, DRO, cancelería, anuncios Meta, Telmex).

Interpretación aplicada en la migración 018: el socio no es proveedor sino **quien puso el dinero**. Cada gasto queda con `pagado_por_socio_id` y genera un movimiento `aportacion` en su cuenta corriente (la empresa le debe ese dinero hasta que se lo reembolse o se descuente en el reparto). Los dos proveedores quedan inactivos. Resultado tras la migración: Ricardo 38 aportaciones ($30,921), Daniel 24 aportaciones ($44,766) y 5 gastos personales ($8,559).

Muestra:

| id | Fecha | Pagó | Obra | Concepto | Total |
|---|---|---|---|---|---|
| 24 | 2025-12-03 | Ricardo | ICH-035 | Visita de obra meoqui | $800.00 |
| 41 | 2025-12-07 | Ricardo | 1002 | Tacos y cafe | $458.00 |
| 55 | 2025-12-10 | Daniel | ICH-035 | Pepe Loera D.R.O. | $5,000.00 |
| 95 | 2025-12-27 | Daniel | 1002 | Cancel Fact | $8,700.00 |
| 87 | 2025-12-27 | Ricardo | (indirecto) | Anuncios Meta | $1,562.54 |
| 90 | 2025-12-27 | Ricardo | DIANA | Renders y otros gastos | $5,000.00 |
| 144 | 2026-01-23 | Ricardo | ICH-035 | Gestion de Dinero | $2,980.00 |
| 262 | 2026-05-20 | Daniel | ICH-035 | Lona y cositas notas | $5,684.00 |

Reversión: `control_obra._bak_20260829_gastos` conserva el `proveedor_id` original de los 243 gastos; `_bak_20260829_proveedores` el estatus de los proveedores.
