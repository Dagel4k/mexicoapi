// Respuestas desde los datos y el núcleo que trae el paquete, con la forma de las de la API: las
// mismas reglas para los parámetros, los mismos problemas y el mismo `meta`, que salen del núcleo
// (`rutas`). Este módulo, el núcleo y cada dataset se cargan con un import dinámico solo al
// usarlos: quien solo consulta la API no los carga y un bundler los deja en archivos aparte.
import type {
  CoberturaSerie,
  Consulta,
  FechaISO,
  OpcionesFix,
  TipoCambioFix,
} from "@mexicoapi/core";
import {
  CONSULTAS,
  consultarConFeriados,
  problemaSinRegistro,
  revisarConsulta,
  revisarFix,
} from "@mexicoapi/core/rutas";
import type { MetaDatos } from "../datos/tipos.js";
import type { RutaDelPaquete } from "./cliente.js";
import {
  type Contexto,
  conDocs,
  type Dato,
  falla,
  fallaDe,
  type Nucleo,
  type RutaPaquete,
  valor,
} from "./paquete-comun.js";
import { SALARIO_MINIMO, TARIFA_ISR, UMA, UMA_VIGENTE } from "./paquete-constantes.js";
import { DIAS_HABILES, DIAS_INHABILES } from "./paquete-dias.js";

const MS_POR_DIA = 86_400_000;

const nucleo = (): Promise<Nucleo> => import("@mexicoapi/core");
const estados = () => import("../datos/estados.js");
const municipios = () => import("../datos/municipios.js");
const bancos = () => import("../datos/bancos.js");
const calendarios = () => import("../datos/calendarios.js");

/** El texto nombra el valor pedido, como el 404 de la API: se oculta. */
function existe<T>(c: Contexto, valor: T | undefined, recurso: string): T {
  if (valor === undefined) throw falla(c, "no-encontrado", c.ocultar(`No existe ${recurso}.`));
  return valor;
}

/**
 * Responde `plantilla` con el paquete: revisa la query con las reglas del núcleo, en el orden de
 * la API (sin nombre, desconocidos, cada regla), carga el núcleo y responde.
 */
export async function responderPaquete(plantilla: RutaDelPaquete, c: Contexto): Promise<Dato> {
  const reglas = Object.hasOwn(CONSULTAS, plantilla)
    ? CONSULTAS[plantilla as keyof typeof CONSULTAS]
    : {};
  const revision = revisarConsulta(reglas, c.query);
  if (!("consulta" in revision)) throw fallaDe(c, revision);
  return PAQUETE[plantilla].responder(c, await nucleo());
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
  const texto = consulta.tipo === "sin_dato" ? textos.sinDato : textos.noDisponible;
  const extras = { fecha, cobertura: { desde, hasta } };
  throw fallaDe(c, problemaSinRegistro(consulta.tipo, texto, extras));
}

/**
 * La consulta del FIX del núcleo, como la API: los feriados bancarios de la CNBV se cargan solo
 * si sin ellos la consulta da no_disponible.
 */
const conFeriados = (
  consultar: (opciones?: OpcionesFix) => Consulta<TipoCambioFix>,
): Promise<Consulta<TipoCambioFix>> =>
  consultarConFeriados(consultar, async () => (await calendarios()).feriadoBancario);

const empiezaEl = ({ cobertura }: Serie, queFalta: string): string =>
  `La serie del paquete empieza el ${cobertura.desde}; no incluye ${queFalta}.`;

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
  "/v1/dias-habiles": DIAS_HABILES,
  "/v1/dias-inhabiles": DIAS_INHABILES,
  "/v1/tipo-cambio/fix": {
    responder: async (c, n) => {
      const { publicado, operacion } = c.valores;
      const combinacion = revisarFix(publicado, operacion);
      if (combinacion !== null) throw fallaDe(c, combinacion);
      const s = await import("../datos/fix.js");
      if (publicado !== undefined) {
        return deSerie(
          c,
          s,
          "tipo-de-cambio-fix",
          await conFeriados((op) => n.fixPublicado(s.serie, s.tramo, s.cobertura, publicado, op)),
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
      // revisarFix ya exigió una de las dos.
      const fecha = operacion as FechaISO;
      return deSerie(
        c,
        s,
        "tipo-de-cambio-fix",
        await conFeriados((op) => n.fixParaOperacion(s.serie, s.tramo, s.cobertura, fecha, op)),
        fecha,
        {
          sinDato: empiezaEl(s, `la publicación que aplica a una operación del ${fecha}`),
          noDisponible: `Los datos del paquete no traen el FIX que aplica a una operación del ${fecha}; la última publicación que traen es del ${s.cobertura.hasta}.`,
        },
        (registro) => ({
          fecha_operacion: fecha,
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
  "/v1/constantes/uma": UMA_VIGENTE,
  "/v1/constantes/uma/{anio}": UMA,
  "/v1/constantes/salario-minimo/{anio}": SALARIO_MINIMO,
  "/v1/isr/tarifa/{periodo}/{anio}": TARIFA_ISR,
};
