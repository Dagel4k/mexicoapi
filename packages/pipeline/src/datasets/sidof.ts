import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  diaDeLaSemana,
  esFechaIsoValida,
  type FechaISO,
  sumarDias,
  type TipoCambioFix,
  type Udi,
} from "@mexicoapi/core";
import { z } from "zod";
import { ErrorDatos } from "../errores.js";
import { esquemaTipoCambioFix, esquemaUdi } from "../esquemas.js";
import { anioDe } from "../fecha.js";
import type {
  Construccion,
  CrudoCapturado,
  DefinicionDataset,
  FuenteCapturada,
  Revision,
} from "../marco.js";

/** Primer año de las dos series. */
export const ANIO_INICIAL = 2020;

type TipoSidof = 158 | 159;

const BASE = "https://sidof.segob.gob.mx/dof/sidof/indicadores";
const INICIO_SERIE = `${ANIO_INICIAL}-01-01`;
const ID_POR_TIPO = { 158: "tipo-cambio.fix", 159: "udis" } as const;
const FECHA_SIDOF = /^(\d{2})-(\d{2})-(\d{4})$/;

const FUENTE = {
  url: "https://sidof.segob.gob.mx/",
  license:
    "Publicación oficial en el DOF; el Banco de México determina estos valores y autoriza su reproducción citando la fuente",
  license_url: "https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html",
  published_at: null,
} as const;

const respuestaSidof = z.object({
  messageCode: z.number(),
  response: z.string(),
  ListaIndicadores: z.array(
    z.object({
      codIndicador: z.number(),
      codTipoIndicador: z.number(),
      fecha: z.string(),
      valor: z.string(),
    }),
  ),
  TotalIndicadores: z.number(),
});

/** Consulta del año completo de un indicador. */
export function urlSidof(tipo: TipoSidof, anio: number): string {
  return `${BASE}/${tipo}/01-01-${anio}/31-12-${anio}`;
}

const archivoCrudo = (tipo: TipoSidof, anio: number): string => `raw/sidof-${tipo}-${anio}.json`;
const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface PlanAnios {
  /** Años que cubre la corrida, cada uno con su crudo. */
  anios: number[];
  /** Años que se piden a la fuente aunque su crudo ya esté en disco. */
  recientes: Set<number>;
  /** Años que todavía pueden no tener publicaciones: el en curso y, si se pide, el siguiente. */
  abiertos: Set<number>;
}

/**
 * Años de una corrida. En enero se vuelve a pedir el año anterior, por si llegó algo tarde. En
 * diciembre, si la serie se publica por adelantado (UDIS), también se pide el año siguiente.
 */
function planAnios(fecha: FechaISO, porAdelantado: boolean): PlanAnios {
  const actual = anioDe(fecha);
  const mes = fecha.slice(5, 7);
  const ultimo = porAdelantado && mes === "12" ? actual + 1 : actual;
  const anios = Array.from(
    { length: Math.max(0, ultimo - ANIO_INICIAL + 1) },
    (_, i) => ANIO_INICIAL + i,
  );
  const abiertos = new Set(anios.filter((a) => a >= actual));
  const recientes = new Set(anios.filter((a) => a >= actual || (mes === "01" && a === actual - 1)));
  return { anios, recientes, abiertos };
}

/**
 * Interpreta la respuesta del SIDOF para un año. Falla con `ErrorDatos` ante cualquier forma
 * inesperada: así una fuente rota o bloqueada detiene la corrida antes de escribir.
 */
export function interpretarSidof(
  bytes: Uint8Array,
  tipo: TipoSidof,
  anio: number,
  decimales: 4 | 6,
): { fecha: FechaISO; valor: string }[] {
  const error = (mensaje: string) =>
    new ErrorDatos(`la respuesta del SIDOF (tipo ${tipo}, ${anio}) ${mensaje}`, ID_POR_TIPO[tipo]);

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw error("no es JSON válido");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw error("no tiene la forma esperada: (raíz)");
  }
  const { messageCode, response } = json as Record<string, unknown>;
  if (messageCode !== 200) {
    throw error(`trae messageCode ${String(JSON.stringify(messageCode))}, se esperaba 200`);
  }
  if (response !== "OK") {
    throw error(`trae response ${String(JSON.stringify(response))}, se esperaba "OK"`);
  }
  const r = respuestaSidof.safeParse(json);
  if (!r.success) {
    const ruta = r.error.issues[0]?.path.map(String).join(".") ?? "";
    throw error(`no tiene la forma esperada: ${ruta === "" ? "(raíz)" : ruta}`);
  }
  const lista = r.data.ListaIndicadores;
  if (r.data.TotalIndicadores !== lista.length) {
    throw error(
      `trae TotalIndicadores ${r.data.TotalIndicadores} y la lista tiene ${lista.length}`,
    );
  }

  // Solo se toleran espacios alrededor del valor: el SIDOF publica "8.673506 " (espacio al
  // final) para la UDI del 2026-01-09 y " 8.830830" (al inicio) para la del 2026-06-09.
  const formatoValor = new RegExp(`^ *(\\d+\\.\\d{${decimales}}) *$`);
  const vistas = new Set<string>();
  const registros: { fecha: FechaISO; valor: string }[] = [];
  for (const ind of lista) {
    if (ind.codTipoIndicador !== tipo) {
      throw error(
        `trae el indicador ${ind.codIndicador} con codTipoIndicador ${ind.codTipoIndicador}`,
      );
    }
    const m = FECHA_SIDOF.exec(ind.fecha);
    const fecha = m === null ? "" : `${m[3]}-${m[2]}-${m[1]}`;
    if (!esFechaIsoValida(fecha))
      throw error(`trae una fecha inválida: ${JSON.stringify(ind.fecha)}`);
    if (anioDe(fecha) !== anio) throw error(`trae la fecha ${ind.fecha}, que no es de ${anio}`);
    const valor = formatoValor.exec(ind.valor)?.[1];
    if (valor === undefined) {
      throw error(
        `trae un valor inesperado el ${fecha}: ${JSON.stringify(ind.valor)} (se esperan ${decimales} decimales)`,
      );
    }
    if (vistas.has(fecha)) throw error(`trae la fecha ${fecha} repetida`);
    vistas.add(fecha);
    registros.push({ fecha, valor });
  }
  return registros;
}

/**
 * El SIDOF responde HTTP 404 con exactamente `{"messageCode":404,"response":"NOT_FOUND"}` cuando
 * el rango pedido no tiene publicaciones (por ejemplo, el año nuevo antes del primer FIX).
 */
function esRangoSinPublicaciones(bytes: Uint8Array): boolean {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return false;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return false;
  const o = json as Record<string, unknown>;
  return Object.keys(o).length === 2 && o.messageCode === 404 && o.response === "NOT_FOUND";
}

async function leerCrudoDisco(ruta: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(ruta));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Entero con `decimales` cifras implícitas; evita el punto flotante en los umbrales. */
function aEntero(valor: string, decimales: number): bigint {
  const [entero = "", fraccion = ""] = valor.split(".");
  return BigInt(entero + fraccion.padEnd(decimales, "0"));
}

const esPositivo = (valor: string): boolean => /^\d+\.\d+$/.test(valor) && /[1-9]/.test(valor);

const repetidos = (valores: readonly string[]): string[] => {
  const vistos = new Set<string>();
  const dup = new Set<string>();
  for (const v of valores) (vistos.has(v) ? dup : vistos).add(v);
  return [...dup];
};

interface ConfigSidof<T extends { valor: string }> {
  id: string;
  directorio: string;
  archivo: string;
  esquema: z.ZodType<T>;
  tipo: TipoSidof;
  decimales: 4 | 6;
  name: string;
  citation: string;
  fechaDe(r: T): FechaISO;
  registro(fecha: FechaISO, valor: string): T;
  /** La serie tiene un valor para cada día, sin huecos. */
  diaria: boolean;
  /** La fuente publica valores de fechas futuras (en diciembre, los de enero). */
  porAdelantado: boolean;
  /** Más altas que esto en una corrida piden revisión. */
  maximoAltas: number;
  /**
   * Si la fuente solo publica de lunes a viernes, el motivo para un alta en sábado o domingo
   * (la consulta del FIX supone que no las hay); null si la serie los incluye.
   */
  finDeSemana: string | null;
  /** Variación máxima contra el registro anterior: `numerador / denominador`. */
  umbral: { numerador: bigint; denominador: bigint; texto: string };
  /** Cómo se nombra un registro y su anterior en los motivos. */
  nombre: string;
  anterior: string;
}

function crearDatasetSidof<T extends { valor: string }>(c: ConfigSidof<T>): DefinicionDataset<T> {
  const fuente = (crudos: CrudoCapturado[]): FuenteCapturada => ({
    name: c.name,
    ...FUENTE,
    citation: c.citation,
    crudos,
  });

  /** Se aleja del anterior más que el umbral, con aritmética entera. */
  const seAleja = (anterior: string, nuevo: string): boolean => {
    const a = aEntero(anterior, c.decimales);
    const n = aEntero(nuevo, c.decimales);
    const diferencia = n > a ? n - a : a - n;
    return diferencia * c.umbral.denominador > a * c.umbral.numerador;
  };

  return {
    id: c.id,
    directorio: c.directorio,
    archivo: c.archivo,
    esquema: c.esquema,
    clave: c.fechaDe,

    async capturar(ctx): Promise<FuenteCapturada[]> {
      const actual = anioDe(ctx.fecha);
      if (actual < ANIO_INICIAL) {
        throw new ErrorDatos(`la fecha ${ctx.fecha} es anterior a ${ANIO_INICIAL}`, c.id);
      }
      const plan = planAnios(ctx.fecha, c.porAdelantado);
      const crudos: CrudoCapturado[] = [];
      const delDisco: number[] = [];
      let hora = "";
      for (const anio of plan.anios) {
        const file = archivoCrudo(c.tipo, anio);
        const url = urlSidof(c.tipo, anio);
        const previo = plan.recientes.has(anio)
          ? null
          : await leerCrudoDisco(join(ctx.raizDatos, c.directorio, file));
        if (previo !== null) {
          delDisco.push(crudos.length);
          crudos.push({ file, url, bytes: previo, obtenido_en: "" });
          continue;
        }
        const r = await ctx.cliente.obtener(url, { aceptar: [404] });
        // El año en curso siempre se pide; los crudos del disco llevan la hora de esa petición.
        if (anio === actual) hora = r.obtenido_en;
        const abierto = plan.abiertos.has(anio);
        if (r.estado === 404) {
          // Solo el año en curso y el siguiente pueden no tener publicaciones todavía; no dejan
          // crudo. Si antes tenían registros, desaparecen y `revisar` pide revisión por cada uno.
          if (abierto && esRangoSinPublicaciones(r.cuerpo)) continue;
          throw new ErrorDatos(
            `el SIDOF respondió 404 para ${anio}${abierto ? " con un cuerpo inesperado" : ", un año que ya debe tener publicaciones"}`,
            c.id,
          );
        }
        // Si la fuente responde algo inesperado, se detiene antes de pedir más años.
        const leidos = interpretarSidof(r.cuerpo, c.tipo, anio, c.decimales);
        if (leidos.length === 0 && !abierto) {
          throw new ErrorDatos(
            `el SIDOF no trae publicaciones de ${anio}, un año que ya debe tenerlas`,
            c.id,
          );
        }
        crudos.push({ file, url, bytes: r.cuerpo, obtenido_en: r.obtenido_en });
      }
      return [
        fuente(crudos.map((x, i) => (delDisco.includes(i) ? { ...x, obtenido_en: hora } : x))),
      ];
    },

    async construir(fuentes, _anterior, ctx): Promise<Construccion<T>> {
      const { anios, abiertos } = planAnios(ctx.fecha, c.porAdelantado);
      const porArchivo = new Map(fuentes.flatMap((f) => f.crudos).map((x) => [x.file, x]));
      const esperados = anios.map((a) => archivoCrudo(c.tipo, a));
      // Un año abierto no tiene crudo mientras el SIDOF no tenga publicaciones de ese año.
      const faltan = anios
        .filter((a) => !abiertos.has(a) && !porArchivo.has(archivoCrudo(c.tipo, a)))
        .map((a) => archivoCrudo(c.tipo, a));
      if (faltan.length > 0) throw new ErrorDatos(`Faltan crudos: ${faltan.join(", ")}`, c.id);
      const sobran = [...porArchivo.keys()].filter((f) => !esperados.includes(f));
      if (sobran.length > 0) throw new ErrorDatos(`Crudos inesperados: ${sobran.join(", ")}`, c.id);

      const registros = anios.flatMap((anio) => {
        const crudo = porArchivo.get(archivoCrudo(c.tipo, anio));
        if (crudo === undefined) return [];
        const leidos = interpretarSidof(crudo.bytes, c.tipo, anio, c.decimales);
        // Un año cerrado vacío (pedido o leído del disco) es un crudo dañado: el SIDOF responde
        // 404 a los rangos sin publicaciones.
        if (leidos.length === 0 && !abiertos.has(anio)) {
          throw new ErrorDatos(
            `${crudo.file} no trae publicaciones de ${anio}, un año que ya debe tenerlas`,
            c.id,
          );
        }
        return leidos.map((x) => c.registro(x.fecha, x.valor));
      });
      registros.sort((a, b) => porTexto(c.fechaDe(a), c.fechaDe(b)));
      return { registros, avisos: [] };
    },

    invariantes(registros) {
      const fallas: string[] = [];
      const fechas = registros.map(c.fechaDe);
      const invalidas = fechas.filter((f) => !esFechaIsoValida(f));
      if (invalidas.length > 0) fallas.push(`fechas inválidas: ${invalidas.join(", ")}`);
      const dup = repetidos(fechas);
      if (dup.length > 0) fallas.push(`fechas repetidas: ${dup.join(", ")}`);
      const validas = [...new Set(fechas.filter(esFechaIsoValida))].sort(porTexto);
      const primera = validas[0];
      if (primera !== undefined && primera < INICIO_SERIE) {
        fallas.push(`la primera fecha (${primera}) es anterior a ${INICIO_SERIE}`);
      }
      const noPositivos = registros
        .filter((r) => !esPositivo(r.valor))
        .map((r) => `${c.fechaDe(r)} (${r.valor})`);
      if (noPositivos.length > 0) {
        fallas.push(`valores que no son mayores que cero: ${noPositivos.join(", ")}`);
      }
      if (c.diaria) {
        const huecos: string[] = [];
        for (let i = 1; i < validas.length; i++) {
          const antes = validas[i - 1] as FechaISO;
          const despues = validas[i] as FechaISO;
          if (sumarDias(antes, 1) !== despues) huecos.push(`entre ${antes} y ${despues}`);
        }
        if (huecos.length > 0) fallas.push(`huecos en la serie diaria: ${huecos.join(", ")}`);
      }
      return fallas;
    },

    revisar(diferencias, anterior): Revision {
      const motivos: string[] = [];
      for (const x of diferencias.cambios) {
        motivos.push(`cambió el valor de ${x.clave}: ${x.antes.valor} → ${x.despues.valor}`);
      }
      for (const b of diferencias.bajas) motivos.push(`desapareció ${c.fechaDe(b)}`);
      const altas = diferencias.altas.length;
      if (altas > c.maximoAltas) {
        motivos.push(`${altas} altas, más de ${c.maximoAltas}: arranque o hueco recuperado`);
      }

      // Un alta antes de la última fecha publicada rellena la serie: la API pudo haber respondido
      // antes que ese día no había dato, u otro FIX para una operación.
      let ultimaPublicada = "";
      for (const r of anterior) {
        if (c.fechaDe(r) > ultimaPublicada) ultimaPublicada = c.fechaDe(r);
      }
      for (const a of diferencias.altas) {
        const fecha = c.fechaDe(a);
        if (fecha < ultimaPublicada) {
          motivos.push(`alta dentro de la serie ya publicada: ${fecha} ${a.valor}`);
        }
        const dia = diaDeLaSemana(fecha);
        if (c.finDeSemana !== null && (dia === 0 || dia === 6)) {
          motivos.push(`${c.finDeSemana}: ${fecha}`);
        }
      }

      // Cada alta se compara con el registro anterior de la serie nueva (también puede ser alta).
      const serie = new Map(anterior.map((r) => [c.fechaDe(r), r]));
      for (const b of diferencias.bajas) serie.delete(c.fechaDe(b));
      for (const x of diferencias.cambios) serie.set(x.clave, x.despues);
      for (const a of diferencias.altas) serie.set(c.fechaDe(a), a);
      const fechas = [...serie.keys()].sort(porTexto);
      const posicion = new Map(fechas.map((f, i) => [f, i]));
      for (const a of diferencias.altas) {
        const fecha = c.fechaDe(a);
        const previa = fechas[(posicion.get(fecha) as number) - 1];
        if (previa === undefined) continue;
        const p = serie.get(previa) as T;
        if (seAleja(p.valor, a.valor)) {
          motivos.push(
            `${c.nombre} de ${fecha} (${a.valor}) se aleja más de ${c.umbral.texto} ${c.anterior} (${previa}: ${p.valor})`,
          );
        }
      }
      return { requiereRevision: motivos.length > 0, motivos };
    },
  };
}

export const tipoCambioFix: DefinicionDataset<TipoCambioFix> = crearDatasetSidof({
  id: "tipo-cambio.fix",
  directorio: "tipo-cambio-fix",
  archivo: "fix.json",
  esquema: esquemaTipoCambioFix,
  tipo: 158,
  decimales: 4,
  name: "Diario Oficial de la Federación (SIDOF): tipo de cambio para solventar obligaciones denominadas en moneda extranjera (FIX)",
  citation:
    "Banco de México. Tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la República Mexicana. Diario Oficial de la Federación, consultado en el SIDOF: https://sidof.segob.gob.mx/",
  fechaDe: (r) => r.fecha_publicacion,
  registro: (fecha, valor) => ({ fecha_publicacion: fecha, valor }),
  diaria: false,
  porAdelantado: false,
  finDeSemana: "FIX publicado en fin de semana",
  maximoAltas: 31,
  umbral: { numerador: 5n, denominador: 100n, texto: "5 %" },
  nombre: "el FIX",
  anterior: "de la publicación anterior",
});

export const udis: DefinicionDataset<Udi> = crearDatasetSidof({
  id: "udis",
  directorio: "udis",
  archivo: "udis.json",
  esquema: esquemaUdi,
  tipo: 159,
  decimales: 6,
  name: "Diario Oficial de la Federación (SIDOF): valor de la unidad de inversión (UDIS)",
  citation:
    "Banco de México. Valor de la unidad de inversión. Diario Oficial de la Federación, consultado en el SIDOF: https://sidof.segob.gob.mx/",
  fechaDe: (r) => r.fecha,
  registro: (fecha, valor) => ({ fecha, valor }),
  diaria: true,
  porAdelantado: true,
  finDeSemana: null,
  maximoAltas: 45,
  umbral: { numerador: 5n, denominador: 1000n, texto: "0.5 %" },
  nombre: "la UDI",
  anterior: "del día anterior",
});
