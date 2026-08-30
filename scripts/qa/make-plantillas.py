# Genera docs/plantillas/opus-ejemplo.xlsx y neodata-ejemplo.xlsx (US-242) con la estructura de los exportados
# a Excel de OPUS y Neodata (partidas sin cantidad, conceptos con clave, unidad, cantidad, precio e importe),
# y los CSV equivalentes en scripts/qa/fixtures para la prueba de node.
import csv, io, os
from openpyxl import Workbook
from openpyxl.styles import Font
R = os.path.join(os.path.dirname(__file__), '..', '..')
os.makedirs(os.path.join(R, 'docs', 'plantillas'), exist_ok=True)
os.makedirs(os.path.join(R, 'scripts', 'qa', 'fixtures'), exist_ok=True)

# Datos: casa habitación (tomados de la cotización OPUS de Supernova para David Juárez, redondeados)
DATA = [
    ('A', 'PRELIMINARES', '', None, None),
    ('A.01', 'Limpieza y trazo del terreno con equipo topográfico', 'm2', 800.00, 18.50),
    ('A.02', 'Excavación a mano en cepas material tipo II hasta 1.50 m', 'm3', 96.00, 285.00),
    ('A.03', 'Relleno compactado con material de banco en capas de 20 cm', 'm3', 42.00, 310.00),
    ('B', 'CIMENTACIÓN', '', None, None),
    ('B.01', 'Plantilla de concreto f\'c=100 kg/cm2 de 5 cm de espesor', 'm2', 64.00, 145.00),
    ('B.02', 'Zapata corrida de concreto f\'c=250 kg/cm2 armada, incluye cimbra', 'm3', 28.50, 4850.00),
    ('B.03', 'Cadena de desplante 15x30 cm concreto f\'c=250 armex 15-30-4', 'ml', 118.00, 425.00),
    ('C', 'ESTRUCTURA', '', None, None),
    ('C.01', 'Muro de block de concreto 15x20x40 asentado con mortero 1:4', 'm2', 420.00, 385.00),
    ('C.02', 'Castillo K-1 15x15 cm concreto f\'c=250 armex 15-15-4', 'ml', 260.00, 295.00),
    ('C.03', 'Losa maciza 12 cm concreto f\'c=250 armada, incluye cimbra', 'm2', 210.00, 1650.00),
    ('D', 'ACABADOS', '', None, None),
    ('D.01', 'Aplanado de mortero cemento-arena 1:4 acabado fino', 'm2', 840.00, 165.00),
    ('D.02', 'Piso de porcelanato 60x60 asentado con adhesivo', 'm2', 190.00, 690.00),
    ('D.03', 'Pintura vinílica dos manos sobre aplanado', 'm2', 840.00, 78.00),
]

def escribir(nombre, encabezados, titulo, cuerpo):
    wb = Workbook(); ws = wb.active; ws.title = 'Presupuesto'
    ws.append([titulo]); ws['A1'].font = Font(bold=True, size=12)
    ws.append(['Obra: Casa habitación 20x40 · Chihuahua, Chih.'])
    ws.append([])
    ws.append(encabezados)
    for c in ws[4]: c.font = Font(bold=True)
    filas = []
    for cve, desc, uni, cant, pu in DATA:
        if cant is None:
            sub = sum(c * p for k, d, u, c, p in DATA if c is not None and k.startswith(cve + '.'))
            fila = cuerpo(cve, desc, '', '', '', round(sub, 2), True)
        else:
            fila = cuerpo(cve, desc, uni, cant, pu, round(cant * pu, 2), False)
        ws.append(fila); filas.append(fila)
    total = sum(c * p for k, d, u, c, p in DATA if c is not None)
    ws.append([]); ws.append(cuerpo('', 'TOTAL', '', '', '', round(total, 2), True))
    for col, w in zip('ABCDEFG', [10, 62, 8, 12, 14, 16, 8]): ws.column_dimensions[col].width = w
    wb.save(os.path.join(R, 'docs', 'plantillas', nombre + '.xlsx'))
    with io.open(os.path.join(R, 'scripts', 'qa', 'fixtures', nombre + '.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f); w.writerow([titulo]); w.writerow([]); w.writerow(encabezados)
        for fila in filas: w.writerow(fila)
        w.writerow(cuerpo('', 'TOTAL', '', '', '', round(total, 2), True))
    return round(total, 2)

t1 = escribir('opus-ejemplo', ['Código', 'Concepto', 'Unidad', 'Cantidad', 'P. Unitario', 'Importe'],
              'OPUS · Presupuesto de obra', lambda k, d, u, c, p, i, part: [k, d, u, c, p, i])
t2 = escribir('neodata-ejemplo', ['Clave', 'Descripción', 'Unidad', 'Cantidad', 'Precio', 'Importe', '%'],
              'Neodata · Presupuesto', lambda k, d, u, c, p, i, part: [k, d, u, c, p, i, ''])
print('plantillas listas; total', t1, t2)
