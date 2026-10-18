import type {
  DiaInhabilCurado,
  FechaISO,
  FuenteDof,
  FuenteManifiesto,
  Manifiesto,
} from "@mexicoapi/core";
import { jsonCanonico, ordenarPorClave, sha256Hex } from "../canonico.js";
import { fuenteDeRegla, registrosConRegla, shardCalendario } from "./calendario.js";
import type { FuenteCurada } from "./esquemas.js";
import type { DocumentoCurado } from "./leer.js";
import type { DefinicionCurado } from "./registro.js";

function fechaDof(fecha: FechaISO): string {
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}`;
}

function cita(fuente: FuenteCurada): string {
  const fecha = fechaDof(fuente.fecha_publicacion);
  // En diputados.gob.mx se cita el texto vigente de la ley; su fecha es la de la última reforma.
  const donde = fuente.url.startsWith("https://www.diputados.gob.mx/")
    ? `Texto vigente con la última reforma publicada en el DOF el ${fecha}`
    : `Diario Oficial de la Federación, ${fecha}`;
  return `${fuente.nombre}. ${donde}. ${fuente.url}`;
}

/**
 * Una fuente del manifiesto por publicación (URL). No hay crudos: el original es la publicación
 * citada y la transcripción es el YAML versionado en `data/curado/`.
 */
function fuentesManifiesto(fuentes: Iterable<FuenteCurada>): FuenteManifiesto[] {
  const porUrl = new Map<string, FuenteCurada>();
  for (const f of fuentes) if (!porUrl.has(f.url)) porUrl.set(f.url, f);
  const publicaciones = ordenarPorClave(
    [...porUrl.values()],
    (f) => `${f.fecha_publicacion} ${f.url}`,
  );
  return publicaciones.map((f) => ({
    name: f.nombre,
    url: f.url,
    license: f.licencia,
    license_url: f.licencia_url,
    citation: cita(f),
    published_at: f.fecha_publicacion,
    raw: [],
  }));
}

/**
 * Lo que un calendario necesita además de sus días: los tipos de plazo con su cobertura y la fuente
 * de los fines de semana de cada año. Es el shard de la API sin `dias`; el paquete lo lee tal cual.
 */
export const ARCHIVO_CALENDARIO = "calendario.json";

/**
 * Los registros que se publican de un curado: los del YAML y, en un calendario con regla del
 * núcleo (el SAT), los días de la regla de los años que cubre el YAML, en orden de fecha.
 */
export function registrosPublicados<T extends { fuente: FuenteDof }>(
  def: DefinicionCurado<T>,
  documento: DocumentoCurado<T>,
): T[] {
  if (def.calendario === undefined) return documento.registros;
  const registros = documento.registros as unknown as DiaInhabilCurado[];
  return registrosConRegla(def.calendario, registros, documento.cobertura) as unknown as T[];
}

/**
 * Archivos de `data/<directorio>/`: los registros en JSON canónico y su manifiesto y, en un
 * calendario, `calendario.json`. Todo sale del YAML y, en un calendario con regla, de la regla
 * del núcleo, incluidas las fechas (`as_of` es la publicación más reciente), así que es
 * reproducible. Lanza ErrorDatos si un calendario no puede citar los fines de semana de cada año.
 */
export function archivosCurado<T extends { fuente: FuenteDof }>(
  def: DefinicionCurado<T>,
  documento: DocumentoCurado<T>,
): Map<string, string> {
  const registros = registrosPublicados(def, documento);
  const datos = jsonCanonico(registros);
  const deRegla = def.calendario === undefined ? undefined : fuenteDeRegla(def.calendario);
  const fuentes = [...documento.fuentes.values(), ...(deRegla === undefined ? [] : [deRegla])];
  const asOf = fuentes.reduce(
    (max, f) => (f.fecha_publicacion > max ? f.fecha_publicacion : max),
    "",
  );
  const manifiesto: Manifiesto = {
    dataset: def.id,
    schema_version: 1,
    as_of: asOf,
    // Instante sintético: no hubo descarga y así `curar` es reproducible.
    fetched_at: `${asOf}T00:00:00Z`,
    data_file: def.archivo,
    data_sha256: sha256Hex(datos),
    records: registros.length,
    sources: fuentesManifiesto(fuentes),
  };
  const archivos = new Map([
    [def.archivo, datos],
    ["manifest.json", jsonCanonico(manifiesto)],
  ]);
  if (def.calendario !== undefined) {
    const { dias: _dias, ...calendario } = shardCalendario(
      def.calendario,
      registros as unknown as DiaInhabilCurado[],
      documento.cobertura,
    );
    archivos.set(ARCHIVO_CALENDARIO, jsonCanonico(calendario));
  }
  return archivos;
}
