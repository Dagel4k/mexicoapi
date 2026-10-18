import type {
  DiaInhabilCurado,
  FuenteDof,
  SalarioMinimo,
  TarifaIsr,
  TramoIsr,
  Uma,
} from "@mexicoapi/core";

// Valores y fragmentos tal como se publicaron en el DOF (consultados el 2026-10-17).

const LICENCIA_DOF = `    licencia: "Texto oficial publicado en el DOF; no es objeto de derecho de autor (LFDA art. 14, fracción VIII)"
    licencia_url: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf`;
const LICENCIA_INEGI = `    licencia: "Términos de libre uso de la información del INEGI"
    licencia_url: https://www.inegi.org.mx/inegi/terminos.html`;

const FRAGMENTO_UMA_2025 =
  "[...] es de $113.14 pesos mexicanos, el mensual es de $3,439.46 pesos mexicanos y el valor anual $41,273.52 pesos mexicanos, los cuales estarán vigentes a partir del 1º de febrero de 2025.";
const FRAGMENTO_UMA_2026 =
  "[...] es de $117.31 pesos mexicanos, el mensual es de $3,566.22 pesos mexicanos y el valor anual $42,794.64 pesos mexicanos, los cuales estarán vigentes a partir del 1º de febrero de 2026.";

export const YAML_UMA = `dataset: constantes.uma
fuentes:
  uma-2026:
    nombre: "INEGI. Unidad de medida y actualización"
    url: https://dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09/01/2026
    fecha_publicacion: 2026-01-09
    fragmento: "${FRAGMENTO_UMA_2026}"
${LICENCIA_INEGI}
  uma-2025:
    nombre: "INEGI. Unidad de medida y actualización"
    url: https://dof.gob.mx/nota_detalle.php?codigo=5746930&fecha=10/01/2025
    fecha_publicacion: 2025-01-10
    fragmento: "${FRAGMENTO_UMA_2025}"
${LICENCIA_INEGI}
registros:
  - anio: 2026
    diaria: "117.31"
    mensual: "3566.22"
    anual: "42794.64"
    vigencia_desde: 2026-02-01
    fuente: uma-2026
  - anio: 2025
    diaria: "113.14"
    mensual: "3439.46"
    anual: "41273.52"
    vigencia_desde: 2025-02-01
    fuente: uma-2025
`;

const FRAGMENTO_SM_2026 =
  "Los salarios mínimos generales que tendrán vigencia a partir del 1º de enero de 2026, reflejan un incremento de la siguiente manera: · En 13.0% en la Zona del Salario Mínimo General (ZSMG), con lo que será de 315.04 pesos por jornada diaria de trabajo; que se compone de 17.01 pesos de MIR más un aumento por fijación de 6.5%. · En 5.0% en la Zona Libre de la Frontera Norte (ZLFN), con lo que será de 440.87 pesos por jornada diaria de trabajo. En este caso no se aplica el MIR.";
const FRAGMENTO_SM_2025 =
  "Los salarios mínimos generales que tendrán vigencia a partir del 1º de enero de 2025, se incrementarán en 12% en las dos zonas descritas en el primer resolutivo, por tanto, serán de 419.88 pesos diarios por jornada diaria de trabajo en el área geográfica de la Zona Libre de la Frontera Norte (ZLFN), [...] y para La Zona del Salario Mínimo General (ZSMG) el salario mínimo será de 278.80 pesos diarios, por jornada diaria de trabajo [...]";

export const YAML_SALARIO = `dataset: constantes.salario-minimo
fuentes:
  sm-2025:
    nombre: "Resolución del H. Consejo de Representantes de la Comisión Nacional de los Salarios Mínimos que fija los salarios mínimos general y profesionales vigentes a partir del 1 de enero de 2025"
    url: https://dof.gob.mx/nota_detalle.php?codigo=5745678&fecha=19/12/2024
    fecha_publicacion: 2024-12-19
    fragmento: "${FRAGMENTO_SM_2025}"
${LICENCIA_DOF}
  sm-2026:
    nombre: "Resolución del H. Consejo de Representantes de la Comisión Nacional de los Salarios Mínimos que fija los salarios mínimos general y profesionales que habrán de regir a partir del 1 de enero de 2026"
    url: https://dof.gob.mx/nota_detalle.php?codigo=5775534&fecha=09/12/2025
    fecha_publicacion: 2025-12-09
    fragmento: "${FRAGMENTO_SM_2026}"
${LICENCIA_DOF}
registros:
  - { anio: 2026, zona: zlfn, diario: "440.87", vigencia_desde: 2026-01-01, fuente: sm-2026 }
  - { anio: 2026, zona: general, diario: "315.04", vigencia_desde: 2026-01-01, fuente: sm-2026 }
  - { anio: 2025, zona: general, diario: "278.80", vigencia_desde: 2025-01-01, fuente: sm-2025 }
  - { anio: 2025, zona: zlfn, diario: "419.88", vigencia_desde: 2025-01-01, fuente: sm-2025 }
`;

const URL_ANEXO_8 = "https://dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025";

/** Filas "inferior|superior|cuota|tasa" tal como el Anexo 8 de la RMF 2026 (con comas de miles). */
const TARIFA_MENSUAL_2026 = `0.01|844.59|0.00|1.92
844.60|7,168.51|16.22|6.40
7,168.52|12,598.02|420.95|10.88
12,598.03|14,644.64|1,011.68|16.00
14,644.65|17,533.64|1,339.14|17.92
17,533.65|35,362.83|1,856.84|21.36
35,362.84|55,736.68|5,665.16|23.52
55,736.69|106,410.50|10,457.09|30.00
106,410.51|141,880.66|25,659.23|32.00
141,880.67|425,641.99|37,009.69|34.00
425,642.00|En adelante|133,488.54|35.00`;

// La cuota fija del primer renglón se publicó como "0", sin decimales.
const TARIFA_ANUAL_2026 = `0.01|10,135.11|0|1.92
10,135.12|86,022.11|194.59|6.40
86,022.12|151,176.19|5,051.37|10.88
151,176.20|175,735.66|12,140.13|16.00
175,735.67|210,403.69|16,069.64|17.92
210,403.70|424,353.97|22,282.14|21.36
424,353.98|668,840.14|67,981.92|23.52
668,840.15|1,276,925.98|125,485.07|30.00
1,276,925.99|1,702,567.97|307,910.81|32.00
1,702,567.98|5,107,703.92|444,116.23|34.00
5,107,703.93|En adelante|1,601,862.46|35.00`;

const TARIFA_ANUAL_2025 = `0.01|8,952.49|0.00|1.92
8,952.50|75,984.55|171.88|6.40
75,984.56|133,536.07|4,461.94|10.88
133,536.08|155,229.80|10,723.55|16.00
155,229.81|185,852.57|14,194.54|17.92
185,852.58|374,837.88|19,682.13|21.36
374,837.89|590,795.99|60,049.40|23.52
590,796.00|1,127,926.84|110,842.74|30.00
1,127,926.85|1,503,902.46|271,981.99|32.00
1,503,902.47|4,511,707.37|392,294.17|34.00
4,511,707.38|En adelante|1,414,947.85|35.00`;

/** Quita las comas de miles y completa "0" a "0.00", como se capturan en el YAML. */
function monto(publicado: string): string {
  const sinComas = publicado.replaceAll(",", "");
  return sinComas.includes(".") ? sinComas : `${sinComas}.00`;
}

function tramos(tabla: string): TramoIsr[] {
  return tabla.split("\n").map((linea) => {
    const [inferior, superior, cuota, tasa] = linea.split("|") as [string, string, string, string];
    return {
      limite_inferior: monto(inferior),
      limite_superior: superior === "En adelante" ? null : monto(superior),
      cuota_fija: monto(cuota),
      tasa_excedente: tasa,
    };
  });
}

const FUENTE_ANEXO_8_MENSUAL: FuenteDof = {
  nombre: "Anexo 8 de la Resolución Miscelánea Fiscal para 2026",
  url: URL_ANEXO_8,
  fecha_publicacion: "2025-12-28",
  fragmento:
    "V. Tarifa aplicable durante 2026 para el cálculo de los pagos provisionales mensuales a que se refieren los artículos 96 de la Ley del ISR y 175 de su Reglamento, así como la regla 3.12.2.",
};
const FUENTE_ANEXO_8_ANUAL: FuenteDof = {
  ...FUENTE_ANEXO_8_MENSUAL,
  fragmento:
    "II. Tarifa para el cálculo del impuesto correspondiente al ejercicio de 2026 a que se refieren los artículos 97 y 152 de la Ley del ISR, así como la regla 3.17.1.",
};

export const TARIFAS_OFICIALES: TarifaIsr[] = [
  // Del apartado C, fracción I; aquí solo importan los tramos, no el fragmento.
  { anio: 2025, periodo: "anual", tramos: tramos(TARIFA_ANUAL_2025), fuente: FUENTE_ANEXO_8_ANUAL },
  { anio: 2026, periodo: "anual", tramos: tramos(TARIFA_ANUAL_2026), fuente: FUENTE_ANEXO_8_ANUAL },
  {
    anio: 2026,
    periodo: "mensual",
    tramos: tramos(TARIFA_MENSUAL_2026),
    fuente: FUENTE_ANEXO_8_MENSUAL,
  },
];

function yamlTramos(tabla: string): string {
  return tramos(tabla)
    .map(
      (t) =>
        `      - { limite_inferior: "${t.limite_inferior}", limite_superior: ${t.limite_superior === null ? "null" : `"${t.limite_superior}"`}, cuota_fija: "${t.cuota_fija}", tasa_excedente: "${t.tasa_excedente}" }`,
    )
    .join("\n");
}

export const YAML_ISR = `dataset: isr.tarifas
fuentes:
  anexo-8-mensual-2026:
    nombre: "${FUENTE_ANEXO_8_MENSUAL.nombre}"
    url: ${URL_ANEXO_8}
    fecha_publicacion: 2025-12-28
    fragmento: "${FUENTE_ANEXO_8_MENSUAL.fragmento}"
${LICENCIA_DOF}
  anexo-8-anual-2026:
    nombre: "${FUENTE_ANEXO_8_ANUAL.nombre}"
    url: ${URL_ANEXO_8}
    fecha_publicacion: 2025-12-28
    fragmento: "${FUENTE_ANEXO_8_ANUAL.fragmento}"
${LICENCIA_DOF}
registros:
  - anio: 2026
    periodo: mensual
    tramos:
${yamlTramos(TARIFA_MENSUAL_2026)}
    fuente: anexo-8-mensual-2026
  - anio: 2026
    periodo: anual
    tramos:
${yamlTramos(TARIFA_ANUAL_2026)}
    fuente: anexo-8-anual-2026
`;

const FRAGMENTO_CNBV_2026 =
  "Artículo 1.- Las instituciones de crédito, casas de bolsa, bolsas de valores, [...] e instituciones de tecnología financiera deberán cerrar sus puertas y suspender sus operaciones en los Estados Unidos Mexicanos, los siguientes días del año 2026: I. El 1o. de enero. II. El primer lunes de febrero en conmemoración del 5 de febrero. III. El tercer lunes de marzo en conmemoración del 21 de marzo. IV. El 2 y 3 de abril. V. El 1o. de mayo. VI. El 16 de septiembre. VII. El 2 de noviembre y el tercer lunes de dicho mes, este último en conmemoración del 20 de noviembre. VIII. El 12 y 25 de diciembre. IX. Los sábados y domingos.";

export const YAML_CNBV = `dataset: dias-inhabiles.cnbv
cobertura:
  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }
fuentes:
  cnbv-2026:
    nombre: "Disposiciones de carácter general que señalan los días del año 2026 en que las entidades financieras sujetas a la supervisión de la Comisión Nacional Bancaria y de Valores deberán cerrar sus puertas y suspender sus operaciones"
    url: https://dof.gob.mx/nota_detalle.php?codigo=5775684&fecha=10/12/2025
    fecha_publicacion: 2025-12-10
    fragmento: "${FRAGMENTO_CNBV_2026}"
${LICENCIA_DOF}
registros:
  - { fecha: 2026-01-01, autoridad: cnbv, motivo: "1o. de enero", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-02-02, autoridad: cnbv, motivo: "Primer lunes de febrero, en conmemoración del 5 de febrero", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-03-16, autoridad: cnbv, motivo: "Tercer lunes de marzo, en conmemoración del 21 de marzo", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-04-02, autoridad: cnbv, motivo: "2 de abril", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-04-03, autoridad: cnbv, motivo: "3 de abril", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-05-01, autoridad: cnbv, motivo: "1o. de mayo", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-09-16, autoridad: cnbv, motivo: "16 de septiembre", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-11-02, autoridad: cnbv, motivo: "2 de noviembre", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-11-16, autoridad: cnbv, motivo: "Tercer lunes de noviembre, en conmemoración del 20 de noviembre", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-12-12, autoridad: cnbv, motivo: "12 de diciembre", tipo: descanso, fuente: cnbv-2026 }
  - { fecha: 2026-12-25, autoridad: cnbv, motivo: "25 de diciembre", tipo: descanso, fuente: cnbv-2026 }
`;

const FRAGMENTO_CFF_12 =
  "Artículo 12. En los plazos fijados en días no se contarán los sábados, los domingos ni el 1o. de enero; el primer lunes de febrero en conmemoración del 5 de febrero; el tercer lunes de marzo en conmemoración del 21 de marzo; el 1o. y 5 de mayo; el 16 de septiembre; el tercer lunes de noviembre en conmemoración del 20 de noviembre; el 1o. de diciembre de cada 6 años, cuando corresponda a la transmisión del Poder Ejecutivo y el 25 de diciembre.";

export const YAML_SAT = `dataset: dias-inhabiles.sat
cobertura:
  descanso: { desde: 2026-01-01, hasta: 2026-12-31 }
  vacaciones: { desde: 2026-01-01, hasta: 2026-11-30 }
fuentes:
  cff-12:
    nombre: "Código Fiscal de la Federación, artículo 12"
    url: https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
    fecha_publicacion: 2026-04-09
    fragmento: "${FRAGMENTO_CFF_12}"
${LICENCIA_DOF}
  rmf-2026-2.1.6-i:
    nombre: "Resolución Miscelánea Fiscal para 2026"
    url: https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28/12/2025
    fecha_publicacion: 2025-12-28
    fragmento: "I. El segundo periodo general de vacaciones de 2025, comprende del 18 de diciembre de 2025 al 2 de enero de 2026."
${LICENCIA_DOF}
  rmf-2026-2.1.6-ii:
    nombre: "Resolución Miscelánea Fiscal para 2026"
    url: https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28/12/2025
    fecha_publicacion: 2025-12-28
    fragmento: "II. Son días inhábiles para el SAT el 2 y 3 de abril de 2026."
${LICENCIA_DOF}
  primera-rm-2026:
    nombre: "Primera Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2026"
    url: https://dof.gob.mx/nota_detalle.php?codigo=5793101&fecha=09/07/2026
    fecha_publicacion: 2026-07-09
    fragmento: "III. El primer periodo general de vacaciones de 2026, comprende del 20 al 31 de julio de 2026."
${LICENCIA_DOF}
registros:
  - { fecha: 2026-01-01, autoridad: sat, motivo: "1o. de enero", tipo: descanso, fuente: cff-12 }
  - { fecha: 2026-01-02, autoridad: sat, motivo: "Segundo periodo general de vacaciones de 2025", tipo: vacaciones, fuente: rmf-2026-2.1.6-i }
  - { fecha: 2026-02-02, autoridad: sat, motivo: "Primer lunes de febrero, en conmemoración del 5 de febrero", tipo: descanso, fuente: cff-12 }
  - { fecha: 2026-04-02, autoridad: sat, motivo: "Día inhábil para el SAT", tipo: vacaciones, fuente: rmf-2026-2.1.6-ii }
  - { fecha: 2026-04-03, autoridad: sat, motivo: "Día inhábil para el SAT", tipo: vacaciones, fuente: rmf-2026-2.1.6-ii }
  - { fecha: 2026-07-20, autoridad: sat, motivo: "Primer periodo general de vacaciones de 2026", tipo: vacaciones, fuente: primera-rm-2026 }
  - { fecha: 2026-11-16, autoridad: sat, motivo: "Tercer lunes de noviembre, en conmemoración del 20 de noviembre", tipo: descanso, fuente: cff-12 }
  - { fecha: 2026-12-25, autoridad: sat, motivo: "25 de diciembre", tipo: descanso, fuente: cff-12 }
`;

/** UMA 2017-2026 tal como el INEGI las publicó en el DOF. */
const UMA_PUBLICADAS: [number, string, string, string, string][] = [
  [2017, "75.49", "2,294.90", "27,538.80", "2017-01-10"],
  [2018, "80.60", "2,450.24", "29,402.88", "2018-01-10"],
  [2019, "84.49", "2,568.50", "30,822.00", "2019-01-10"],
  [2020, "86.88", "2,641.15", "31,693.80", "2020-01-10"],
  [2021, "89.62", "2,724.45", "32,693.40", "2021-01-08"],
  [2022, "96.22", "2,925.09", "35,101.08", "2022-01-10"],
  [2023, "103.74", "3,153.70", "37,844.40", "2023-01-10"],
  [2024, "108.57", "3,300.53", "39,606.36", "2024-01-10"],
  [2025, "113.14", "3,439.46", "41,273.52", "2025-01-10"],
  [2026, "117.31", "3,566.22", "42,794.64", "2026-01-09"],
];

export const UMA_OFICIALES: Uma[] = UMA_PUBLICADAS.map(([anio, d, m, a, fecha]) => ({
  anio,
  diaria: monto(d),
  mensual: monto(m),
  anual: monto(a),
  vigencia_desde: `${anio}-02-01`,
  fuente: {
    nombre: "INEGI. Unidad de medida y actualización",
    url: "https://dof.gob.mx/",
    fecha_publicacion: fecha,
    // Así lo dice cada nota desde 2018 (la de 2017 usa otra redacción con las mismas cifras).
    fragmento: `es de $${d} pesos mexicanos, el mensual es de $${m} pesos mexicanos y el valor anual $${a} pesos mexicanos`,
  },
}));

/** Salario mínimo diario 2019-2026: general, ZLFN y fecha del DOF. */
const SALARIOS_PUBLICADOS: [number, string, string, string][] = [
  [2019, "102.68", "176.72", "2018-12-26"],
  [2020, "123.22", "185.56", "2019-12-23"],
  [2021, "141.70", "213.39", "2020-12-23"],
  [2022, "172.87", "260.34", "2021-12-08"],
  [2023, "207.44", "312.41", "2022-12-07"],
  [2024, "248.93", "374.89", "2023-12-12"],
  [2025, "278.80", "419.88", "2024-12-19"],
  [2026, "315.04", "440.87", "2025-12-09"],
];

export const SALARIOS_OFICIALES: SalarioMinimo[] = SALARIOS_PUBLICADOS.flatMap(
  ([anio, general, zlfn, fecha]) => {
    const fuente: FuenteDof = {
      nombre: "Resolución de la Comisión Nacional de los Salarios Mínimos",
      url: "https://dof.gob.mx/",
      fecha_publicacion: fecha,
      // Fragmento abreviado con las cifras publicadas; el literal completo va en el YAML de datos.
      fragmento: `serán de ${zlfn} pesos diarios [...] en la Zona Libre de la Frontera Norte [...] el salario mínimo general será de ${general} pesos diarios`,
    };
    return [
      { anio, zona: "general", diario: general, vigencia_desde: `${anio}-01-01`, fuente },
      { anio, zona: "zlfn", diario: zlfn, vigencia_desde: `${anio}-01-01`, fuente },
    ];
  },
);

const FUENTE_CNBV: FuenteDof = {
  nombre: "Disposiciones de la CNBV",
  url: "https://dof.gob.mx/",
  fecha_publicacion: "2024-12-27",
  fragmento: "Artículo 1.- [...]",
};

/** Días de la CNBV para 2025 y 2026; las fechas de regla calculadas a mano. */
export const DIAS_CNBV_OFICIALES: DiaInhabilCurado[] = (
  [
    ["2025-01-01", "1o. de enero"],
    ["2025-02-03", "Primer lunes de febrero, en conmemoración del 5 de febrero"],
    ["2025-03-17", "Tercer lunes de marzo, en conmemoración del 21 de marzo"],
    ["2025-04-17", "17 de abril"],
    ["2025-04-18", "18 de abril"],
    ["2025-05-01", "1o. de mayo"],
    ["2025-09-16", "16 de septiembre"],
    ["2025-11-02", "2 de noviembre"],
    ["2025-11-17", "Tercer lunes de noviembre, en conmemoración del 20 de noviembre"],
    ["2025-12-12", "12 de diciembre"],
    ["2025-12-25", "25 de diciembre"],
    ["2026-01-01", "1o. de enero"],
    ["2026-02-02", "Primer lunes de febrero, en conmemoración del 5 de febrero"],
    ["2026-03-16", "Tercer lunes de marzo, en conmemoración del 21 de marzo"],
    ["2026-04-02", "2 de abril"],
    ["2026-04-03", "3 de abril"],
    ["2026-05-01", "1o. de mayo"],
    ["2026-09-16", "16 de septiembre"],
    ["2026-11-02", "2 de noviembre"],
    ["2026-11-16", "Tercer lunes de noviembre, en conmemoración del 20 de noviembre"],
    ["2026-12-12", "12 de diciembre"],
    ["2026-12-25", "25 de diciembre"],
  ] as const
).map(([fecha, motivo]) => ({
  fecha,
  autoridad: "cnbv",
  motivo,
  tipo: "descanso",
  fuente: FUENTE_CNBV,
}));
