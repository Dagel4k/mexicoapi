// Lo que el paquete necesita de un calendario curado además de sus días: los plazos con su
// cobertura y la fuente que cita los fines de semana de cada año. Es lo mismo que el pipeline
// escribe para el Worker (`v1/_internos/calendarios/<autoridad>.json`); una prueba lo compara con
// su función. La cobertura por tipo de día solo está en el YAML de `data/curado`, así que aquí se
// lee su bloque `cobertura` en la forma que usa el repositorio, sin dependencias.
// Sin dependencias: Node lo ejecuta tal cual (quita los tipos), así que solo usa sintaxis borrable.

type TipoDia = "descanso" | "vacaciones";
type TipoPlazo = "general" | "declaraciones_pagos";

export interface Rango {
  desde: string;
  hasta: string;
}

export type CoberturaYaml = Partial<Record<TipoDia, Rango>>;

export interface FuenteDof {
  nombre: string;
  url: string;
  fecha_publicacion: string;
  fragmento: string;
}

export interface RegistroDia {
  fecha: string;
  autoridad: string;
  tipo: string;
  fuente: FuenteDof;
}

export interface PlazoCalendario {
  cobertura: Rango;
  excluir_tipos: TipoDia[];
}

/** Lo que el módulo generado exporta como `calendario`. */
export interface CalendarioGenerado {
  autoridad: string;
  plazos: Partial<Record<TipoPlazo, PlazoCalendario>>;
  fuentes_fin_de_semana: Record<string, FuenteDof>;
}

/**
 * Tipos de plazo de cada autoridad y los tipos de día que no cuentan en cada uno, como en el
 * pipeline: en declaraciones y pagos las vacaciones del SAT son hábiles (CFF art. 12).
 */
const PLAZOS: Readonly<Record<string, Readonly<Partial<Record<TipoPlazo, readonly TipoDia[]>>>>> = {
  cnbv: { general: [] },
  sat: { general: [], declaraciones_pagos: ["vacaciones"] },
};

const TIPOS_DIA: ReadonlySet<string> = new Set(["descanso", "vacaciones"]);
const FECHA = "[\"']?(\\d{4}-\\d{2}-\\d{2})[\"']?";
const LINEA_COBERTURA = new RegExp(
  `^ {2}([a-z_]+):\\s*\\{\\s*desde:\\s*${FECHA}\\s*,\\s*hasta:\\s*${FECHA}\\s*\\}\\s*(?:#.*)?$`,
);

/** Una fecha AAAA-MM-DD que existe. */
function esFecha(valor: string): boolean {
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
}

/**
 * El bloque `cobertura:` del YAML de un calendario, o null si el documento no lo tiene. Acepta
 * la forma del repositorio (`  descanso: { desde: AAAA-MM-DD, hasta: AAAA-MM-DD }`, con
 * comentarios y líneas vacías); cualquier otra falla con el nombre del archivo, para que el build
 * no publique un calendario con una cobertura que no entendió.
 */
export function coberturaDelYaml(texto: string, origen: string): CoberturaYaml | null {
  const lineas = texto.split(/\r?\n/);
  const inicios = lineas.flatMap((l, i) => (/^cobertura\s*:/.test(l) ? [i] : []));
  if (inicios.length === 0) return null;
  const falla = (motivo: string): Error => new Error(`${origen}: ${motivo}`);
  if (inicios.length > 1) throw falla("tiene más de un bloque cobertura");
  const inicio = inicios[0] as number;
  if (!/^cobertura:\s*(?:#.*)?$/.test(lineas[inicio] as string)) {
    throw falla("cobertura debe ser un bloque con un tipo de día por línea");
  }
  const cobertura: CoberturaYaml = {};
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i] as string;
    if (/^\s*(?:#.*)?$/.test(linea)) continue;
    if (!/^\s/.test(linea)) break;
    const m = LINEA_COBERTURA.exec(linea);
    if (m === null) {
      throw falla(
        `no se entiende la línea ${i + 1} de la cobertura; se espera "  tipo: { desde: AAAA-MM-DD, hasta: AAAA-MM-DD }"`,
      );
    }
    const [, tipo, desde, hasta] = m as unknown as [string, string, string, string];
    if (!TIPOS_DIA.has(tipo)) throw falla(`la cobertura tiene un tipo de día desconocido: ${tipo}`);
    if (Object.hasOwn(cobertura, tipo)) throw falla(`la cobertura repite el tipo ${tipo}`);
    if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) {
      throw falla(`la cobertura de ${tipo} no es un rango de fechas válido`);
    }
    cobertura[tipo as TipoDia] = { desde, hasta };
  }
  if (Object.keys(cobertura).length === 0) throw falla("la cobertura está vacía");
  return cobertura;
}

const contiene = (a: Rango, b: Rango): boolean => a.desde <= b.desde && b.hasta <= a.hasta;
const anioDe = (fecha: string): number => Number(fecha.slice(0, 4));

/**
 * Los plazos, su cobertura y las fuentes de los fines de semana, con las reglas del pipeline: la
 * cobertura de un plazo es la intersección de las de los tipos de día que cuenta, un plazo
 * contiene a los demás (la cobertura amplia), cada día cae en ella y cada año se cita con la
 * fuente de su último día de descanso, que debe mencionar los sábados y domingos.
 */
export function armarCalendario(
  registros: readonly RegistroDia[],
  cobertura: CoberturaYaml,
  dataset: string,
): CalendarioGenerado {
  const falla = (motivo: string): Error => new Error(`${dataset}: ${motivo}`);
  const autoridades = new Set(registros.map((r) => r.autoridad));
  const [autoridad] = autoridades;
  if (autoridad === undefined || autoridades.size > 1) {
    throw falla("los días deben ser de una sola autoridad");
  }
  const tabla = Object.hasOwn(PLAZOS, autoridad) ? PLAZOS[autoridad] : undefined;
  if (tabla === undefined) throw falla(`no hay tipos de plazo para la autoridad ${autoridad}`);
  const plazos: Partial<Record<TipoPlazo, PlazoCalendario>> = {};
  for (const [tipo, excluir] of Object.entries(tabla) as [TipoPlazo, readonly TipoDia[]][]) {
    const rangos = (Object.keys(cobertura) as TipoDia[])
      .filter((t) => !excluir.includes(t))
      .map((t) => cobertura[t] as Rango);
    if (rangos.length === 0) throw falla(`el plazo ${tipo} no tiene cobertura`);
    const desde = rangos.map((r) => r.desde).reduce((a, b) => (a > b ? a : b));
    const hasta = rangos.map((r) => r.hasta).reduce((a, b) => (a < b ? a : b));
    if (desde > hasta) throw falla(`la cobertura del plazo ${tipo} queda vacía`);
    plazos[tipo] = { cobertura: { desde, hasta }, excluir_tipos: [...excluir] };
  }
  const coberturas = Object.values(plazos).map((p) => p.cobertura);
  const amplia = coberturas.find((c) => coberturas.every((otra) => contiene(c, otra)));
  if (amplia === undefined) throw falla("ningún tipo de plazo contiene la cobertura de los demás");
  for (const { fecha } of registros) {
    if (fecha < amplia.desde || fecha > amplia.hasta) {
      throw falla(`${fecha} no cae en la cobertura de ningún tipo de plazo`);
    }
  }
  const fuentes: Record<string, FuenteDof> = {};
  for (let anio = anioDe(amplia.desde); anio <= anioDe(amplia.hasta); anio++) {
    const ultimo = registros
      .filter((r) => r.tipo === "descanso" && anioDe(r.fecha) === anio)
      .at(-1);
    if (ultimo === undefined) throw falla(`no hay días de descanso en ${anio}`);
    const { fuente } = ultimo;
    if (!/sábados/i.test(fuente.fragmento) || !/domingos/i.test(fuente.fragmento)) {
      throw falla(`la fuente de los fines de semana de ${anio} no menciona los sábados y domingos`);
    }
    fuentes[String(anio)] = {
      nombre: fuente.nombre,
      url: fuente.url,
      fecha_publicacion: fuente.fecha_publicacion,
      fragmento: fuente.fragmento,
    };
  }
  return { autoridad, plazos, fuentes_fin_de_semana: fuentes };
}
