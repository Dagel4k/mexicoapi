// Salida legible de la CLI: texto en español, corto y sin adornos.
import type {
  Banco,
  CodigoError,
  Municipio,
  ResultadoDiasHabiles,
  ResultadoValidacion,
} from "../index.js";
import type { EstadoSepomex } from "../sepomex/index.js";

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
  valor !== null && typeof valor === "object"
    ? Object.entries(valor)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(", ")
    : String(valor);

export function validacionTexto(
  nombre: string,
  femenino: boolean,
  r: ResultadoValidacion<unknown>,
): string {
  const adjetivo = `${r.valido ? "" : "no "}válid${femenino ? "a" : "o"}`;
  const lineas = [`${nombre} ${adjetivo}: ${r.valor}`];
  for (const codigo of r.errores) lineas.push(`  - ${ERRORES[codigo]}`);
  if (r.detalle !== null && typeof r.detalle === "object") {
    for (const [clave, valor] of Object.entries(r.detalle)) {
      lineas.push(`  ${clave}: ${valor === null ? "sin dato" : escalar(valor)}`);
    }
  }
  lineas.push(r.nota);
  return lineas.join("\n");
}

export function pieTexto(
  r: { origen: "api" | "paquete"; advertencias: readonly string[] },
  conRed: boolean,
): string {
  const origen =
    r.origen === "api"
      ? "Origen: API"
      : conRed
        ? "Origen: datos del paquete (la API no respondió)"
        : "Origen: datos del paquete, sin red";
  return [`\n${origen}`, ...r.advertencias.map((a) => `Aviso: ${a}`)].join("\n");
}

export function diasHabilesTexto(r: { data: ResultadoDiasHabiles }): string {
  const { desde, dias, autoridad, resultado, inhabiles_saltados, advertencias } = r.data;
  const lineas = [`${desde} + ${dias} días hábiles (${autoridad}): ${resultado}`];
  if (inhabiles_saltados.length > 0) {
    lineas.push("Inhábiles saltados:");
    for (const d of inhabiles_saltados) lineas.push(`  ${d.fecha}  ${d.motivo}`);
  }
  for (const a of advertencias) lineas.push(`Aviso: ${a}`);
  return lineas.join("\n");
}

export function municipioTexto(m: Municipio, estado: string | undefined): string {
  return `${m.cvegeo}  ${m.nombre}, ${estado ?? `entidad ${m.cve_ent}`}`;
}

export function municipiosTexto(
  texto: string,
  encontrados: readonly Municipio[],
  maximo: number,
  estado: (cve_ent: string) => string | undefined,
): string {
  if (encontrados.length === 0) return `Sin municipios que coincidan con "${texto}".`;
  const lineas = encontrados.slice(0, maximo).map((m) => municipioTexto(m, estado(m.cve_ent)));
  if (encontrados.length > maximo) {
    lineas.push(`... y ${encontrados.length - maximo} más; afina la búsqueda o usa --json.`);
  }
  return lineas.join("\n");
}

export function bancoTexto(b: Banco): string {
  const lineas = [
    `${b.codigo}  ${b.nombre_corto}`,
    `  Razón social: ${b.razon_social ?? "sin dato"}`,
    `  Tipo: ${b.tipo}`,
    `  Código SPEI: ${b.codigo_spei}`,
    `  Situación: ${b.activo ? "activo" : `dado de baja (detectado ${b.baja_detectada ?? "sin fecha"})`}`,
  ];
  return lineas.join("\n");
}

export function estadoSepomexTexto(s: EstadoSepomex): string {
  const lineas = [
    `Directorio: ${s.dir}`,
    `Guardado: ${s.descargado} (${s.origen})`,
    `Fuente: ${s.fuente}`,
    `Información de Correos de México al: ${s.as_of ?? "sin dato"}`,
    `Filas: ${s.filas}; códigos postales: ${s.codigos_postales}; municipios: ${s.municipios}`,
    `Sin municipio de INEGI: ${s.sin_municipio_inegi}`,
    `SQLite: ${s.sqlite ?? `no (${s.sin_sqlite ?? "sin dato"})`}`,
    ...s.advertencias.map((a) => `Aviso: ${a}`),
    s.nota,
  ];
  return lineas.join("\n");
}
