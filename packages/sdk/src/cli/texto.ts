// Salida legible de la CLI: texto en español, corto y sin adornos. Cada texto que viene de los
// datos, de la API o del catálogo de SEPOMEX pasa por aUnaLinea: no puede partir una línea ni mover
// el cursor o cambiar los colores de la terminal.

import { AVISO_RESPALDO } from "../cliente/comun.js";
import {
  aUnaLinea,
  type Banco,
  type CodigoError,
  type Estado,
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
  aUnaLinea(
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
  const lineas = [`${nombre} ${adjetivo}: ${aUnaLinea(r.valor)}`];
  for (const codigo of r.errores) lineas.push(`  - ${ERRORES[codigo]}`);
  if (r.detalle !== null && typeof r.detalle === "object") {
    for (const [clave, valor] of Object.entries(r.detalle)) {
      lineas.push(`  ${clave}: ${valor === null ? "sin dato" : escalar(valor)}`);
    }
  }
  lineas.push(aUnaLinea(r.nota));
  return lineas.join("\n");
}

/**
 * Un texto de la API con los nombres de las opciones de la CLI: `tipo_plazo=general` es
 * `--tipo-plazo general` y `permitir_incompleto=true`, `--permitir-incompleto`.
 */
export const conNombresCli = (texto: string): string =>
  texto
    .replace(/\bpermitir_incompleto=true\b/g, "--permitir-incompleto")
    .replace(/\btipo_plazo=(\w+)/g, "--tipo-plazo $1")
    .replace(/\b(operacion|publicado)=(\d{4}-\d{2}-\d{2})\b/g, "--$1 $2");

/** La línea de la fuente de un dataset, la primera de su `meta`, si la trae. */
function fuenteDeMeta(meta: { sources?: unknown } | undefined): string[] {
  const primera: unknown = Array.isArray(meta?.sources) ? meta.sources[0] : undefined;
  const { name, url } = (primera ?? {}) as { name?: unknown; url?: unknown };
  if (typeof name !== "string") return [];
  return [`Fuente: ${aUnaLinea(name)}${typeof url === "string" ? ` (${aUnaLinea(url)})` : ""}`];
}

/** Cómo se pidió el FIX: el publicado un día, el de una operación o el más reciente. */
export type ConsultaFix =
  | { publicado: string }
  | { operacion: string }
  | { ultimo: true; origen: "api" | "paquete" };

export function fixTexto(
  r: {
    data: { fecha_publicacion: string; valor: string; fundamento?: { nombre: string } };
    meta?: { sources?: unknown };
  },
  consulta: ConsultaFix,
): string {
  const valor = aUnaLinea(r.data.valor);
  const publicado = aUnaLinea(r.data.fecha_publicacion);
  const linea =
    "publicado" in consulta
      ? `FIX publicado en el DOF el ${publicado}: ${valor} pesos por dólar`
      : "operacion" in consulta
        ? `FIX para una operación del ${consulta.operacion}: ${valor} pesos por dólar, el publicado en el DOF el ${publicado} (CFF, artículo 20)`
        : `${consulta.origen === "paquete" ? "Publicación más reciente del FIX en los datos del paquete" : "Última publicación del FIX"}: ${valor} pesos por dólar, en el DOF del ${publicado}`;
  const fundamento = r.data.fundamento?.nombre;
  return [
    linea,
    ...fuenteDeMeta(r.meta),
    ...(typeof fundamento === "string" ? [`Fundamento: ${aUnaLinea(fundamento)}`] : []),
  ].join("\n");
}

export function udiTexto(r: {
  data: { fecha: string; valor: string };
  meta?: { sources?: unknown };
}): string {
  const linea = `UDI del ${aUnaLinea(r.data.fecha)}: ${aUnaLinea(r.data.valor)} pesos`;
  return [linea, ...fuenteDeMeta(r.meta)].join("\n");
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
  return [`\n${origen}`, ...r.advertencias.map((a) => `Aviso: ${aUnaLinea(a)}`)].join("\n");
}

export function diasHabilesTexto(
  r: { data: ResultadoDiasHabiles },
  tipoPlazo?: TipoPlazo | undefined,
): string {
  const { desde, dias, autoridad, resultado, inhabiles_saltados, advertencias } = r.data;
  const calendario = tipoPlazo === undefined ? autoridad : `${autoridad}, ${tipoPlazo}`;
  const lineas = [
    `${aUnaLinea(desde)} + ${dias} días hábiles (${aUnaLinea(calendario)}): ${aUnaLinea(resultado)}`,
  ];
  if (inhabiles_saltados.length > 0) {
    lineas.push("Inhábiles saltados:");
    for (const d of inhabiles_saltados)
      lineas.push(`  ${aUnaLinea(d.fecha)}  ${aUnaLinea(d.motivo)}`);
  }
  for (const a of advertencias) lineas.push(`Aviso: ${aUnaLinea(a)}`);
  return lineas.join("\n");
}

const fuenteTexto = (f: { nombre: string; fecha_publicacion: string }): string =>
  `Fuente: ${aUnaLinea(f.nombre)} (DOF ${aUnaLinea(f.fecha_publicacion)})`;

export function umaTexto(u: Uma, fecha?: string | undefined): string {
  const hasta = `${u.anio + 1}-01-31`;
  return [
    `${fecha === undefined ? "" : `UMA vigente el ${fecha}: `}UMA ${u.anio} (del ${aUnaLinea(u.vigencia_desde)} al ${hasta})`,
    `  Diaria: ${aUnaLinea(u.diaria)}`,
    `  Mensual: ${aUnaLinea(u.mensual)}`,
    `  Anual: ${aUnaLinea(u.anual)}`,
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
    lineas.push(
      `  ${ZONAS[s.zona]}: ${aUnaLinea(s.diario)} (desde el ${aUnaLinea(s.vigencia_desde)})`,
    );
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
      ].map(aUnaLinea),
    ),
  ];
  const anchos = filas[0]?.map((_, i) => Math.max(...filas.map((f) => (f[i] as string).length)));
  const lineas = filas.map((fila) =>
    `  ${fila.map((celda, i) => celda.padStart(anchos?.[i] ?? 0)).join("  ")}`.trimEnd(),
  );
  const titulo = `Tarifa ${aUnaLinea(t.periodo)} de ISR ${t.anio}, en pesos:`;
  return [titulo, ...lineas, fuenteTexto(t.fuente)].join("\n");
}

export function municipioTexto(m: Municipio, estado: string | undefined): string {
  const entidad = estado === undefined ? `entidad ${aUnaLinea(m.cve_ent)}` : aUnaLinea(estado);
  return `${aUnaLinea(m.cvegeo)}  ${aUnaLinea(m.nombre)}, ${entidad}`;
}

export function municipiosTexto(
  texto: string,
  encontrados: readonly Municipio[],
  maximo: number,
  estado: (cve_ent: string) => string | undefined,
): string {
  if (encontrados.length === 0) return `Sin municipios que coincidan con "${aUnaLinea(texto)}".`;
  const lineas = encontrados.slice(0, maximo).map((m) => municipioTexto(m, estado(m.cve_ent)));
  if (encontrados.length > maximo) {
    lineas.push(`... y ${encontrados.length - maximo} más; afina la búsqueda o usa --json.`);
  }
  return lineas.join("\n");
}

export function estadosTexto(estados: readonly Estado[]): string {
  return estados
    .map((e) => `${aUnaLinea(e.cve_ent)}  ${aUnaLinea(e.nombre)} (${aUnaLinea(e.abreviatura)})`)
    .join("\n");
}

/** Los municipios de un estado, con el total; en la Ciudad de México son alcaldías. */
export function municipiosDeEstadoTexto(
  cve_ent: string,
  estado: string | undefined,
  lista: readonly Municipio[],
): string {
  const nombre = estado === undefined ? `Entidad ${cve_ent}` : aUnaLinea(estado);
  const que = cve_ent === "09" ? "alcaldías" : "municipios";
  return [
    `${nombre} (${cve_ent}): ${lista.length} ${que}`,
    ...lista.map((m) => `${aUnaLinea(m.cvegeo)}  ${aUnaLinea(m.nombre)}`),
  ].join("\n");
}

export function bancoTexto(b: Banco): string {
  const baja = b.baja_detectada === null ? "sin fecha" : aUnaLinea(b.baja_detectada);
  const lineas = [
    `${aUnaLinea(b.codigo)}  ${aUnaLinea(b.nombre_corto)}`,
    `  Razón social: ${b.razon_social === null ? "sin dato" : aUnaLinea(b.razon_social)}`,
    `  Tipo: ${aUnaLinea(b.tipo)}`,
    `  Código SPEI: ${aUnaLinea(b.codigo_spei)}`,
    `  Situación: ${b.activo ? "activo" : `dado de baja (detectado ${baja})`}`,
  ];
  return lineas.join("\n");
}

export function resumenSepomexTexto(s: ResumenSepomex): string {
  const lineas = [
    `Directorio: ${aUnaLinea(s.dir)}`,
    `Guardado: ${aUnaLinea(s.descargado)} (${aUnaLinea(s.origen)})`,
    `Fuente: ${aUnaLinea(s.fuente)}`,
    `Información de Correos de México al: ${s.as_of === null ? "sin dato" : aUnaLinea(s.as_of)}`,
    `Filas: ${s.filas}; códigos postales: ${s.codigos_postales}; municipios: ${s.municipios}`,
    `Sin municipio de INEGI: ${s.sin_municipio_inegi}`,
    `SQLite: ${s.sqlite === null ? `no (${s.sin_sqlite === null ? "sin dato" : aUnaLinea(s.sin_sqlite)})` : aUnaLinea(s.sqlite)}`,
    ...s.advertencias.map((a) => `Aviso: ${aUnaLinea(a)}`),
    aUnaLinea(s.nota),
  ];
  return lineas.join("\n");
}
