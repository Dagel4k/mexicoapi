import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Banco, esFechaIsoValida, type PeriodoBanco, type TipoBanco } from "@mexicoapi/core";
import { jsonCanonico, limpiarTexto } from "../../canonico.js";
import { ErrorDatos } from "../../errores.js";
import { esquemaBanco } from "../../esquemas.js";
import {
  type Construccion,
  type Contexto,
  type CrudoCapturado,
  camposDistintos,
  type DefinicionDataset,
  type FuenteCapturada,
  type FuenteEsperada,
  fuenteDistinta,
  fuentesFijas,
  type Revision,
} from "../../marco.js";
import { codigoClabe, type EntradaCep, interpretarCep, tipoBanco, urlCep } from "./cep.js";
import {
  actualizarHistorial,
  historialesDesdeObservaciones,
  type Observacion,
  observacionesCompactas,
} from "./historial.js";
import {
  enlacePdfParticipantes,
  type FilaParticipante,
  interpretarParticipantesPdf,
} from "./participantes-pdf.js";

const ID = "bancos";
const DIRECTORIO = "bancos";
const URL_INFO = "https://www.banxico.org.mx/servicios/spei_-informacion-banco-mex.html";
const URL_CEP_HISTORICO = "https://www.banxico.org.mx/cep/instituciones.do";
/**
 * Hosts de Banxico a los que pide el dataset. El robots.txt de www redirige al de
 * anterior.banxico.org.mx, que es el que se aplica.
 */
export const HOSTS_BANCOS: readonly string[] = [new URL(URL_INFO).host, "anterior.banxico.org.mx"];
const ARCHIVO_CEP = "raw/cep-instituciones.json";
const ARCHIVO_HISTORICO = "raw/cep-historico.json";
const ARCHIVO_PDF = "raw/participantes-spei.pdf";
const MAXIMO_CAMBIOS = 3;
/** Campos de un banco ya publicado cuyo cambio siempre pide revisión. */
const CAMPOS_IDENTIDAD: ReadonlySet<string> = new Set([
  "nombre_corto",
  "razon_social",
  "codigo_spei",
  "historial",
]);

const LICENCIA = {
  license: "Banco de México: autorización general de reproducción con cita de la fuente",
  license_url: "https://www.banxico.org.mx/footer-es/salvedad-politicas-uso-banco-.html",
} as const;

const FUENTE_CEP: FuenteEsperada = {
  name: "Banco de México, Comprobante Electrónico de Pago: instituciones participantes",
  url: "https://www.banxico.org.mx/cep/",
  ...LICENCIA,
  citation:
    "Banco de México. Comprobante Electrónico de Pago, instituciones participantes. https://www.banxico.org.mx/cep/",
  published_at: null,
};
const NOMBRE_PARTICIPANTES = "Banco de México, Participantes directos en el SPEI";
/** La cita del PDF de participantes, que lleva su URL. */
export const citaParticipantes = (url: string): string =>
  `Banco de México. Participantes directos en el SPEI. ${url}`;
/**
 * La URL del PDF de participantes cambia con cada versión, siempre con la misma forma: un GUID
 * entre llaves en www.banxico.org.mx/servicios/d/ (hoy,
 * `/servicios/d/{C24C7DBC-9ABF-6F41-DA38-561CEB1401B3}.pdf`). Nada de otras rutas, `..` ni
 * caracteres codificados.
 */
const URL_PARTICIPANTES =
  /^https:\/\/www\.banxico\.org\.mx\/servicios\/d\/\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}\.pdf$/;

async function pedir(ctx: Contexto, file: string, url: string): Promise<CrudoCapturado> {
  const r = await ctx.cliente.obtener(url);
  return { file, url, bytes: r.cuerpo, obtenido_en: r.obtenido_en };
}

async function leerHistoricoDisco(raizDatos: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(join(raizDatos, DIRECTORIO, ARCHIVO_HISTORICO)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Convierte el RangeError de los helpers de CEP en un error de datos. */
function conTipo(codigoSpei: string): { codigo: string; tipo: TipoBanco } {
  try {
    return { codigo: codigoClabe(codigoSpei), tipo: tipoBanco(codigoSpei) };
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ErrorDatos(`código SPEI inesperado: ${codigoSpei}`, ID);
    }
    throw error;
  }
}

const normalizarNombre = (n: string): string => limpiarTexto(n).toUpperCase();

function crudoDe(fuentes: readonly FuenteCapturada[], file: string): CrudoCapturado {
  const c = fuentes.flatMap((f) => f.crudos).find((x) => x.file === file);
  if (c === undefined) throw new ErrorDatos(`Falta ${file}`, ID);
  return c;
}

function ultimo(historial: readonly PeriodoBanco[]): PeriodoBanco {
  return historial[historial.length - 1] as PeriodoBanco;
}

interface Complemento {
  razon_social: string | null;
  sector: string | null;
  participacion: Banco["participacion"];
}

const SIN_PDF: Complemento = { razon_social: null, sector: null, participacion: "no_confirmada" };

/** Registro a partir de su historial; el estado sale del último periodo. */
function registroDesdeHistorial(
  codigo: string,
  historial: PeriodoBanco[],
  complemento: Complemento,
): Banco {
  const fin = ultimo(historial);
  const activo = fin.hasta === null;
  return {
    codigo,
    codigo_spei: fin.codigo_spei,
    nombre_corto: fin.nombre_corto,
    razon_social: complemento.razon_social,
    sector: complemento.sector,
    tipo: conTipo(fin.codigo_spei).tipo,
    participacion: complemento.participacion,
    activo,
    baja_detectada: fin.hasta,
    historial,
  };
}

/** Registros que salen solo del historial de observaciones. */
export function registrosDesdeHistorico(observaciones: readonly Observacion[]): Banco[] {
  try {
    return [...historialesDesdeObservaciones(observaciones)].map(([codigo, historial]) =>
      registroDesdeHistorial(codigo, historial, SIN_PDF),
    );
  } catch (error) {
    if (error instanceof RangeError) throw new ErrorDatos(error.message, ID);
    throw error;
  }
}

function invariantesBanco(b: Banco): string[] {
  const f: string[] = [];
  const p = (m: string) => f.push(`${b.codigo}: ${m}`);
  if (!b.codigo_spei.endsWith(b.codigo)) p(`codigo_spei ${b.codigo_spei} no termina en el código`);
  if (b.historial.length === 0) {
    p("historial vacío");
    return f;
  }
  b.historial.forEach((per, i) => {
    const previo = b.historial[i - 1];
    if (per.hasta !== null && per.desde >= per.hasta)
      p(`periodo vacío o invertido desde ${per.desde}`);
    if (previo !== undefined && per.desde < previo.desde) p("historial fuera de orden");
    if (per.hasta === null && i < b.historial.length - 1) p("periodo abierto que no es el último");
    // Con el anterior cerrado (lo exige la regla de arriba), este empieza cuando aquel ya terminó.
    if (previo !== undefined && previo.hasta !== null && per.desde < previo.hasta) {
      p(`periodo traslapado con el anterior desde ${per.desde}`);
    }
  });
  const fin = ultimo(b.historial);
  if (fin.codigo_spei !== b.codigo_spei || fin.nombre_corto !== b.nombre_corto) {
    p("el último periodo no coincide con el registro");
  }
  if (b.activo !== (fin.hasta === null)) p("activo no coincide con el último periodo");
  if (b.baja_detectada !== fin.hasta) p("baja_detectada no coincide con el último periodo");
  if (!b.activo && b.participacion !== "no_confirmada") {
    p("un registro inactivo debe tener participacion no_confirmada");
  }
  return f;
}

export function crearBancos(
  opciones: { historico?: readonly Observacion[] } = {},
): DefinicionDataset<Banco> {
  const def: DefinicionDataset<Banco> = {
    id: ID,
    hosts: HOSTS_BANCOS,
    directorio: DIRECTORIO,
    archivo: "bancos.json",
    esquema: esquemaBanco,
    clave: (b) => b.codigo,

    async capturar(ctx): Promise<FuenteCapturada[]> {
      const urlDelCep = urlCep(ctx.fecha);
      const cep = await pedir(ctx, ARCHIVO_CEP, urlDelCep);
      // Si Banxico bloquea (por ejemplo, responde HTML), se detiene antes de pedir más.
      interpretarCep(cep.bytes);
      const info = await ctx.cliente.obtener(URL_INFO);
      const urlPdf = enlacePdfParticipantes(new TextDecoder("utf-8").decode(info.cuerpo), URL_INFO);
      const pdf = await pedir(ctx, ARCHIVO_PDF, urlPdf);
      const listado = await interpretarParticipantesPdf(pdf.bytes);

      const crudosCep = [cep];
      if (opciones.historico !== undefined) {
        crudosCep.push({
          file: ARCHIVO_HISTORICO,
          url: URL_CEP_HISTORICO,
          bytes: new TextEncoder().encode(jsonCanonico(observacionesCompactas(opciones.historico))),
          obtenido_en: cep.obtenido_en,
        });
      } else {
        const previo = await leerHistoricoDisco(ctx.raizDatos);
        if (previo !== null) {
          crudosCep.push({
            file: ARCHIVO_HISTORICO,
            url: URL_CEP_HISTORICO,
            bytes: previo,
            obtenido_en: cep.obtenido_en,
          });
        }
      }

      return [
        { ...FUENTE_CEP, crudos: crudosCep },
        {
          name: NOMBRE_PARTICIPANTES,
          url: urlPdf,
          ...LICENCIA,
          citation: citaParticipantes(urlPdf),
          published_at: listado.actualizado_al,
          crudos: [pdf],
        },
      ];
    },

    async construir(fuentes, anterior, ctx): Promise<Construccion<Banco>> {
      const entradas = interpretarCep(crudoDe(fuentes, ARCHIVO_CEP).bytes);
      const listado = await interpretarParticipantesPdf(crudoDe(fuentes, ARCHIVO_PDF).bytes);
      const avisos: string[] = [];
      const filas = new Map<string, FilaParticipante>();
      for (const f of listado.filas) {
        const clave = normalizarNombre(f.nombre_corto);
        const otra = filas.get(clave);
        if (otra === undefined) filas.set(clave, f);
        else
          avisos.push(
            `en el PDF dos filas con el mismo nombre: ${otra.nombre_corto} y ${f.nombre_corto}`,
          );
      }
      const previos = new Map((anterior ?? []).map((b) => [b.codigo, b]));

      const hoy = new Map<string, EntradaCep>();
      for (const entrada of entradas) {
        const { codigo } = conTipo(entrada[0]);
        if (hoy.has(codigo)) {
          throw new ErrorDatos(`El código ${codigo} aparece más de una vez en el CEP`, ID);
        }
        hoy.set(codigo, entrada);
      }

      const nombresHoy = new Set([...hoy.values()].map((e) => normalizarNombre(e[1])));
      // Nombres anteriores de cada código, del periodo más reciente al más viejo, sin repetir
      // y sin su nombre de hoy ni el nombre que hoy use otro código en el CEP.
      const anterioresDe = (entrada: EntradaCep, previo: Banco | undefined): string[] => {
        const propio = normalizarNombre(entrada[1]);
        const vistos = new Set<string>();
        // Por unidades de código, como el resto de los datos; localeCompare depende del locale.
        const periodos = [...(previo?.historial ?? [])].sort((x, y) =>
          y.desde < x.desde ? -1 : y.desde > x.desde ? 1 : 0,
        );
        for (const p of periodos) {
          const n = normalizarNombre(p.nombre_corto);
          if (n !== propio && !nombresHoy.has(n)) vistos.add(n);
        }
        return [...vistos];
      };
      // Un nombre anterior que aparece en el historial de dos o más códigos sin pareja en el PDF
      // por su nombre de hoy es ambiguo: no se usa para ninguno.
      const codigosPorAnterior = new Map<string, number>();
      for (const [codigo, entrada] of hoy) {
        if (filas.has(normalizarNombre(entrada[1]))) continue;
        for (const n of anterioresDe(entrada, previos.get(codigo))) {
          codigosPorAnterior.set(n, (codigosPorAnterior.get(n) ?? 0) + 1);
        }
      }
      /**
       * Fila del PDF de un código, en este orden: por su nombre de hoy en el CEP; por el primero de
       * sus nombres anteriores del historial (del más reciente al más viejo) que no sea hoy el
       * nombre de otro código; y nunca por un nombre anterior que comparten dos o más códigos sin
       * pareja por su nombre de hoy.
       */
      const filaDe = (entrada: EntradaCep, previo: Banco | undefined) => {
        const clave = normalizarNombre(entrada[1]);
        const fila = filas.get(clave);
        if (fila !== undefined || previo === undefined) return { clave, fila };
        for (const n of anterioresDe(entrada, previo)) {
          if ((codigosPorAnterior.get(n) ?? 0) > 1) continue;
          const f = filas.get(n);
          if (f !== undefined) return { clave: n, fila: f };
        }
        return { clave, fila };
      };

      const usadas = new Set<string>();
      const registros: Banco[] = [];
      for (const codigo of new Set([...previos.keys(), ...hoy.keys()])) {
        const previo = previos.get(codigo);
        const entrada = hoy.get(codigo) ?? null;
        let historial: PeriodoBanco[];
        try {
          historial = actualizarHistorial(previo?.historial ?? [], ctx.fecha, entrada);
        } catch (error) {
          if (error instanceof RangeError) throw new ErrorDatos(error.message, ID);
          throw error;
        }
        if (historial.length === 0) continue;
        let complemento: Complemento;
        if (entrada !== null) {
          const { clave, fila } = filaDe(entrada, previo);
          if (fila !== undefined) usadas.add(clave);
          complemento =
            fila === undefined
              ? SIN_PDF
              : { razon_social: fila.razon_social, sector: fila.sector, participacion: "directa" };
        } else {
          // Un código inactivo conserva su última razón social y su último sector, pero ya no
          // participa.
          complemento =
            previo === undefined
              ? SIN_PDF
              : {
                  razon_social: previo.razon_social,
                  sector: previo.sector,
                  participacion: "no_confirmada",
                };
        }
        registros.push(registroDesdeHistorial(codigo, historial, complemento));
      }

      for (const [clave, f] of filas) {
        if (!usadas.has(clave)) avisos.push(`en el PDF y no en el CEP: ${f.nombre_corto}`);
      }
      return { registros, avisos };
    },

    invariantes(registros) {
      return registros.flatMap(invariantesBanco);
    },

    revisarFuentes(fuentes): string[] {
      if (fuentes.length !== 2) {
        return [`el manifiesto trae ${fuentes.length} fuentes y el código arma 2`];
      }
      const motivos = fuentesFijas(FUENTE_CEP)(fuentes.slice(0, 1));
      // El PDF cambia de URL con cada versión: vale una URL de Banxico con la forma de siempre, la
      // cita armada con ella y una fecha (o null) en published_at.
      const pdf = fuentes[1] as FuenteEsperada;
      const esperada: FuenteEsperada = {
        name: NOMBRE_PARTICIPANTES,
        ...LICENCIA,
        url: URL_PARTICIPANTES.test(pdf.url)
          ? pdf.url
          : "una URL de www.banxico.org.mx/servicios/d/",
        citation: citaParticipantes(pdf.url),
        published_at:
          pdf.published_at === null || esFechaIsoValida(pdf.published_at) ? pdf.published_at : null,
      };
      const campos = camposDistintos(pdf, esperada);
      if (campos.length > 0) motivos.push(fuenteDistinta(1, NOMBRE_PARTICIPANTES, campos));
      return motivos;
    },

    revisar(diferencias): Revision {
      const motivos: string[] = [];
      const nombre = (b: Banco) => `${b.codigo} ${b.nombre_corto}`;
      for (const b of diferencias.altas) motivos.push(`alta: ${nombre(b)}`);
      for (const b of diferencias.bajas) motivos.push(`baja: ${nombre(b)}`);
      for (const c of diferencias.cambios) {
        if (c.antes.activo && !c.despues.activo) motivos.push(`baja: ${nombre(c.despues)}`);
        else if (!c.antes.activo && c.despues.activo) {
          motivos.push(`reactivación: ${nombre(c.despues)}`);
        } else if (
          c.antes.activo &&
          c.despues.activo &&
          c.antes.participacion === "directa" &&
          c.despues.participacion !== "directa"
        ) {
          // El CEP y el PDF ya no coinciden en membresía.
          motivos.push(`sale del PDF de participantes: ${nombre(c.despues)}`);
        } else {
          // Lo que identifica a un banco ya publicado (cómo se llama, su razón social y su
          // código del SPEI, hoy y antes) no cambia sin que alguien lo vea.
          const campos = c.campos.filter((x) => CAMPOS_IDENTIDAD.has(x));
          if (campos.length > 0)
            motivos.push(`cambio en ${campos.join(", ")}: ${nombre(c.despues)}`);
        }
      }
      const total =
        diferencias.altas.length + diferencias.bajas.length + diferencias.cambios.length;
      if (total > MAXIMO_CAMBIOS) motivos.push(`más de ${MAXIMO_CAMBIOS} cambios (${total})`);
      return { requiereRevision: motivos.length > 0, motivos };
    },
  };
  return def;
}

export const bancos: DefinicionDataset<Banco> = crearBancos();
