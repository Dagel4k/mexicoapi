// Datos curados de prueba con la forma que escribe el build: el meta interno con `curados`,
// los calendarios de la CNBV y el SAT, y la lista de la UMA. Las fechas y los valores son los
// publicados en el DOF; los fragmentos de la RMF y la CNBV están recortados. Los días del art.
// 12 del CFF que trae el shard del SAT son los de la regla del núcleo, tal cual.
import { diasDescansoCff, FUENTE_CFF_12 } from "@mexicoapi/core";
import type { AssetFalso } from "./ayudas.js";

export const DOCS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs";

const LICENCIA_DOF = {
  license:
    "Texto oficial publicado en el DOF; no es objeto de derecho de autor (LFDA art. 14, fracción VIII)",
  license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
};

export const META_CNBV = {
  dataset: "dias-inhabiles.cnbv",
  as_of: "2025-12-10",
  sources: [
    {
      name: "Disposiciones de la CNBV para 2026",
      url: "https://dof.gob.mx/nota_detalle.php?codigo=5775684&fecha=10/12/2025",
      ...LICENCIA_DOF,
      citation: "Disposiciones de la CNBV para 2026. Diario Oficial de la Federación, 10/12/2025.",
    },
  ],
  docs: `${DOCS}/datos/dias-inhabiles-cnbv.md`,
};

export const META_SAT = {
  dataset: "dias-inhabiles.sat",
  as_of: "2026-07-09",
  sources: [
    {
      name: "Resolución Miscelánea Fiscal para 2026",
      url: "https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28/12/2025",
      ...LICENCIA_DOF,
      citation:
        "Resolución Miscelánea Fiscal para 2026. Diario Oficial de la Federación, 28/12/2025.",
    },
    {
      name: "Código Fiscal de la Federación, artículo 12",
      url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf",
      ...LICENCIA_DOF,
      citation: "Código Fiscal de la Federación, artículo 12.",
    },
  ],
  docs: `${DOCS}/datos/dias-inhabiles-sat.md`,
};

export const META_UMA = {
  dataset: "constantes.uma",
  as_of: "2026-01-09",
  sources: [
    {
      name: "INEGI. Unidad de medida y actualización",
      url: "https://dof.gob.mx/nota_detalle.php?codigo=5776510&fecha=09/01/2026",
      license: "Términos de libre uso de la información del INEGI",
      license_url: "https://www.inegi.org.mx/inegi/terminos.html",
      citation:
        "INEGI. Unidad de medida y actualización. Diario Oficial de la Federación, 09/01/2026.",
    },
  ],
  docs: `${DOCS}/datos/constantes-uma.md`,
};

const curado = <M>(meta: M, records: number) => ({
  meta,
  records,
  data_sha256: "c".repeat(64),
});

/** Meta interno del build: los automáticos no hacen falta para estas rutas. */
export const INTERNA_CURADOS = {
  datasets: {},
  curados: {
    "dias-inhabiles.cnbv": curado(META_CNBV, 3),
    "dias-inhabiles.sat": curado(META_SAT, 18),
    "constantes.uma": curado(META_UMA, 3),
  },
};

const fuente = (nombre: string, url: string, fecha_publicacion: string, fragmento: string) => ({
  nombre,
  url,
  fecha_publicacion,
  fragmento,
});

export const FUENTE_CFF = { ...FUENTE_CFF_12 };
const FUENTE_RMF = fuente(
  "Resolución Miscelánea Fiscal para 2026",
  "https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28/12/2025",
  "2025-12-28",
  "2.1.6. [...] se consideran días inhábiles [...] el 2 y 3 de abril de 2026.",
);
const FUENTE_RMF_1 = fuente(
  "Primera Resolución de Modificaciones a la Resolución Miscelánea Fiscal para 2026",
  "https://dof.gob.mx/nota_detalle.php?codigo=5793101&fecha=09/07/2026",
  "2026-07-09",
  "2.1.6. [...] el primer periodo general de vacaciones comprende del 20 al 31 de julio de 2026.",
);
export const FUENTE_CNBV_2025 = fuente(
  "Disposiciones de la CNBV para 2025",
  "https://dof.gob.mx/nota_detalle.php?codigo=5746258&fecha=27/12/2024",
  "2024-12-27",
  "Artículo 1.- [...] los siguientes días del año 2025: [...] IX. Los sábados y domingos.",
);
export const FUENTE_CNBV = fuente(
  "Disposiciones de la CNBV para 2026",
  "https://dof.gob.mx/nota_detalle.php?codigo=5775684&fecha=10/12/2025",
  "2025-12-10",
  "Artículo 1.- [...] IX. Los sábados y domingos.",
);

const dia = (fecha: string, motivo: string, tipo: string, f: ReturnType<typeof fuente>) => ({
  fecha,
  motivo,
  tipo,
  fuente: f,
});

const PRIMER_PERIODO = Array.from({ length: 12 }, (_, i) =>
  dia(
    `2026-07-${20 + i}`,
    "Primer periodo general de vacaciones de 2026",
    "vacaciones",
    FUENTE_RMF_1,
  ),
);

export const DIAS_SAT = [
  dia("2026-01-01", "1o. de enero", "descanso", FUENTE_CFF),
  dia("2026-04-02", "Día inhábil para el SAT", "vacaciones", FUENTE_RMF),
  dia("2026-04-03", "Día inhábil para el SAT", "vacaciones", FUENTE_RMF),
  ...PRIMER_PERIODO,
  dia(
    "2026-11-16",
    "Tercer lunes de noviembre, en conmemoración del 20 de noviembre",
    "descanso",
    FUENTE_CFF,
  ),
  dia("2026-12-25", "25 de diciembre", "descanso", FUENTE_CFF),
];

/** Los días del art. 12 de los años de `desde` a `hasta`, como los da la regla, en JSON. */
export const diasDelCff = (desde: number, hasta: number) =>
  Array.from({ length: hasta - desde + 1 }, (_, i) => diasDescansoCff(desde + i))
    .flat()
    .map((d) => ({ ...d, fuente: { ...d.fuente } }));

/** Lo que el calendario del SAT tiene en `dias`: la regla de 2026 a 2100 y las vacaciones. */
export const DIAS_CALENDARIO_SAT = [
  ...diasDelCff(2026, 2100),
  ...DIAS_SAT.filter((d) => d.tipo === "vacaciones"),
].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

/**
 * El SAT 2026: las vacaciones están completas hasta el 30 de noviembre; los días del art. 12 los
 * da la regla hasta 2100, y ella cita los fines de semana.
 */
export const SHARD_SAT = {
  autoridad: "sat",
  plazos: {
    general: { cobertura: { desde: "2026-01-01", hasta: "2026-11-30" }, excluir_tipos: [] },
    declaraciones_pagos: {
      cobertura: { desde: "2026-01-01", hasta: "2100-12-31" },
      excluir_tipos: ["vacaciones"],
    },
  },
  fuentes_fin_de_semana: {},
  dias: DIAS_SAT,
};

export const DIAS_CNBV = [
  dia("2025-12-12", "12 de diciembre", "descanso", FUENTE_CNBV_2025),
  dia("2026-11-02", "2 de noviembre", "descanso", FUENTE_CNBV),
  dia("2026-12-12", "12 de diciembre", "descanso", FUENTE_CNBV),
];

export const SHARD_CNBV = {
  autoridad: "cnbv",
  plazos: {
    general: { cobertura: { desde: "2025-01-01", hasta: "2026-12-31" }, excluir_tipos: [] },
  },
  fuentes_fin_de_semana: { 2025: FUENTE_CNBV_2025, 2026: FUENTE_CNBV },
  dias: DIAS_CNBV,
};

const uma = (anio: number, diaria: string, mensual: string, anual: string) => ({
  anio,
  diaria,
  mensual,
  anual,
  vigencia_desde: `${anio}-02-01`,
  fuente: fuente(
    "INEGI. Unidad de medida y actualización",
    "https://dof.gob.mx/",
    `${anio}-01-09`,
    `[...] el valor diario de la Unidad de Medida y Actualización es de $${diaria} pesos mexicanos [...]`,
  ),
});

export const UMAS = [
  uma(2024, "108.57", "3300.53", "39606.36"),
  uma(2025, "113.14", "3439.46", "41273.52"),
  uma(2026, "117.31", "3566.22", "42794.64"),
];

export const LISTA_UMA = { data: UMAS, meta: META_UMA };

export const RUTA_META = "/v1/_internos/meta.json";
export const RUTA_CNBV = "/v1/_internos/calendarios/cnbv.json";
export const RUTA_SAT = "/v1/_internos/calendarios/sat.json";
export const RUTA_UMA = "/v1/constantes/uma.json";

/** Mapa de ASSETS: cada ruta con su cuerpo (un texto se manda tal cual). */
export function assetsCurados(
  cambios: Record<string, unknown> = {},
  estados: Record<string, number> = {},
): Record<string, AssetFalso> {
  const cuerpos: Record<string, unknown> = {
    [RUTA_META]: INTERNA_CURADOS,
    [RUTA_CNBV]: SHARD_CNBV,
    [RUTA_SAT]: SHARD_SAT,
    [RUTA_UMA]: LISTA_UMA,
    ...cambios,
  };
  const mapa: Record<string, AssetFalso> = {};
  for (const [ruta, cuerpo] of Object.entries(cuerpos)) {
    if (cuerpo === undefined) continue;
    mapa[ruta] = {
      cuerpo: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
      ...(estados[ruta] === undefined ? {} : { status: estados[ruta] }),
    };
  }
  return mapa;
}
