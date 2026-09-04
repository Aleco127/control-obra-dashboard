# Plan de Implementacion: Modulo de Contabilidad y Nomina
## Control de Obra Dashboard

**Fecha**: Enero 2025
**Version**: 1.0

---

## 1. Resumen Ejecutivo

Este documento describe el plan completo para implementar un sistema de nomina y contabilidad integrado en Control de Obra Dashboard, con capacidad de:

1. **Calcular nomina** con todas las prestaciones de ley mexicanas
2. **Generar archivos SUA** para importacion al sistema del IMSS
3. **Generar archivos IDSE** para movimientos afiliatorios
4. **Crear layouts de dispersion bancaria** para pago automatico
5. **Calcular cuotas obrero-patronales** IMSS/INFONAVIT/AFORE
6. **Generar CFDIs de nomina** (complemento 1.2 revision E)
7. **Control de REPSE** para subcontratistas

---

## 2. Arquitectura del Sistema

### 2.1 Modulos Propuestos

```
CONTABILIDAD
├── Contabilidad (existente)
├── Facturas CFDI (existente)
├── CFDIs Emitidos (existente)
├── Retenciones (existente)
├── Declaraciones (existente)
├── REPSE (nuevo)
└── SUA/IDSE (nuevo)

RECURSOS HUMANOS (RRHH) - Ampliar
├── Empleados (existente basico)
├── Nomina (nuevo)
│   ├── Calculo de Nomina
│   ├── Recibos de Nomina
│   ├── Historial de Pagos
│   └── Finiquitos
├── SUA/IDSE (nuevo)
│   ├── Movimientos Afiliatorios
│   ├── Generar Archivos SUA
│   └── Generar Archivos IDSE
├── Cuotas IMSS (nuevo)
│   ├── Cuotas Obrero-Patronales
│   ├── Prima de Riesgo
│   └── Determinacion Bimestral
├── INFONAVIT (nuevo)
│   ├── Aportaciones
│   └── Creditos Vigentes
├── Dispersion Bancaria (nuevo)
│   ├── Configurar Layouts
│   └── Generar Archivos
└── Provisiones (nuevo)
    ├── Aguinaldo
    ├── Vacaciones
    └── Prima Vacacional
```

---

## 3. Estructura de Base de Datos

### 3.1 Nuevas Tablas Requeridas

#### Tabla: `config_empresa_nomina`
```sql
CREATE TABLE config_empresa_nomina (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER REFERENCES empresas(id),

    -- Datos IMSS
    registro_patronal VARCHAR(15) NOT NULL,
    registro_patronal_digito VARCHAR(1),
    clase_riesgo INTEGER DEFAULT 5, -- 1-5 (construccion = 5)
    prima_riesgo DECIMAL(8,5) DEFAULT 4.65325, -- Clase V minima
    fraccion_riesgo VARCHAR(10),

    -- Datos Fiscales
    rfc_empresa VARCHAR(13) NOT NULL,
    razon_social VARCHAR(200) NOT NULL,
    regimen_fiscal VARCHAR(3) DEFAULT '601', -- General de Ley PM

    -- Configuracion Nomina
    periodicidad_pago VARCHAR(2) DEFAULT '02', -- 02=Semanal, 04=Quincenal, 05=Mensual
    dia_pago INTEGER DEFAULT 15,
    cuenta_nomina VARCHAR(20),
    banco_id INTEGER,
    clabe_dispersiones VARCHAR(18),

    -- UMA y Salarios Minimos
    uma_diaria DECIMAL(10,2) DEFAULT 113.14, -- 2025
    salario_minimo_diario DECIMAL(10,2) DEFAULT 278.80, -- 2025
    salario_minimo_zlfn DECIMAL(10,2) DEFAULT 419.88, -- Zona Libre Frontera Norte

    -- Coeficiente ISR
    coeficiente_utilidad DECIMAL(8,6) DEFAULT 0.00,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `empleados_nomina`
```sql
CREATE TABLE empleados_nomina (
    id SERIAL PRIMARY KEY,
    empleado_id INTEGER REFERENCES empleados(id),
    empresa_id INTEGER REFERENCES empresas(id),

    -- Datos IMSS
    nss VARCHAR(11) NOT NULL, -- Numero Seguro Social
    curp VARCHAR(18) NOT NULL,
    rfc VARCHAR(13) NOT NULL,
    umf VARCHAR(3), -- Unidad Medicina Familiar

    -- Datos Laborales
    fecha_alta DATE NOT NULL,
    fecha_baja DATE,
    tipo_contrato VARCHAR(2) DEFAULT '01', -- 01=Indeterminado
    tipo_jornada VARCHAR(2) DEFAULT '01', -- 01=Diurna
    tipo_regimen VARCHAR(2) DEFAULT '02', -- 02=Sueldos y Salarios

    -- Salarios
    salario_diario DECIMAL(12,2) NOT NULL,
    salario_base_cotizacion DECIMAL(12,2), -- SDI
    factor_integracion DECIMAL(8,6) DEFAULT 1.0493,
    tipo_salario VARCHAR(1) DEFAULT 'F', -- F=Fijo, V=Variable, M=Mixto

    -- Banco
    banco_id INTEGER,
    cuenta_bancaria VARCHAR(20),
    clabe VARCHAR(18),

    -- Prestaciones Superiores (si aplican)
    dias_aguinaldo INTEGER DEFAULT 15,
    dias_vacaciones INTEGER DEFAULT 12, -- Segun antiguedad
    prima_vacacional DECIMAL(5,2) DEFAULT 25.00,

    -- Creditos
    tiene_credito_infonavit BOOLEAN DEFAULT FALSE,
    numero_credito_infonavit VARCHAR(20),
    tipo_descuento_infonavit VARCHAR(1), -- 1=%, 2=VSM, 3=Pesos
    valor_descuento_infonavit DECIMAL(10,2),
    tiene_credito_fonacot BOOLEAN DEFAULT FALSE,
    numero_credito_fonacot VARCHAR(20),
    descuento_fonacot DECIMAL(10,2),

    estatus VARCHAR(20) DEFAULT 'Activo', -- Activo, Baja, Incapacidad
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `periodos_nomina`
```sql
CREATE TABLE periodos_nomina (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER REFERENCES empresas(id),
    obra_id INTEGER REFERENCES obras(id), -- Opcional, para nomina por obra

    numero_periodo INTEGER NOT NULL,
    anio INTEGER NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    fecha_pago DATE NOT NULL,

    tipo_nomina VARCHAR(1) DEFAULT 'O', -- O=Ordinaria, E=Extraordinaria
    periodicidad VARCHAR(2) DEFAULT '04', -- 04=Quincenal

    -- Totales
    total_percepciones DECIMAL(14,2) DEFAULT 0,
    total_deducciones DECIMAL(14,2) DEFAULT 0,
    total_neto DECIMAL(14,2) DEFAULT 0,
    total_cuotas_patronales DECIMAL(14,2) DEFAULT 0,

    estatus VARCHAR(20) DEFAULT 'Abierto', -- Abierto, Calculado, Cerrado, Timbrado
    fecha_cierre TIMESTAMP,
    cerrado_por INTEGER,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `recibos_nomina`
```sql
CREATE TABLE recibos_nomina (
    id SERIAL PRIMARY KEY,
    periodo_id INTEGER REFERENCES periodos_nomina(id),
    empleado_id INTEGER REFERENCES empleados(id),
    empleado_nomina_id INTEGER REFERENCES empleados_nomina(id),

    -- Datos del periodo
    fecha_inicial_pago DATE,
    fecha_final_pago DATE,
    dias_pagados INTEGER DEFAULT 15,

    -- Percepciones
    sueldo_base DECIMAL(12,2) DEFAULT 0,
    septimo_dia DECIMAL(12,2) DEFAULT 0,
    horas_extras_dobles DECIMAL(12,2) DEFAULT 0,
    horas_extras_triples DECIMAL(12,2) DEFAULT 0,
    prima_dominical DECIMAL(12,2) DEFAULT 0,
    dias_festivos DECIMAL(12,2) DEFAULT 0,
    vacaciones DECIMAL(12,2) DEFAULT 0,
    prima_vacacional DECIMAL(12,2) DEFAULT 0,
    aguinaldo DECIMAL(12,2) DEFAULT 0,
    ptu DECIMAL(12,2) DEFAULT 0,
    bonos DECIMAL(12,2) DEFAULT 0,
    comisiones DECIMAL(12,2) DEFAULT 0,
    otras_percepciones DECIMAL(12,2) DEFAULT 0,

    -- Totales Percepciones
    total_percepciones_gravadas DECIMAL(12,2) DEFAULT 0,
    total_percepciones_exentas DECIMAL(12,2) DEFAULT 0,
    total_percepciones DECIMAL(12,2) DEFAULT 0,

    -- Deducciones
    isr_retenido DECIMAL(12,2) DEFAULT 0,
    imss_obrero DECIMAL(12,2) DEFAULT 0,
    infonavit_descuento DECIMAL(12,2) DEFAULT 0,
    fonacot_descuento DECIMAL(12,2) DEFAULT 0,
    pension_alimenticia DECIMAL(12,2) DEFAULT 0,
    prestamos_empresa DECIMAL(12,2) DEFAULT 0,
    otras_deducciones DECIMAL(12,2) DEFAULT 0,
    ajuste_subsidio DECIMAL(12,2) DEFAULT 0,

    -- Subsidio al empleo
    subsidio_causado DECIMAL(12,2) DEFAULT 0,
    subsidio_entregado DECIMAL(12,2) DEFAULT 0,

    -- Totales
    total_deducciones DECIMAL(12,2) DEFAULT 0,
    neto_a_pagar DECIMAL(12,2) DEFAULT 0,

    -- CFDI
    uuid_cfdi VARCHAR(36),
    xml_cfdi TEXT,
    pdf_cfdi TEXT, -- Base64
    fecha_timbrado TIMESTAMP,
    estatus_cfdi VARCHAR(20), -- Pendiente, Timbrado, Cancelado

    -- Cuotas Patronales (informativo)
    cuota_imss_patronal DECIMAL(12,2) DEFAULT 0,
    aportacion_infonavit DECIMAL(12,2) DEFAULT 0,
    aportacion_retiro DECIMAL(12,2) DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `movimientos_afiliatorios`
```sql
CREATE TABLE movimientos_afiliatorios (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER REFERENCES empresas(id),
    empleado_nomina_id INTEGER REFERENCES empleados_nomina(id),

    tipo_movimiento VARCHAR(2) NOT NULL,
    -- 02=Baja, 07=Mod. Salario, 08=Reingreso, 11=Ausentismo, 12=Incapacidad

    fecha_movimiento DATE NOT NULL,

    -- Datos del movimiento
    nss VARCHAR(11),
    salario_anterior DECIMAL(12,2),
    salario_nuevo DECIMAL(12,2),
    causa_baja VARCHAR(2), -- Para bajas
    dias_incapacidad INTEGER, -- Para incapacidades
    tipo_incapacidad VARCHAR(2), -- 01=Riesgo, 02=Enfermedad, 03=Maternidad
    folio_incapacidad VARCHAR(20),

    -- Control de envio
    enviado_idse BOOLEAN DEFAULT FALSE,
    fecha_envio_idse TIMESTAMP,
    respuesta_idse TEXT,
    acuse_idse VARCHAR(50),

    exportado_sua BOOLEAN DEFAULT FALSE,
    fecha_exportacion_sua TIMESTAMP,

    estatus VARCHAR(20) DEFAULT 'Pendiente', -- Pendiente, Enviado, Aceptado, Rechazado

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `cuotas_imss_bimestre`
```sql
CREATE TABLE cuotas_imss_bimestre (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER REFERENCES empresas(id),

    bimestre INTEGER NOT NULL, -- 1-6
    anio INTEGER NOT NULL,

    -- Cuotas Patronales por ramo
    cuota_enfermedad_maternidad_fija DECIMAL(14,2) DEFAULT 0,
    cuota_enfermedad_maternidad_excedente DECIMAL(14,2) DEFAULT 0,
    cuota_gastos_medicos_pensionados DECIMAL(14,2) DEFAULT 0,
    cuota_invalidez_vida DECIMAL(14,2) DEFAULT 0,
    cuota_riesgo_trabajo DECIMAL(14,2) DEFAULT 0,
    cuota_guarderias DECIMAL(14,2) DEFAULT 0,
    cuota_retiro DECIMAL(14,2) DEFAULT 0,
    cuota_cesantia_vejez DECIMAL(14,2) DEFAULT 0,
    aportacion_infonavit DECIMAL(14,2) DEFAULT 0,

    -- Cuotas Obreras
    obrero_enfermedad_maternidad DECIMAL(14,2) DEFAULT 0,
    obrero_invalidez_vida DECIMAL(14,2) DEFAULT 0,
    obrero_cesantia_vejez DECIMAL(14,2) DEFAULT 0,

    -- Totales
    total_cuotas_patronales DECIMAL(14,2) DEFAULT 0,
    total_cuotas_obreras DECIMAL(14,2) DEFAULT 0,
    total_a_pagar DECIMAL(14,2) DEFAULT 0,

    -- Datos pago
    fecha_limite_pago DATE,
    fecha_pago DATE,
    linea_captura VARCHAR(30),
    estatus VARCHAR(20) DEFAULT 'Pendiente',

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `creditos_infonavit`
```sql
CREATE TABLE creditos_infonavit (
    id SERIAL PRIMARY KEY,
    empleado_nomina_id INTEGER REFERENCES empleados_nomina(id),

    numero_credito VARCHAR(20) NOT NULL,
    fecha_otorgamiento DATE,
    monto_credito DECIMAL(14,2),

    tipo_descuento VARCHAR(1) NOT NULL, -- 1=%, 2=VSM, 3=Pesos
    factor_descuento DECIMAL(10,4), -- Para tipo 1 y 2
    monto_descuento DECIMAL(10,2), -- Para tipo 3

    saldo_actual DECIMAL(14,2),
    estatus VARCHAR(20) DEFAULT 'Vigente',

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `repse_contratistas`
```sql
CREATE TABLE repse_contratistas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER REFERENCES empresas(id),
    proveedor_id INTEGER REFERENCES proveedores(id),

    -- Datos REPSE
    folio_repse VARCHAR(30),
    fecha_registro DATE,
    fecha_vigencia DATE,
    actividades_permitidas TEXT,

    -- Validacion mensual
    ultima_validacion DATE,
    estatus_validacion VARCHAR(20), -- Vigente, Vencido, Cancelado

    -- Verificacion IMSS
    registro_patronal VARCHAR(15),
    patron_al_corriente BOOLEAN,
    fecha_verificacion_imss DATE,

    -- Documentacion
    constancia_situacion_fiscal TEXT, -- URL o base64
    opinion_cumplimiento_sat TEXT,
    opinion_cumplimiento_imss TEXT,

    estatus VARCHAR(20) DEFAULT 'Activo',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `provisiones_laborales`
```sql
CREATE TABLE provisiones_laborales (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER REFERENCES empresas(id),
    periodo_id INTEGER REFERENCES periodos_nomina(id),

    mes INTEGER,
    anio INTEGER,

    -- Provisiones
    provision_aguinaldo DECIMAL(14,2) DEFAULT 0,
    provision_vacaciones DECIMAL(14,2) DEFAULT 0,
    provision_prima_vacacional DECIMAL(14,2) DEFAULT 0,
    provision_prima_antiguedad DECIMAL(14,2) DEFAULT 0,
    provision_ptu DECIMAL(14,2) DEFAULT 0,

    -- Acumulados
    aguinaldo_pagado DECIMAL(14,2) DEFAULT 0,
    vacaciones_pagadas DECIMAL(14,2) DEFAULT 0,
    prima_vacacional_pagada DECIMAL(14,2) DEFAULT 0,

    -- Saldos
    saldo_aguinaldo DECIMAL(14,2) DEFAULT 0,
    saldo_vacaciones DECIMAL(14,2) DEFAULT 0,
    saldo_prima_vacacional DECIMAL(14,2) DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `layouts_bancarios`
```sql
CREATE TABLE layouts_bancarios (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER REFERENCES empresas(id),

    nombre VARCHAR(100) NOT NULL,
    banco VARCHAR(50) NOT NULL,
    tipo_layout VARCHAR(20) DEFAULT 'SPEI', -- SPEI, TEF, Interno

    -- Configuracion del layout
    formato VARCHAR(10) DEFAULT 'TXT', -- TXT, CSV, XML
    separador VARCHAR(5) DEFAULT '|',
    longitud_fija BOOLEAN DEFAULT FALSE,

    -- Campos del layout (JSON con estructura)
    estructura_campos JSONB,

    -- Ejemplo de estructura_campos:
    -- [
    --   {"nombre": "tipo_registro", "posicion": 1, "longitud": 2, "tipo": "fijo", "valor": "03"},
    --   {"nombre": "clabe_origen", "posicion": 3, "longitud": 18, "tipo": "config", "campo": "clabe_empresa"},
    --   {"nombre": "monto", "posicion": 21, "longitud": 15, "tipo": "dato", "campo": "neto_a_pagar"},
    --   ...
    -- ]

    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla: `dispersiones_nomina`
```sql
CREATE TABLE dispersiones_nomina (
    id SERIAL PRIMARY KEY,
    periodo_id INTEGER REFERENCES periodos_nomina(id),
    layout_id INTEGER REFERENCES layouts_bancarios(id),

    fecha_generacion TIMESTAMP DEFAULT NOW(),
    fecha_aplicacion DATE,

    total_registros INTEGER,
    total_monto DECIMAL(14,2),

    archivo_generado TEXT, -- Contenido o URL
    nombre_archivo VARCHAR(100),

    -- Control bancario
    folio_banco VARCHAR(30),
    estatus_banco VARCHAR(20), -- Pendiente, Procesado, Rechazado
    fecha_confirmacion TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 4. Tablas Fiscales 2025

### 4.1 Tabla ISR Mensual 2025

```javascript
const TABLA_ISR_MENSUAL_2025 = [
    { limite_inferior: 0.01, limite_superior: 746.04, cuota_fija: 0, tasa: 1.92 },
    { limite_inferior: 746.05, limite_superior: 6332.05, cuota_fija: 14.32, tasa: 6.40 },
    { limite_inferior: 6332.06, limite_superior: 11128.01, cuota_fija: 371.83, tasa: 10.88 },
    { limite_inferior: 11128.02, limite_superior: 12935.82, cuota_fija: 893.63, tasa: 16.00 },
    { limite_inferior: 12935.83, limite_superior: 15487.71, cuota_fija: 1182.88, tasa: 17.92 },
    { limite_inferior: 15487.72, limite_superior: 31236.49, cuota_fija: 1640.18, tasa: 21.36 },
    { limite_inferior: 31236.50, limite_superior: 49233.00, cuota_fija: 5004.12, tasa: 23.52 },
    { limite_inferior: 49233.01, limite_superior: 93993.90, cuota_fija: 9236.89, tasa: 30.00 },
    { limite_inferior: 93993.91, limite_superior: 125325.20, cuota_fija: 22665.17, tasa: 32.00 },
    { limite_inferior: 125325.21, limite_superior: 375975.61, cuota_fija: 32691.18, tasa: 34.00 },
    { limite_inferior: 375975.62, limite_superior: Infinity, cuota_fija: 117912.32, tasa: 35.00 }
];
```

### 4.2 Subsidio al Empleo 2025

```javascript
const SUBSIDIO_EMPLEO_2025 = {
    limite_mensual: 10171.00, // Ingreso maximo para recibir subsidio
    subsidio_mensual: 474.95, // Monto fijo mensual
    // Para otros periodos se divide proporcionalmente
    subsidio_quincenal: 237.48,
    subsidio_semanal: 109.60
};
```

### 4.3 Cuotas IMSS 2025 (Patron + Obrero)

```javascript
const CUOTAS_IMSS_2025 = {
    // Cuotas en % sobre SBC

    // ENFERMEDAD Y MATERNIDAD
    enf_mat_cuota_fija_patron: 20.40, // Sobre 1 SMGDF
    enf_mat_excedente_patron: 1.10,   // Sobre excedente de 3 UMA
    enf_mat_excedente_obrero: 0.40,   // Sobre excedente de 3 UMA
    enf_mat_gastos_medicos_patron: 1.05,
    enf_mat_gastos_medicos_obrero: 0.375,
    enf_mat_prestaciones_patron: 0.70,
    enf_mat_prestaciones_obrero: 0.25,

    // INVALIDEZ Y VIDA
    invalidez_vida_patron: 1.75,
    invalidez_vida_obrero: 0.625,

    // RIESGO DE TRABAJO (Clase V - Construccion)
    riesgo_trabajo_clase_V: {
        prima_minima: 4.65325,
        prima_maxima: 15.00000
    },

    // GUARDERIAS Y PRESTACIONES SOCIALES
    guarderias_patron: 1.00,

    // RETIRO (SAR)
    retiro_patron: 2.00,

    // CESANTIA EN EDAD AVANZADA Y VEJEZ 2025
    // Escala progresiva segun salario
    cesantia_vejez_patron: [
        { sm_desde: 1.00, sm_hasta: 1.00, tasa: 3.150 },
        { sm_desde: 1.01, sm_hasta: 1.50, tasa: 4.202 },
        { sm_desde: 1.51, sm_hasta: 2.00, tasa: 4.729 },
        { sm_desde: 2.01, sm_hasta: 2.50, tasa: 5.255 },
        { sm_desde: 2.51, sm_hasta: 3.00, tasa: 5.782 },
        { sm_desde: 3.01, sm_hasta: 3.50, tasa: 6.044 },
        { sm_desde: 3.51, sm_hasta: 4.00, tasa: 6.183 },
        { sm_desde: 4.01, sm_hasta: Infinity, tasa: 6.422 }
    ],
    cesantia_vejez_obrero: 1.125, // Fijo

    // INFONAVIT
    infonavit_patron: 5.00,

    // Topes
    tope_sbc_uma: 25, // 25 veces UMA diaria
    uma_diaria_2025: 113.14
};
```

### 4.4 Prestaciones de Ley

```javascript
const PRESTACIONES_LEY = {
    aguinaldo_minimo: 15, // dias
    vacaciones_por_antiguedad: [
        { anios_desde: 1, anios_hasta: 1, dias: 12 },
        { anios_desde: 2, anios_hasta: 2, dias: 14 },
        { anios_desde: 3, anios_hasta: 3, dias: 16 },
        { anios_desde: 4, anios_hasta: 4, dias: 18 },
        { anios_desde: 5, anios_hasta: 5, dias: 20 },
        { anios_desde: 6, anios_hasta: 10, dias: 22 },
        { anios_desde: 11, anios_hasta: 15, dias: 24 },
        { anios_desde: 16, anios_hasta: 20, dias: 26 },
        { anios_desde: 21, anios_hasta: 25, dias: 28 },
        { anios_desde: 26, anios_hasta: 30, dias: 30 },
        { anios_desde: 31, anios_hasta: 35, dias: 32 }
    ],
    prima_vacacional_minima: 25, // %
    prima_dominical: 25, // %
    horas_extra_dobles: 2, // multiplicador
    horas_extra_triples: 3, // multiplicador
    ptu_porcentaje: 10 // % de utilidades
};
```

---

## 5. Formulas de Calculo

### 5.1 Salario Diario Integrado (SDI)

```javascript
function calcularSDI(salarioDiario, diasAguinaldo, diasVacaciones, primVacacional) {
    // Factor de integracion
    const factorAguinaldo = diasAguinaldo / 365;
    const factorVacaciones = (diasVacaciones * (primVacacional / 100)) / 365;
    const factorIntegracion = 1 + factorAguinaldo + factorVacaciones;

    return salarioDiario * factorIntegracion;
}

// Ejemplo: Salario $500 diarios, 15 aguinaldo, 12 vacaciones, 25% prima
// Factor = 1 + (15/365) + (12*0.25/365) = 1 + 0.0411 + 0.0082 = 1.0493
// SDI = 500 * 1.0493 = $524.65
```

### 5.2 Calculo ISR

```javascript
function calcularISR(baseGravable, periodoMensual = true) {
    const tabla = TABLA_ISR_MENSUAL_2025;

    // Encontrar rango
    const rango = tabla.find(r =>
        baseGravable >= r.limite_inferior && baseGravable <= r.limite_superior
    );

    if (!rango) return 0;

    // ISR = Cuota fija + (Excedente * Tasa / 100)
    const excedente = baseGravable - rango.limite_inferior;
    const isr = rango.cuota_fija + (excedente * rango.tasa / 100);

    return Math.max(0, isr);
}

function aplicarSubsidio(ingresoMensual, isrCalculado) {
    if (ingresoMensual <= SUBSIDIO_EMPLEO_2025.limite_mensual) {
        const subsidio = SUBSIDIO_EMPLEO_2025.subsidio_mensual;
        if (isrCalculado > subsidio) {
            return { isr: isrCalculado - subsidio, subsidio: 0 };
        } else {
            return { isr: 0, subsidio: subsidio - isrCalculado };
        }
    }
    return { isr: isrCalculado, subsidio: 0 };
}
```

### 5.3 Calculo Cuotas IMSS

```javascript
function calcularCuotasIMSS(sbc, diasTrabajados, salarioMinimoDiario, umadiaria) {
    const cuotas = CUOTAS_IMSS_2025;
    const sbcMensual = sbc * diasTrabajados;
    const tresSMDF = salarioMinimoDiario * 3 * diasTrabajados;
    const tresUMA = umadiaria * 3 * diasTrabajados;
    const topeUMA = umadiaria * 25 * diasTrabajados;

    // Aplicar tope
    const sbcAplicable = Math.min(sbcMensual, topeUMA);

    // ENFERMEDAD Y MATERNIDAD
    // Cuota fija: 20.40% sobre 1 SMDF
    const cuotaFija = salarioMinimoDiario * diasTrabajados * (cuotas.enf_mat_cuota_fija_patron / 100);

    // Excedente (si SBC > 3 UMA)
    let excedente = 0;
    let cuotaExcedentePatron = 0;
    let cuotaExcedenteObrero = 0;
    if (sbcAplicable > tresUMA) {
        excedente = sbcAplicable - tresUMA;
        cuotaExcedentePatron = excedente * (cuotas.enf_mat_excedente_patron / 100);
        cuotaExcedenteObrero = excedente * (cuotas.enf_mat_excedente_obrero / 100);
    }

    // Gastos medicos pensionados
    const gastosPatron = sbcAplicable * (cuotas.enf_mat_gastos_medicos_patron / 100);
    const gastosObrero = sbcAplicable * (cuotas.enf_mat_gastos_medicos_obrero / 100);

    // Prestaciones en dinero
    const prestacionesPatron = sbcAplicable * (cuotas.enf_mat_prestaciones_patron / 100);
    const prestacionesObrero = sbcAplicable * (cuotas.enf_mat_prestaciones_obrero / 100);

    // INVALIDEZ Y VIDA
    const invalidezPatron = sbcAplicable * (cuotas.invalidez_vida_patron / 100);
    const invalidezObrero = sbcAplicable * (cuotas.invalidez_vida_obrero / 100);

    // RIESGO DE TRABAJO (usar prima de la empresa)
    // Prima por defecto clase V: 4.65325%
    const riesgoPatron = sbcAplicable * (4.65325 / 100);

    // GUARDERIAS
    const guarderiasPatron = sbcAplicable * (cuotas.guarderias_patron / 100);

    // RETIRO
    const retiroPatron = sbcAplicable * (cuotas.retiro_patron / 100);

    // CESANTIA Y VEJEZ (escala progresiva)
    const sm = sbc / salarioMinimoDiario;
    const tasaCEV = cuotas.cesantia_vejez_patron.find(r => sm >= r.sm_desde && sm <= r.sm_hasta)?.tasa || 6.422;
    const cesantiaPatron = sbcAplicable * (tasaCEV / 100);
    const cesantiaObrero = sbcAplicable * (cuotas.cesantia_vejez_obrero / 100);

    // INFONAVIT
    const infonavitPatron = sbcAplicable * (cuotas.infonavit_patron / 100);

    return {
        patronal: {
            enfermedad_maternidad: cuotaFija + cuotaExcedentePatron + gastosPatron + prestacionesPatron,
            invalidez_vida: invalidezPatron,
            riesgo_trabajo: riesgoPatron,
            guarderias: guarderiasPatron,
            retiro: retiroPatron,
            cesantia_vejez: cesantiaPatron,
            infonavit: infonavitPatron,
            total: cuotaFija + cuotaExcedentePatron + gastosPatron + prestacionesPatron +
                   invalidezPatron + riesgoPatron + guarderiasPatron + retiroPatron +
                   cesantiaPatron + infonavitPatron
        },
        obrera: {
            enfermedad_maternidad: cuotaExcedenteObrero + gastosObrero + prestacionesObrero,
            invalidez_vida: invalidezObrero,
            cesantia_vejez: cesantiaObrero,
            total: cuotaExcedenteObrero + gastosObrero + prestacionesObrero +
                   invalidezObrero + cesantiaObrero
        }
    };
}
```

---

## 6. Generacion de Archivos

### 6.1 Archivo ASEG.TXT (SUA)

```javascript
function generarArchivoASEG(empleados, registroPatronal) {
    let contenido = '';

    empleados.forEach(emp => {
        // 164 caracteres por registro
        let linea = '';

        linea += emp.nss.padStart(11, '0');                    // 1-11: NSS
        linea += registroPatronal.slice(-2).padStart(2, '0'); // 12-13: Ultimos 2 digitos RP
        linea += '0000001';                                    // 14-20: Codigo puesto
        linea += String(emp.numero_empleado).padStart(6, '0'); // 21-26: Num empleado
        linea += emp.tipo_trabajador || '1';                   // 27: Tipo trabajador
        linea += '000001';                                     // 28-33: Departamento
        linea += '000001';                                     // 34-39: Grupo
        linea += '000001';                                     // 40-45: Subgrupo
        linea += '010101';                                     // 46-51: Riesgo trabajo
        linea += emp.sexo || 'M';                              // 52: Sexo
        linea += formatearFechaSUA(emp.fecha_nacimiento);      // 53-60: Fecha nac DDMMAAAA
        linea += formatearFechaSUA(emp.fecha_alta);            // 61-68: Fecha alta
        linea += emp.fecha_baja ? formatearFechaSUA(emp.fecha_baja) : '00000000'; // 69-76

        // Salarios sin punto decimal
        const sbcEntero = Math.floor(emp.salario_base_cotizacion);
        const sbcDecimal = Math.round((emp.salario_base_cotizacion % 1) * 100);
        linea += String(sbcEntero).padStart(5, '0');           // 77-81: SBC enteros
        linea += String(sbcDecimal).padStart(2, '0');          // 82-83: SBC decimales

        const sdiEntero = Math.floor(emp.salario_diario_integrado);
        const sdiDecimal = Math.round((emp.salario_diario_integrado % 1) * 100);
        linea += String(sdiEntero).padStart(5, '0');           // 84-88: SDI enteros
        linea += String(sdiDecimal).padStart(2, '0');          // 89-90: SDI decimales

        linea += (emp.curp || '').substring(0, 7).padEnd(7);   // 91-97: CURP parcial
        linea += (emp.codigo_postal || '').padEnd(8);          // 98-105: CP
        linea += '00001';                                       // 106-110: Folio IMSS
        linea += ' '.repeat(54);                                // 111-164: Relleno

        contenido += linea + '\r\n';
    });

    return contenido;
}

function formatearFechaSUA(fecha) {
    if (!fecha) return '00000000';
    const d = new Date(fecha);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const anio = String(d.getFullYear());
    return dia + mes + anio;
}
```

### 6.2 Archivo MOVT.TXT (Movimientos)

```javascript
function generarArchivoMOVT(movimientos) {
    let contenido = '';

    movimientos.forEach(mov => {
        // 49 caracteres por registro
        let linea = '';

        linea += mov.nss.padStart(11, '0');                     // 1-11: NSS
        linea += String(mov.numero_empleado).padStart(6, '0'); // 12-17: Num empleado
        linea += mov.tipo_movimiento.padStart(2, '0');         // 18-19: Tipo (02, 07, 08, etc)
        linea += formatearFechaSUA(mov.fecha_movimiento);      // 20-27: Fecha DDMMAAAA

        // Salario (si aplica)
        const salEntero = Math.floor(mov.salario_nuevo || 0);
        const salDecimal = Math.round(((mov.salario_nuevo || 0) % 1) * 100);
        linea += String(salEntero).padStart(5, '0');           // 28-32: Salario enteros
        linea += String(salDecimal).padStart(2, '0');          // 33-34: Salario decimales

        linea += ' '.repeat(15);                                // 35-49: Relleno

        contenido += linea + '\r\n';
    });

    return contenido;
}
```

### 6.3 Layout Dispersion Bancaria SPEI

```javascript
function generarLayoutSPEI(dispersion, empleados, config) {
    const lineas = [];
    let totalMonto = 0;
    let numRegistros = 0;

    // Header (Tipo 01)
    const header = [
        '01',                                           // Tipo registro
        config.clabe_origen.padStart(18, '0'),         // CLABE origen
        config.rfc_empresa.padEnd(13),                 // RFC empresa
        formatearFechaBanco(dispersion.fecha_aplicacion), // Fecha aplicacion
        '000000',                                       // Secuencia
        ' '.repeat(50)                                  // Relleno
    ].join('|');
    lineas.push(header);

    // Detalles (Tipo 03)
    empleados.forEach(emp => {
        if (emp.neto_a_pagar > 0 && emp.clabe) {
            const detalle = [
                '03',                                       // Tipo registro
                config.clabe_origen.padStart(18, '0'),     // CLABE origen
                config.rfc_empresa.padEnd(13),             // RFC empresa
                formatearMonto(emp.neto_a_pagar),          // Monto (15 enteros, 2 dec)
                emp.clabe.padStart(18, '0'),               // CLABE destino
                (emp.rfc || 'XAXX010101000').padEnd(13),  // RFC empleado
                `PAGO NOMINA ${dispersion.periodo}`.padEnd(40).substring(0, 40), // Concepto
                emp.nombre.substring(0, 40).padEnd(40),    // Nombre beneficiario
                'NOMINA'                                    // Tipo pago
            ].join('|');
            lineas.push(detalle);
            totalMonto += emp.neto_a_pagar;
            numRegistros++;
        }
    });

    // Trailer (Tipo 09)
    const trailer = [
        '09',                                           // Tipo registro
        String(numRegistros).padStart(6, '0'),         // Num registros
        formatearMonto(totalMonto)                      // Monto total
    ].join('|');
    lineas.push(trailer);

    return lineas.join('\r\n');
}

function formatearMonto(monto) {
    const entero = Math.floor(monto);
    const decimal = Math.round((monto % 1) * 100);
    return String(entero).padStart(13, '0') + String(decimal).padStart(2, '0');
}

function formatearFechaBanco(fecha) {
    const d = new Date(fecha);
    const anio = String(d.getFullYear());
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return anio + mes + dia;
}
```

---

## 7. Flujos de Trabajo

### 7.1 Flujo de Calculo de Nomina

```
1. PREPARACION
   └─> Seleccionar periodo
   └─> Verificar empleados activos
   └─> Verificar incidencias (faltas, incapacidades, extras)

2. CALCULO POR EMPLEADO
   └─> Calcular percepciones
       ├─> Sueldo base (dias trabajados)
       ├─> Septimo dia
       ├─> Horas extras
       ├─> Vacaciones/Prima vacacional
       ├─> Bonos/Comisiones
       └─> Otros ingresos
   └─> Calcular deducciones
       ├─> ISR (con tabla 2025)
       ├─> Subsidio al empleo
       ├─> IMSS obrero
       ├─> INFONAVIT (si tiene credito)
       ├─> FONACOT (si tiene credito)
       ├─> Pension alimenticia
       └─> Otras deducciones
   └─> Calcular neto a pagar

3. CALCULO CUOTAS PATRONALES
   └─> IMSS patronal por ramo
   └─> INFONAVIT 5%
   └─> Retiro 2%
   └─> CEAV segun escala

4. GENERACION DE RECIBOS
   └─> Crear recibo por empleado
   └─> Guardar en base de datos

5. REVISION Y CIERRE
   └─> Revisar totales
   └─> Aprobar periodo
   └─> Cerrar periodo (ya no editable)

6. TIMBRADO CFDI
   └─> Generar XML de nomina
   └─> Enviar a PAC
   └─> Guardar UUID y XML timbrado

7. DISPERSION
   └─> Generar archivo bancario
   └─> Subir a plataforma banco
   └─> Confirmar pago
```

### 7.2 Flujo SUA/IDSE

```
1. DETECCION DE MOVIMIENTOS
   └─> Alta de empleado nuevo
   └─> Baja de empleado
   └─> Modificacion de salario
   └─> Reingreso
   └─> Ausentismo
   └─> Incapacidad

2. REGISTRO DE MOVIMIENTO
   └─> Crear registro en movimientos_afiliatorios
   └─> Estatus = Pendiente

3. GENERACION DE ARCHIVOS
   └─> Opcion A: Generar archivos SUA (aseg.txt, movt.txt)
   └─> Opcion B: Generar archivo IDSE

4. ENVIO/CARGA
   └─> Cargar archivo a IDSE web
   └─> Registrar fecha de envio
   └─> Actualizar estatus

5. SEGUIMIENTO
   └─> Verificar respuesta IDSE
   └─> Registrar acuse si fue aceptado
   └─> Manejar rechazos
```

---

## 8. Interfaz de Usuario Propuesta

### 8.1 Menu Actualizado

```javascript
// Agregar a la estructura del menu
{
    t: 'Nomina',
    k: 'nomina',
    ic: 'ri-money-dollar-box-line',
    i: [
        ['np', 'ri-dashboard-line', 'Panel Nomina'],
        ['nc', 'ri-calculator-line', 'Calcular Nomina'],
        ['nr', 'ri-file-list-line', 'Recibos'],
        ['ns', 'ri-bank-line', 'SUA/IDSE'],
        ['nd', 'ri-money-dollar-circle-line', 'Dispersion'],
        ['nq', 'ri-pie-chart-line', 'Cuotas IMSS'],
        ['ni', 'ri-home-4-line', 'INFONAVIT'],
        ['nv', 'ri-calendar-check-line', 'Provisiones']
    ]
}
```

### 8.2 Panel Principal de Nomina

El panel mostrara:
- KPIs: Total nomina, Total patronal, Empleados activos, Periodo actual
- Grafica: Nomina por mes (ultimos 12 meses)
- Accesos rapidos: Calcular, Ver recibos, Generar dispersion
- Alertas: Movimientos pendientes, Creditos por vencer

### 8.3 Calculadora de Nomina

Pantalla con:
- Selector de periodo
- Lista de empleados con checkbox
- Boton calcular seleccionados / calcular todos
- Vista previa de resultados
- Boton cerrar periodo
- Boton generar CFDIs

---

## 9. Fases de Implementacion

### Fase 1: Base de Datos (2-3 dias)
- [ ] Crear tablas en Supabase
- [ ] Crear funciones RPC necesarias
- [ ] Poblar tablas de configuracion (ISR, IMSS)
- [ ] Migrar datos de empleados existentes

### Fase 2: Configuracion Empresa (1-2 dias)
- [ ] Pantalla de configuracion de nomina
- [ ] Registro patronal, prima riesgo
- [ ] Configuracion bancaria

### Fase 3: Empleados Nomina (2-3 dias)
- [ ] Formulario de datos de nomina por empleado
- [ ] NSS, CURP, RFC, datos bancarios
- [ ] Configuracion de creditos

### Fase 4: Calculo de Nomina (3-4 dias)
- [ ] Motor de calculo de percepciones
- [ ] Motor de calculo de deducciones
- [ ] Calculo ISR con tablas 2025
- [ ] Calculo cuotas IMSS
- [ ] Generacion de recibos

### Fase 5: SUA/IDSE (2-3 dias)
- [ ] Deteccion automatica de movimientos
- [ ] Generacion archivo ASEG.TXT
- [ ] Generacion archivo MOVT.TXT
- [ ] Interfaz de exportacion

### Fase 6: Dispersion Bancaria (2 dias)
- [ ] Configuracion de layouts
- [ ] Generacion de archivos SPEI
- [ ] Historial de dispersiones

### Fase 7: Integraciones (3-4 dias)
- [ ] Conexion con PAC para CFDI
- [ ] Provisiones automaticas
- [ ] Reportes y dashboards

### Fase 8: REPSE (1-2 dias)
- [ ] Registro de contratistas
- [ ] Validacion mensual
- [ ] Alertas de vencimiento

---

## 10. Consideraciones Especiales para Construccion

1. **Riesgo de Trabajo Clase V**: La construccion tiene la clasificacion mas alta de riesgo. La prima minima es 4.65325% pero puede incrementarse segun siniestralidad.

2. **Trabajadores por Obra**: Considerar empleados que trabajan en multiples obras y prorratear sus costos.

3. **SIROC**: El sistema tiene obligaciones adicionales de reporte ante IMSS para obras de construccion (SATIC-01 a SATIC-05).

4. **Responsabilidad Solidaria**: Control estricto de subcontratistas (REPSE) para evitar responsabilidad solidaria ante IMSS.

5. **Variabilidad de Plantilla**: Las constructoras tienen alta rotacion. El sistema debe manejar altas y bajas frecuentes eficientemente.

---

## 11. Referencias

- Ley Federal del Trabajo
- Ley del Seguro Social
- Ley del ISR y su Reglamento
- Manual SUA IMSS
- Especificaciones IDSE
- CFDI Nomina Complemento 1.2 Rev. E
- Resolucion Miscelanea Fiscal 2025
