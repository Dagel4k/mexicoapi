// Salida legible de la CLI: texto en español, corto y sin adornos. Cada texto que viene de los
// datos, de la API o del catálogo de SEPOMEX pasa por enLinea: no puede partir una línea ni mover
// el cursor o cambiar los colores de la terminal.

import { AVISO_RESPALDO } from "../cliente/comun.js";
import {
  type Banco,
  type CodigoError,
  enLinea,
  type Municipio,
  type ResultadoDiasHabiles,
  type ResultadoValidacion,
  type SalarioMinimo,
  type TarifaIsr,
  type TipoPlazo,
  type Uma,
} from "../index.js";
import type { ResumenSepomex } from "../sepomex/index.js";

const ERRORES: Readonly<Record<CodigoError, string>> = {
  vacio: "el valor está vacío",
  longitud: "la longitud no es la correcta",
  caracteres: "tiene caracteres que no corresponden",
  estructura: "la estructura no es la correcta",
  fecha: "la fecha no es válida",
  entidad: "la entidad no existe",
  banco: "el banco no existe en el catálogo",
  digito_verificador: "el dígito verificador no coincide",
};

const escalar = (valor: unknown): string =>
  enLinea(
    valor !== null && typeof valor === "object"
      ? Object.entries(valor)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(", ")
      : String(valor),
  );

export function validacionTexto(
  nombre: string,
  femenino: boolean,
  r: ResultadoValidacion<unknown>,
): string {
  const adjetivo = `${r.valido ? "" : "no "}válid${femenino ? "a" : "o"}`;
  const lineas = [`${nombre} ${adjetivo}: ${enLinea(r.valor)}`];
  for (const codigo of r.errores) lineas.push(`  - ${ERRORES[codigo]}`);
  if (r.detalle !== null && typeof r.detalle === "object") {
    for (const [clave, valor] of Object.entries(r.detalle)) {
      lineas.push(`  ${clave}: ${valor === null ? "sin dato" : escalar(valor)}`);
    }
  }
  lineas.push(enLinea(r.nota));
  return lineas.join("\n");
}

/**
 * De dónde salió la respuesta. "La API no respondió" solo si el cliente avisó que usó el paquete
 * de respaldo: con --base, banco y municipio salen del paquete sin consultar la API.
 */
export function pieTexto(r: {
  origen: "api" | "paquete";
  advertencias: readonly string[];
}): string {
  const respaldo = r.advertencias.some((a) => a.startsWith(AVISO_RESPALDO));
  const origen =
    r.origen === "api"
      ? "Origen: API"
      : respaldo
        ? "Origen: datos del paquete (la API no respondió)"
        : "Origen: datos del paquete, sin red";
  return [`\n${origen}`, ...r.advertencias.map((a) => `Aviso: ${enLinea(a)}`)].join("\n");
}

export function diasHabilesTexto(
  r: { data: ResultadoDiasHabiles },
  tipoPlazo?: TipoPlazo | undefined,
): string {
  const { desde, dias, autoridad, resultado, inhabiles_saltados, advertencias } = r.data;
  const calendario = tipoPlazo === undefined ? autoridad : `${autoridad}, ${tipoPlazo}`;
  const lineas = [
    `${enLinea(desde)} + ${dias} días hábiles (${enLinea(calendario)}): ${enLinea(resultado)}`,
  ];
  if (inhabiles_saltados.length > 0) {
    lineas.push("Inhábiles saltados:");
    for (const d of inhabiles_saltados) lineas.push(`  ${enLinea(d.fecha)}  ${enLinea(d.motivo)}`);
  }
  for (const a of advertencias) lineas.push(`Aviso: ${enLinea(a)}`);
  return lineas.join("\n");
}

const fuenteTexto = (f: { nombre: string; fecha_publicacion: string }): string =>
  `Fuente: ${enLinea(f.nombre)} (DOF ${enLinea(f.fecha_publicacion)})`;

export function umaTexto(u: Uma, fecha?: string | undefined): string {
  const hasta = `${u.anio + 1}-01-31`;
  return [
    `${fecha === undefined ? "" : `UMA vigente el ${fecha}: `}UMA ${u.anio} (del ${enLinea(u.vigencia_desde)} al ${hasta})`,
    `  Diaria: ${enLinea(u.diaria)}`,
    `  Mensual: ${enLinea(u.mensual)}`,
    `  Anual: ${enLinea(u.anual)}`,
    fuenteTexto(u.fuente),
  ].join("\n");
}

const ZONAS: Readonly<Record<SalarioMinimo["zona"], string>> = {
  general: "general",
  zlfn: "Zona Libre de la Frontera Norte",
};

export function salarioMinimoTexto(anio: string, zonas: readonly SalarioMinimo[]): string {
  const lineas = [`Salario mínimo ${anio}, en pesos diarios:`];
  for (const s of zonas) {
    lineas.push(`  ${ZONAS[s.zona]}: ${enLinea(s.diario)} (desde el ${enLinea(s.vigencia_desde)})`);
  }
  const fuente = zonas[0]?.fuente;
  if (fuente !== undefined) lineas.push(fuenteTexto(fuente));
  return lineas.join("\n");
}

export function tarifaIsrTexto(t: TarifaIsr): string {
  const filas = [
    ["Límite inferior", "Límite superior", "Cuota fija", "% sobre excedente"],
    ...t.tramos.map((tramo) =>
      [
        tramo.limite_inferior,
        tramo.limite_superior ?? "En adelante",
        tramo.cuota_fija,
        tramo.tasa_excedente,
      ].map(enLinea),
    ),
  ];
  const anchos = filas[0]?.map((_, i) => Math.max(...filas.map((f) => (f[i] as string).length)));
  const lineas = filas.map((fila) =>
    `  ${fila.map((celda, i) => celda.padStart(anchos?.[i] ?? 0)).join("  ")}`.trimEnd(),
  );
  const titulo = `Tarifa ${enLinea(t.periodo)} de ISR ${t.anio}, en pesos:`;
  return [titulo, ...lineas, fuenteTexto(t.fuente)].join("\n");
}

export function municipioTexto(m: Municipio, estado: string | undefined): string {
  const entidad = estado === undefined ? `entidad ${enLinea(m.cve_ent)}` : enLinea(estado);
  return `${enLinea(m.cvegeo)}  ${enLinea(m.nombre)}, ${entidad}`;
}

export function municipiosTexto(
  texto: string,
  encontrados: readonly Municipio[],
  maximo: number,
  estado: (cve_ent: string) => string | undefined,
): string {
  if (encontrados.length === 0) return `Sin municipios que coincidan con "${enLinea(texto)}".`;
  const lineas = encontrados.slice(0, maximo).map((m) => municipioTexto(m, estado(m.cve_ent)));
  if (encontrados.length > maximo) {
    lineas.push(`... y ${encontrados.length - maximo} más; afina la búsqueda o usa --json.`);
  }
  return lineas.join("\n");
}

export function bancoTexto(b: Banco): string {
  const baja = b.baja_detectada === null ? "sin fecha" : enLinea(b.baja_detectada);
  const lineas = [
    `${enLinea(b.codigo)}  ${enLinea(b.nombre_corto)}`,
    `  Razón social: ${b.razon_social === null ? "sin dato" : enLinea(b.razon_social)}`,
    `  Tipo: ${enLinea(b.tipo)}`,
    `  Código SPEI: ${enLinea(b.codigo_spei)}`,
    `  Situación: ${b.activo ? "activo" : `dado de baja (detectado ${baja})`}`,
  ];
  return lineas.join("\n");
}

export function resumenSepomexTexto(s: ResumenSepomex): string {
  const lineas = [
    `Directorio: ${enLinea(s.dir)}`,
    `Guardado: ${enLinea(s.descargado)} (${enLinea(s.origen)})`,
    `Fuente: ${enLinea(s.fuente)}`,
    `Información de Correos de México al: ${s.as_of === null ? "sin dato" : enLinea(s.as_of)}`,
    `Filas: ${s.filas}; códigos postales: ${s.codigos_postales}; municipios: ${s.municipios}`,
    `Sin municipio de INEGI: ${s.sin_municipio_inegi}`,
    `SQLite: ${s.sqlite === null ? `no (${s.sin_sqlite === null ? "sin dato" : enLinea(s.sin_sqlite)})` : enLinea(s.sqlite)}`,
    ...s.advertencias.map((a) => `Aviso: ${enLinea(a)}`),
    enLinea(s.nota),
  ];
  return lineas.join("\n");
}
