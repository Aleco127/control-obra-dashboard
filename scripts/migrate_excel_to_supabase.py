import pandas as pd
from datetime import datetime
import json

# Ruta del archivo Excel optimizado
archivo = r'C:\Users\aleja\OneDrive\Desktop\Control de Gastos SUPERNOVA - OPTIMIZADO.xlsx'

print("Leyendo archivo Excel optimizado...")
xl = pd.ExcelFile(archivo)

# ============================================
# LEER DATOS
# ============================================

# Catálogo de Obras
df_obras = pd.read_excel(xl, sheet_name='Catálogo_Obras')
print(f"Obras: {len(df_obras)} registros")

# Catálogo de Empleados
df_empleados = pd.read_excel(xl, sheet_name='Catálogo_Empleados')
print(f"Empleados: {len(df_empleados)} registros")

# Catálogo de Proveedores
df_proveedores = pd.read_excel(xl, sheet_name='Catálogo_Proveedores')
print(f"Proveedores: {len(df_proveedores)} registros")

# Gastos
df_gastos = pd.read_excel(xl, sheet_name='Gastos')
print(f"Gastos: {len(df_gastos)} registros")

# Nómina
df_nomina = pd.read_excel(xl, sheet_name='Nómina')
print(f"Nómina: {len(df_nomina)} registros")

# ============================================
# GENERAR SQL DE INSERCIÓN
# ============================================

sql_statements = []

# Obras
print("\nGenerando SQL para Obras...")
for _, row in df_obras.iterrows():
    codigo = int(row.get('Código Obra', row.get('Código_Obra', 1)))
    nombre = str(row.get('Nombre Obra', row.get('Nombre_Obra', ''))).replace("'", "''")
    presupuesto = float(row.get('Presupuesto Total', row.get('Presupuesto_Total', 0)) or 0)
    estatus = str(row.get('Estatus', 'Activa')).replace("'", "''")
    fecha_inicio = row.get('Fecha Inicio', row.get('Fecha_Inicio', None))
    responsable = str(row.get('Responsable', '')).replace("'", "''")

    fecha_str = 'NULL'
    if pd.notna(fecha_inicio):
        if isinstance(fecha_inicio, str):
            fecha_str = f"'{fecha_inicio}'"
        else:
            fecha_str = f"'{fecha_inicio}'"

    sql = f"""INSERT INTO public.obras (codigo_obra, nombre_obra, presupuesto_total, estatus, fecha_inicio, responsable)
VALUES ({codigo}, '{nombre}', {presupuesto}, '{estatus}', {fecha_str}, '{responsable}') ON CONFLICT (codigo_obra) DO NOTHING;"""
    sql_statements.append(sql)

# Empleados
print("Generando SQL para Empleados...")
for _, row in df_empleados.iterrows():
    nombre = str(row.get('Nombre Completo', row.get('Nombre_Completo', ''))).replace("'", "''")
    puesto = str(row.get('Puesto', '')).replace("'", "''")
    estatus = str(row.get('Estatus', 'Activo')).replace("'", "''")

    if nombre and nombre != 'nan':
        sql = f"""INSERT INTO public.empleados (nombre_completo, puesto, estatus)
VALUES ('{nombre}', '{puesto}', '{estatus}');"""
        sql_statements.append(sql)

# Proveedores
print("Generando SQL para Proveedores...")
for _, row in df_proveedores.iterrows():
    nombre = str(row.get('Nombre Proveedor', row.get('Nombre_Proveedor', ''))).replace("'", "''")
    rfc = str(row.get('RFC', '')).replace("'", "''") if pd.notna(row.get('RFC')) else ''
    contacto = str(row.get('Contacto', '')).replace("'", "''") if pd.notna(row.get('Contacto')) else ''
    telefono = str(row.get('Teléfono', row.get('Telefono', ''))).replace("'", "''") if pd.notna(row.get('Teléfono', row.get('Telefono'))) else ''
    tipo = str(row.get('Tipo', 'Proveedor')).replace("'", "''")

    if nombre and nombre != 'nan':
        sql = f"""INSERT INTO public.proveedores (nombre_proveedor, rfc, contacto, telefono, tipo)
VALUES ('{nombre}', '{rfc}', '{contacto}', '{telefono}', '{tipo}');"""
        sql_statements.append(sql)

# Gastos (solo una muestra para no sobrecargar)
print("Generando SQL para Gastos...")
gastos_count = 0
for _, row in df_gastos.head(50).iterrows():
    try:
        codigo_obra = int(row.get('Código Obra', row.get('Código_Obra', 1)) or 1)
        fecha = row.get('Fecha Solicitud', row.get('Fecha_Solicitud', None))
        orden_compra = str(row.get('Orden Compra', row.get('Orden_Compra', ''))).replace("'", "''")
        estatus_pago = str(row.get('Estatus Pago', row.get('Estatus_Pago', 'Pendiente'))).replace("'", "''")

        # Normalizar estatus
        if 'pagado' in estatus_pago.lower():
            estatus_pago = 'Pagado'
        elif 'cancelad' in estatus_pago.lower():
            estatus_pago = 'Cancelado'
        else:
            estatus_pago = 'Pendiente'

        monto = float(row.get('Monto Neto', row.get('Monto_Neto', 0)) or 0)
        solicitante = str(row.get('Solicitante', '')).replace("'", "''")
        comentarios = str(row.get('Comentarios', '')).replace("'", "''") if pd.notna(row.get('Comentarios')) else ''

        estatus_entrega = str(row.get('Estatus Entrega', row.get('Estatus_Entrega', 'Pendiente'))).replace("'", "''")
        if 'entregado' in estatus_entrega.lower():
            estatus_entrega = 'Entregado'
        elif 'cancelad' in estatus_entrega.lower():
            estatus_entrega = 'Cancelado'
        else:
            estatus_entrega = 'Pendiente'

        fecha_str = 'CURRENT_DATE'
        if pd.notna(fecha):
            if isinstance(fecha, str):
                fecha_str = f"'{fecha}'"
            else:
                fecha_str = f"'{fecha.strftime('%Y-%m-%d')}'" if hasattr(fecha, 'strftime') else f"'{fecha}'"

        if monto > 0:
            sql = f"""INSERT INTO public.gastos (obra_id, fecha_solicitud, orden_compra, estatus_pago, monto_neto, solicitante, comentarios, estatus_entrega)
VALUES ((SELECT id FROM public.obras WHERE codigo_obra = {codigo_obra} LIMIT 1), {fecha_str}, '{orden_compra}', '{estatus_pago}', {monto}, '{solicitante}', '{comentarios}', '{estatus_entrega}');"""
            sql_statements.append(sql)
            gastos_count += 1
    except Exception as e:
        print(f"Error en gasto: {e}")
        continue

print(f"  Gastos generados: {gastos_count}")

# Nómina (solo una muestra)
print("Generando SQL para Nómina...")
nomina_count = 0
for _, row in df_nomina.head(30).iterrows():
    try:
        nombre = str(row.get('Nombre Empleado', row.get('Nombre_Empleado', ''))).replace("'", "''")
        periodo = str(row.get('Período', row.get('Periodo', '')))
        sueldo = float(row.get('Sueldo Base', row.get('Sueldo_Base', 0)) or 0)
        viaticos = float(row.get('Viáticos', row.get('Viaticos', 0)) or 0)
        nomina_total = float(row.get('Nómina Total', row.get('Nomina_Total', 0)) or 0)
        dias = int(row.get('Días Laborados', row.get('Dias_Laborados', 0)) or 0)
        descuentos = float(row.get('Descuentos', 0) or 0)
        total_pagar = float(row.get('Total Pagar', row.get('Total_Pagar', 0)) or 0)

        if nombre and nombre != 'nan' and sueldo > 0:
            sql = f"""INSERT INTO public.nomina (empleado_id, periodo_inicio, periodo_fin, sueldo_base, viaticos, nomina_total, dias_laborados, descuentos, total_pagar, estatus)
VALUES ((SELECT id FROM public.empleados WHERE nombre_completo LIKE '%{nombre[:20]}%' LIMIT 1), '2022-01-01', '2022-01-07', {sueldo}, {viaticos}, {nomina_total}, {dias}, {descuentos}, {total_pagar}, 'Pagado');"""
            sql_statements.append(sql)
            nomina_count += 1
    except Exception as e:
        print(f"Error en nómina: {e}")
        continue

print(f"  Nómina generados: {nomina_count}")

# Guardar SQL
output_file = r'C:\Users\aleja\iCloudDrive\Claude_projects\insert_data.sql'
with open(output_file, 'w', encoding='utf-8') as f:
    f.write('\n'.join(sql_statements))

print(f"\n{'='*60}")
print(f"SQL generado: {output_file}")
print(f"Total de statements: {len(sql_statements)}")
print(f"{'='*60}")

# Imprimir primeros statements para verificar
print("\nPrimeros 5 statements:")
for stmt in sql_statements[:5]:
    print(stmt[:200] + "...")
