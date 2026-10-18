import { crearCache } from "./cache.js";
import { congelar } from "./comun.js";
import { MexicoApiError, problemaLocal } from "./error.js";
import { type ConfigHttp, type Pedido, pedirApi } from "./http.js";
import type { Contexto } from "./paquete.js";
import type {
  Cliente,
  OpcionesCliente,
  OpcionesConsulta,
  RespuestaSinMeta,
  RutaApi,
} from "./tipos.js";

interface Config extends ConfigHttp {
  offline: boolean;
}

/**
 * De dónde sale cada ruta que el cliente conoce: `estable`, del paquete salvo que se pida la API;
 * `caduca`, de la API con el paquete de respaldo; `api`, solo de la API. Una ruta que no está
 * aquí (agregada a RutasApi por quien usa el cliente) va siempre a la API.
 */
export const RUTAS = {
  "/v1/estados": "estable",
  "/v1/estados/{cve_ent}": "estable",
  "/v1/estados/{cve_ent}/municipios": "estable",
  "/v1/municipios": "estable",
  "/v1/municipios/{cvegeo}": "estable",
  "/v1/bancos": "estable",
  "/v1/bancos/{codigo}": "estable",
  "/v1/clabe/{clabe}": "estable",
  "/v1/dias-habiles": "caduca",
  "/v1/dias-inhabiles": "caduca",
  "/v1/tipo-cambio/fix": "caduca",
  "/v1/tipo-cambio/fix/ultimo": "caduca",
  "/v1/udis": "caduca",
  "/v1/status": "api",
} as const satisfies Record<RutaApi, "estable" | "caduca" | "api">;

/** Las rutas que el paquete sabe responder. */
export type RutaDelPaquete = {
  [R in keyof typeof RUTAS]: (typeof RUTAS)[R] extends "api" ? never : R;
}[keyof typeof RUTAS];

const modoDe = (plantilla: string): (typeof RUTAS)[RutaApi] | undefined =>
  Object.hasOwn(RUTAS, plantilla) ? RUTAS[plantilla as RutaApi] : undefined;

/** Reglas de la API para los valores de la ruta; se revisan antes de armar la URL. */
const REGLAS_RUTA: Readonly<Record<string, readonly [RegExp, string]>> = {
  cve_ent: [/^\d{2}$/, "La clave de estado (cve_ent) debe tener 2 dígitos."],
  cvegeo: [/^\d{5}$/, "La clave de municipio (cvegeo) debe tener 5 dígitos."],
  codigo: [/^\d{3}$/, "El código de banco debe tener 3 dígitos."],
  clabe: [/^\d{18}$/, "La CLABE debe tener 18 dígitos."],
};

function baseDe(base: string | { readonly href: string }): string {
  const texto = typeof base === "string" ? base : base.href;
  if (!/^https?:\/\/[^/?#\s]+(?:\/[^?#\s]*)?$/i.test(texto)) {
    throw new TypeError(
      "base debe ser una URL http o https sin query ni fragmento, como https://mexicoapi.example.workers.dev.",
    );
  }
  return texto.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function configurar(o: OpcionesCliente): Config {
  const timeoutMs = o.timeoutMs ?? 10_000;
  // Más de 2^31 - 1 ms desborda setTimeout, que entonces dispara de inmediato.
  if (!(typeof timeoutMs === "number" && timeoutMs > 0 && timeoutMs <= 2_147_483_647)) {
    throw new RangeError(
      "timeoutMs debe ser un número de milisegundos mayor que 0 y de hasta 2147483647.",
    );
  }
  const reintentos = o.reintentos ?? 2;
  if (!(Number.isInteger(reintentos) && reintentos >= 0 && reintentos <= 10)) {
    throw new RangeError("reintentos debe ser un entero de 0 a 10.");
  }
  if (o.fetch !== undefined && typeof o.fetch !== "function") {
    throw new TypeError("fetch debe ser una función como el fetch global.");
  }
  const cache = o.cache === true ? {} : o.cache || undefined;
  const ttlMs = cache?.ttlMs ?? 300_000;
  if (!(Number.isFinite(ttlMs) && ttlMs > 0)) {
    throw new RangeError("cache.ttlMs debe ser un número de milisegundos mayor que 0.");
  }
  const maxEntradas = cache?.maxEntradas ?? 100;
  if (!(Number.isInteger(maxEntradas) && maxEntradas > 0)) {
    throw new RangeError("cache.maxEntradas debe ser un entero mayor que 0.");
  }
  return {
    base: o.base === undefined ? undefined : baseDe(o.base),
    timeoutMs,
    reintentos,
    fetch: o.fetch,
    cache: cache === undefined ? undefined : crearCache(maxEntradas),
    ttlMs,
    offline: o.offline === true,
  };
}

/**
 * Arma la URL de `plantilla` con sus valores (codificados) y el resto como query, y revisa los
 * valores de la ruta. Los errores llevan la plantilla, nunca los valores de la ruta.
 */
function armar(
  c: Config,
  plantilla: string,
  parametros: Readonly<Record<string, unknown>>,
  signal: OpcionesConsulta["signal"],
): Pedido & Contexto {
  const valores: Record<string, string> = {};
  for (const [nombre, v] of Object.entries(parametros)) {
    if (v !== undefined) valores[nombre] = String(v);
  }
  const deRuta: [nombre: string, valor: string][] = [];
  const camino = plantilla.replace(/\{(\w+)\}/g, (_, nombre: string) => {
    const v = valores[nombre];
    if (v === undefined) throw new TypeError(`Falta el parámetro ${nombre} de ${plantilla}.`);
    deRuta.push([nombre, v]);
    return encodeURIComponent(v);
  });
  const query = Object.entries(valores)
    .filter(([nombre]) => !deRuta.some(([n]) => n === nombre))
    .map(([nombre, v]) => `${encodeURIComponent(nombre)}=${encodeURIComponent(v)}`)
    .join("&");
  const sufijo = query === "" ? "" : `?${query}`;
  // Cada valor de la ruta, tal cual y codificado, con su nombre. Se cambian en una sola pasada y
  // los más largos primero, para no cortar un valor que contiene a otro.
  const ocultos = new Map<string, string>();
  for (const [nombre, v] of deRuta) {
    if (v !== "") ocultos.set(v, nombre).set(encodeURIComponent(v), nombre);
  }
  const patron = new RegExp(
    [...ocultos.keys()]
      .sort((a, b) => b.length - a.length)
      .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|") || "(?!)",
    "g",
  );
  const modo = modoDe(plantilla);
  const pedido: Pedido & Contexto = {
    camino: camino + sufijo,
    urlOculta: (c.base ?? "") + plantilla + sufijo,
    instancia: plantilla,
    ocultar: (texto) => texto.replace(patron, (v) => `{${ocultos.get(v)}}`),
    // /v1/status no trae meta; una ruta que el cliente no conoce, solo si llega.
    conMeta: modo === "estable" || modo === "caduca",
    signal,
    valores,
    advertencias: [],
  };
  for (const [nombre, v] of deRuta) {
    const regla = Object.hasOwn(REGLAS_RUTA, nombre) ? REGLAS_RUTA[nombre] : undefined;
    if (regla !== undefined && !regla[0].test(v)) {
      throw problemaLocal(pedido, "parametro-invalido", regla[1], { parametro: nombre });
    }
  }
  return pedido;
}

/** Un problema que la API dio como respuesta a la consulta (un 4xx con problem+json salvo 429). */
const esDefinitivo = (error: MexicoApiError): boolean =>
  error.status >= 400 && error.status < 500 && error.status !== 429 && error.type !== "about:blank";

/** Responde con el paquete; su código, el núcleo y los datos se cargan aquí, al usarlos. */
async function desdePaquete(
  plantilla: RutaDelPaquete,
  pedido: Pedido & Contexto,
  causa?: MexicoApiError,
): Promise<RespuestaSinMeta<unknown>> {
  const { responderPaquete } = await import("./paquete.js");
  const contexto: Contexto = { ...pedido, causa };
  if (causa !== undefined) {
    contexto.advertencias.push(
      `Respuesta de los datos del paquete porque la API falló: ${causa.message}`,
    );
  }
  const { data, meta } = await responderPaquete(plantilla, contexto);
  return congelar({ data, meta, origen: "paquete" as const, advertencias: contexto.advertencias });
}

async function ejecutar(
  c: Config,
  plantilla: string,
  parametros: Readonly<Record<string, unknown>> | undefined,
  opciones: OpcionesConsulta | undefined,
): Promise<RespuestaSinMeta<unknown>> {
  const { fuente, signal } = opciones ?? {};
  if (signal?.aborted) throw signal.reason;
  if (fuente !== undefined && fuente !== "api" && fuente !== "paquete") {
    throw new TypeError('fuente debe ser "api" o "paquete".');
  }
  const pedido = armar(c, plantilla, parametros ?? {}, signal);
  const modo = modoDe(plantilla);
  const paquete = modo === "estable" || modo === "caduca" ? (plantilla as RutaDelPaquete) : null;
  const desde = c.offline ? "paquete" : fuente;
  if (desde === "paquete" || (desde === undefined && modo === "estable")) {
    if (paquete === null) {
      throw new Error(`El paquete no trae ${plantilla}: solo la API la responde.`);
    }
    return desdePaquete(paquete, pedido);
  }
  try {
    return await pedirApi(c, pedido);
  } catch (error) {
    if (desde === "api" || paquete === null) throw error;
    if (!(error instanceof MexicoApiError) || esDefinitivo(error)) throw error;
    return desdePaquete(paquete, pedido, error);
  }
}

/**
 * Cliente de la API de MéxicoAPI. Los datos estables (estados, municipios, bancos, validación de
 * la CLABE) salen del paquete sin red; los que caducan (días hábiles e inhábiles, FIX, UDIS) se
 * piden a la API y, si no responde, salen del paquete con `origen: "paquete"` y advertencias.
 * Cada respuesta dice su `origen`; todo lo que entrega está congelado.
 */
export function crearCliente(opciones: OpcionesCliente = {}): Cliente {
  const c = configurar(opciones);
  type Pedir = (
    plantilla: string,
    parametros?: Readonly<Record<string, unknown>>,
    opciones?: OpcionesConsulta,
  ) => Promise<never>;
  const pedir = ((plantilla, parametros, op) => ejecutar(c, plantilla, parametros, op)) as Pedir;
  return Object.freeze<Cliente>({
    consultar: pedir as Cliente["consultar"],
    estados: (op) => pedir("/v1/estados", {}, op),
    estado: (cve_ent, op) => pedir("/v1/estados/{cve_ent}", { cve_ent }, op),
    municipios: (cve_ent, op) =>
      cve_ent === undefined
        ? pedir("/v1/municipios", {}, op)
        : pedir("/v1/estados/{cve_ent}/municipios", { cve_ent }, op),
    municipio: (cvegeo, op) => pedir("/v1/municipios/{cvegeo}", { cvegeo }, op),
    bancos: (op) => pedir("/v1/bancos", {}, op),
    banco: (codigo, op) => pedir("/v1/bancos/{codigo}", { codigo }, op),
    clabe: (clabe, op) => pedir("/v1/clabe/{clabe}", { clabe }, op),
    diasHabiles: ({ desde, dias, autoridad = "lft", permitirIncompleto }, op) =>
      pedir(
        "/v1/dias-habiles",
        { autoridad, desde, dias, permitir_incompleto: permitirIncompleto },
        op,
      ),
    diasInhabiles: ({ anio, autoridad = "lft" }, op) =>
      pedir("/v1/dias-inhabiles", { autoridad, anio }, op),
    fixPublicado: (fecha, op) => pedir("/v1/tipo-cambio/fix", { publicado: fecha }, op),
    fixParaOperacion: (fecha, op) => pedir("/v1/tipo-cambio/fix", { operacion: fecha }, op),
    fixUltimo: (op) => pedir("/v1/tipo-cambio/fix/ultimo", {}, op),
    udi: (fecha, op) => pedir("/v1/udis", { fecha }, op),
    status: (op) => pedir("/v1/status", {}, op),
  });
}
