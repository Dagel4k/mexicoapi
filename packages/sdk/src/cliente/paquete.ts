// Respuestas desde los datos y el núcleo que trae el paquete, con la forma de las de la API: las
// mismas reglas para los parámetros, los mismos problemas y el mismo `meta`. Este módulo, el
// núcleo y cada dataset se cargan con un import dinámico solo al usarlos: quien solo consulta la
// API no los carga y un bundler los deja en archivos aparte.
import type { CoberturaSerie, Consulta, FechaISO } from "@mexicoapi/core";
import type { MetaDatos } from "../datos/tipos.js";
import type { RutaDelPaquete } from "./cliente.js";
import { type ContextoLocal, type MexicoApiError, problemaLocal, type TipoLocal } from "./error.js";

type Nucleo = typeof import("@mexicoapi/core");

export interface Contexto extends ContextoLocal {
  /** Los parámetros como texto, igual que irían en la URL. */
  valores: Readonly<Record<string, string | undefined>>;
  /** Se le agregan las advertencias de antigüedad. */
  advertencias: string[];
}

interface Dato {
  data: unknown;
  meta: MetaDatos;
}

interface RutaPaquete {
  /** Parámetros de la query en el orden en que la API los revisa, y si son obligatorios. */
  consulta?: readonly (readonly [nombre: string, obligatorio: boolean])[];
  responder(c: Contexto, n: Nucleo): Promise<Dato> | Dato;
}

const DOCS = "https://github.com/Dagel4k/mexicoapi/blob/main/docs";
const MS_POR_DIA = 86_400_000;

const nucleo = (): Promise<Nucleo> => import("@mexicoapi/core");
const estados = () => import("../datos/estados.js");
const municipios = () => import("../datos/municipios.js");
const bancos = () => import("../datos/bancos.js");

const falla = (
  c: Contexto,
  tipo: TipoLocal,
  detalle: string,
  extras?: Readonly<Record<string, unknown>>,
): MexicoApiError => problemaLocal(c, tipo, detalle, extras);

/** El `meta` de un dataset con el enlace a la sección de la API, como en las rutas calculadas. */
const conDocs = (meta: MetaDatos, seccion: string): MetaDatos => ({
  ...meta,
  docs: `${DOCS}/api/README.md#${seccion}`,
});

function existe<T>(c: Contexto, valor: T | undefined, recurso: string): T {
  if (valor === undefined) throw falla(c, "no-encontrado", `No existe ${recurso}.`);
  return valor;
}

/** El valor de un parámetro que ya pasó su regla. */
const valor = (c: Contexto, nombre: string): string => c.valores[nombre] as string;

type Regla = readonly [cumple: (valor: string) => boolean, detalle: string];

/** Las reglas de la API para la query de las rutas que responde el paquete. */
function reglas(n: Nucleo): Readonly<Record<string, Regla>> {
  const fecha = (que: string, nombre: string): Regla => [
    n.esFechaIsoValida,
    `La ${que} (${nombre}) debe ser una fecha válida con formato AAAA-MM-DD.`,
  ];
  return {
    autoridad: [(v) => v === "lft", "Autoridades disponibles: lft."],
    desde: fecha("fecha de partida", "desde"),
    dias: [
      (v) => /^[1-9]\d{0,3}$/.test(v) && Number(v) <= 3650,
      "Los días hábiles (dias) deben ser un entero de 1 a 3650, sin ceros a la izquierda.",
    ],
    permitir_incompleto: [
      (v) => v === "true" || v === "false",
      "El parámetro permitir_incompleto debe ser true o false.",
    ],
    // No hay año 0000: las fechas van de 0001 a 9999.
    anio: [
      (v) => /^\d{4}$/.test(v) && v !== "0000",
      "El año (anio) debe tener 4 dígitos, de 0001 a 9999.",
    ],
    publicado: fecha("fecha de publicación", "publicado"),
    operacion: fecha("fecha de la operación", "operacion"),
    fecha: fecha("fecha del valor", "fecha"),
  };
}

/** Responde `plantilla` con el paquete: carga el núcleo, revisa la query y responde. */
export async function responderPaquete(plantilla: RutaDelPaquete, c: Contexto): Promise<Dato> {
  const ruta = PAQUETE[plantilla];
  const n = await nucleo();
  const r = reglas(n);
  for (const [nombre, obligatorio] of ruta.consulta ?? []) {
    const v = c.valores[nombre];
    const parametro = { parametro: nombre };
    if (v === undefined) {
      if (!obligatorio) continue;
      throw falla(c, "parametro-faltante", `Falta el parámetro ${nombre}.`, parametro);
    }
    const [cumple, detalle] = r[nombre] as Regla;
    if (v === "") {
      throw falla(c, "parametro-invalido", `El parámetro ${nombre} está vacío.`, parametro);
    }
    if (!cumple(v)) throw falla(c, "parametro-invalido", detalle, parametro);
  }
  return ruta.responder(c, n);
}

/** Los días de la LFT salen del núcleo; su `meta` es el que da la API. */
const metaLft = (n: Nucleo, seccion: string): MetaDatos => ({
  dataset: "dias-inhabiles.lft",
  as_of: n.VIGENCIA_LFT,
  sources: [
    {
      name: "Ley Federal del Trabajo, artículos 74 y 715",
      url: n.FUENTE_LFT_74.url,
      license:
        "Texto legislativo, no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII)",
      license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
      citation:
        "Ley Federal del Trabajo, artículos 74 y 715, texto vigente con última reforma publicada en el DOF el 14 de mayo de 2026.",
    },
  ],
  docs: `${DOCS}/api/README.md#${seccion}`,
});

function calendarioIncompleto(
  c: Contexto,
  fecha: FechaISO,
  { desde, hasta }: CoberturaSerie,
  queNoCubre: string,
): MexicoApiError {
  return falla(
    c,
    "calendario-incompleto",
    `El calendario de lft no cubre ${queNoCubre}; cubre del ${desde} al ${hasta}.`,
    { autoridad: "lft", fecha, cobertura: { desde, hasta } },
  );
}

interface Serie {
  meta: MetaDatos;
  cobertura: CoberturaSerie;
}

/**
 * Una serie del paquete (FIX o UDIS) con más de 7 días de antigüedad: lo que pase después de su
 * último dato solo lo tiene la API.
 */
function antiguedad(c: Contexto, { meta, cobertura }: Serie): void {
  const dias = Math.floor((Date.now() - Date.parse(cobertura.hasta)) / MS_POR_DIA);
  if (dias > 7) {
    c.advertencias.push(
      `Los datos de ${meta.dataset} del paquete llegan hasta el ${cobertura.hasta}, hace ${dias} días; la API puede tener datos más recientes.`,
    );
  }
}

/** El registro, o el 404 que corresponde: `sin_dato` es definitivo, `no_disponible` no. */
function deSerie<T>(
  c: Contexto,
  serie: Serie,
  seccion: string,
  consulta: Consulta<T>,
  fecha: FechaISO,
  textos: { sinDato: string; noDisponible: string },
  data: (registro: T) => unknown = (registro) => registro,
): Dato {
  antiguedad(c, serie);
  if (consulta.tipo === "encontrado") {
    return { data: data(consulta.registro), meta: conDocs(serie.meta, seccion) };
  }
  const { desde, hasta } = serie.cobertura;
  throw falla(
    c,
    consulta.tipo === "sin_dato" ? "no-encontrado" : "dato-no-disponible",
    consulta.tipo === "sin_dato" ? textos.sinDato : textos.noDisponible,
    { fecha, cobertura: { desde, hasta } },
  );
}

const empiezaEl = ({ cobertura }: Serie, queFalta: string): string =>
  `La serie del paquete empieza el ${cobertura.desde}; no incluye ${queFalta}.`;

/** Cómo responde el paquete cada ruta que tiene, por su plantilla. */
export const PAQUETE: Readonly<Record<RutaDelPaquete, RutaPaquete>> = {
  "/v1/estados": {
    responder: async () => {
      const m = await estados();
      return { data: m.estados(), meta: m.meta };
    },
  },
  "/v1/estados/{cve_ent}": {
    responder: async (c) => {
      const m = await estados();
      const cve = valor(c, "cve_ent");
      return { data: existe(c, m.estado(cve), `el estado ${cve}`), meta: m.meta };
    },
  },
  "/v1/estados/{cve_ent}/municipios": {
    responder: async (c) => {
      const [e, m] = await Promise.all([estados(), municipios()]);
      const cve = valor(c, "cve_ent");
      existe(c, e.estado(cve), `el estado ${cve}`);
      return { data: m.municipios(cve), meta: m.meta };
    },
  },
  "/v1/municipios": {
    responder: async () => {
      const m = await municipios();
      return { data: m.municipios(), meta: m.meta };
    },
  },
  "/v1/municipios/{cvegeo}": {
    responder: async (c) => {
      const m = await municipios();
      const cvegeo = valor(c, "cvegeo");
      return { data: existe(c, m.municipio(cvegeo), `el municipio ${cvegeo}`), meta: m.meta };
    },
  },
  "/v1/bancos": {
    responder: async () => {
      const m = await bancos();
      return { data: m.bancos(), meta: m.meta };
    },
  },
  "/v1/bancos/{codigo}": {
    responder: async (c) => {
      const m = await bancos();
      const codigo = valor(c, "codigo");
      return { data: existe(c, m.banco(codigo), `el banco ${codigo}`), meta: m.meta };
    },
  },
  "/v1/clabe/{clabe}": {
    responder: async (c, n) => {
      const m = await bancos();
      return {
        data: n.validarClabe(valor(c, "clabe"), { bancos: m.catalogoClabe() }),
        meta: conDocs(m.meta, "clabe"),
      };
    },
  },
  "/v1/dias-habiles": {
    consulta: [
      ["autoridad", true],
      ["desde", true],
      ["dias", true],
      ["permitir_incompleto", false],
    ],
    responder: (c, n) => {
      try {
        const data = n.sumarDiasHabiles({
          calendario: n.calendarioLft(),
          desde: valor(c, "desde"),
          dias: Number(valor(c, "dias")),
          permitirIncompleto: c.valores.permitir_incompleto === "true",
        });
        return { data, meta: metaLft(n, "dias-habiles") };
      } catch (error) {
        // Los errores del núcleo traen `codigo` para reconocerlos sin instanceof.
        const codigo = (error as { codigo?: unknown }).codigo;
        if (codigo === "calendario-incompleto") {
          const { fecha, cobertura } = error as InstanceType<Nucleo["CalendarioIncompletoError"]>;
          throw calendarioIncompleto(c, fecha, cobertura, fecha);
        }
        if (codigo === "fecha-fuera-de-rango") {
          const detalle = "Con estos días, el resultado pasaría del año 9999.";
          throw falla(c, "parametro-invalido", detalle, { parametro: "desde" });
        }
        throw error;
      }
    },
  },
  "/v1/dias-inhabiles": {
    consulta: [
      ["autoridad", true],
      ["anio", true],
    ],
    responder: (c, n) => {
      const anio = valor(c, "anio");
      const cobertura = n.COBERTURA_LFT;
      if (`${anio}-01-01` < cobertura.desde || `${anio}-12-31` > cobertura.hasta) {
        throw calendarioIncompleto(c, `${anio}-01-01`, cobertura, `el año ${anio}`);
      }
      return { data: n.diasDescansoLft(Number(anio)), meta: metaLft(n, "dias-inhabiles") };
    },
  },
  "/v1/tipo-cambio/fix": {
    consulta: [
      ["publicado", false],
      ["operacion", false],
    ],
    responder: async (c, n) => {
      const { publicado, operacion } = c.valores;
      if (publicado !== undefined && operacion !== undefined) {
        throw falla(c, "parametro-invalido", "Indica solo uno de publicado u operacion.");
      }
      const s = await import("../datos/fix.js");
      if (publicado !== undefined) {
        return deSerie(
          c,
          s,
          "tipo-de-cambio-fix",
          n.fixPublicado(s.serie, s.tramo, s.cobertura, publicado),
          publicado,
          {
            sinDato:
              publicado < s.cobertura.desde
                ? empiezaEl(s, `el ${publicado}`)
                : `No hubo publicación del FIX en el DOF el ${publicado}.`,
            noDisponible: `El FIX del ${publicado} no está en los datos del paquete; la última publicación que traen es del ${s.cobertura.hasta}.`,
          },
        );
      }
      if (operacion === undefined) {
        throw falla(c, "parametro-faltante", "Indica publicado u operacion.");
      }
      return deSerie(
        c,
        s,
        "tipo-de-cambio-fix",
        n.fixParaOperacion(s.serie, s.tramo, s.cobertura, operacion),
        operacion,
        {
          sinDato: empiezaEl(s, `la publicación que aplica a una operación del ${operacion}`),
          noDisponible: `Los datos del paquete no traen el FIX que aplica a una operación del ${operacion}; la última publicación que traen es del ${s.cobertura.hasta}.`,
        },
        (registro) => ({
          fecha_operacion: operacion,
          fecha_publicacion: registro.fecha_publicacion,
          valor: registro.valor,
          fundamento: n.FUENTE_CFF_20,
        }),
      );
    },
  },
  "/v1/tipo-cambio/fix/ultimo": {
    responder: async (c) => {
      const s = await import("../datos/fix.js");
      antiguedad(c, s);
      return { data: s.serie.at(-1), meta: conDocs(s.meta, "tipo-de-cambio-fix") };
    },
  },
  "/v1/udis": {
    consulta: [["fecha", true]],
    responder: async (c, n) => {
      const s = await import("../datos/udis.js");
      const fecha = valor(c, "fecha");
      return deSerie(c, s, "udis", n.udiDeFecha(s.serie, s.tramo, s.cobertura, fecha), fecha, {
        sinDato:
          fecha < s.cobertura.desde
            ? empiezaEl(s, `el ${fecha}`)
            : `No hay valor de la UDI para el ${fecha}.`,
        noDisponible: `El valor de la UDI del ${fecha} no está en los datos del paquete; el último que traen es del ${s.cobertura.hasta}.`,
      });
    },
  },
};
