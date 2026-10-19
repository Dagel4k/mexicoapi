import { avisosDe } from "@mexicoapi/core/avisos";
import { cumpleRegla, REGLAS_RUTA } from "@mexicoapi/core/parametros";
import { URL_API } from "@mexicoapi/core/problemas";
import { crearCache } from "./cache.js";
import { AVISO_RESPALDO, congelar, esObjeto, type Objeto, type RespuestaPrevia } from "./comun.js";
import { MexicoApiError, problemaLocal } from "./error.js";
import { type ConfigHttp, esDefinitivo, type Pedido, pedirApi } from "./http.js";
import type { Contexto } from "./paquete-comun.js";
import type {
  Cliente,
  ConsultaDiasHabiles,
  OpcionesCliente,
  OpcionesConsulta,
  RespuestaSinMeta,
  RutaApi,
  RutasApi,
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
  // Los calendarios curados y las constantes cambian con cada publicación en el DOF.
  "/v1/constantes/uma": "caduca",
  "/v1/constantes/uma/{anio}": "caduca",
  "/v1/constantes/salario-minimo/{anio}": "caduca",
  "/v1/isr/tarifa/{periodo}/{anio}": "caduca",
  "/v1/status": "api",
} as const satisfies Record<RutaApi, "estable" | "caduca" | "api">;

/** Las rutas que el paquete sabe responder. */
export type RutaDelPaquete = {
  [R in keyof typeof RUTAS]: (typeof RUTAS)[R] extends "api" ? never : R;
}[keyof typeof RUTAS];

const modoDe = (plantilla: string): (typeof RUTAS)[RutaApi] | undefined =>
  Object.hasOwn(RUTAS, plantilla) ? RUTAS[plantilla as RutaApi] : undefined;

/** `lista` si la ruta responde un arreglo en `data`; `objeto` si responde otra cosa. */
type FormaDe<R extends RutaApi> = RutasApi[R]["respuesta"]["data"] extends readonly unknown[]
  ? "lista"
  : "objeto";

/**
 * Qué trae `data` en cada ruta que el cliente conoce; una respuesta de la API con otra forma es
 * una respuesta inesperada. El tipo de cada valor sale de `RutasApi`.
 */
export const FORMAS = {
  "/v1/estados": "lista",
  "/v1/estados/{cve_ent}": "objeto",
  "/v1/estados/{cve_ent}/municipios": "lista",
  "/v1/municipios": "lista",
  "/v1/municipios/{cvegeo}": "objeto",
  "/v1/bancos": "lista",
  "/v1/bancos/{codigo}": "objeto",
  "/v1/clabe/{clabe}": "objeto",
  "/v1/dias-habiles": "objeto",
  "/v1/dias-inhabiles": "lista",
  "/v1/tipo-cambio/fix": "objeto",
  "/v1/tipo-cambio/fix/ultimo": "objeto",
  "/v1/udis": "objeto",
  "/v1/constantes/uma": "objeto",
  "/v1/constantes/uma/{anio}": "objeto",
  "/v1/constantes/salario-minimo/{anio}": "lista",
  "/v1/isr/tarifa/{periodo}/{anio}": "objeto",
  "/v1/status": "lista",
} as const satisfies { [R in RutaApi]: FormaDe<R> };

const formaDe = (plantilla: string): "lista" | "objeto" | undefined =>
  Object.hasOwn(FORMAS, plantilla) ? FORMAS[plantilla as RutaApi] : undefined;

function baseDe(base: string | { readonly href: string }): string {
  const texto = typeof base === "string" ? base : base.href;
  // Lineal: el origen no lleva "/" y la ruta empieza con "/", así que no hay dos formas de partirla.
  if (!/^https?:\/\/[^/?#\s]+(?:\/[^?#\s]*)?$/i.test(texto)) {
    throw new TypeError(
      "base debe ser una URL http o https sin query ni fragmento, como https://mexicoapi.example.workers.dev.",
    );
  }
  const desde = texto.indexOf("//") + 2;
  const hasta = texto.indexOf("/", desde);
  // fetch rechaza una URL con credenciales y el error las dejaría en `url`.
  if (texto.slice(desde, hasta === -1 ? texto.length : hasta).includes("@")) {
    throw new TypeError(
      "base no lleva usuario ni contraseña (usuario:clave@); pasa solo el origen de la API, como https://mexicoapi.example.workers.dev.",
    );
  }
  let fin = texto.length;
  while (texto.endsWith("/", fin)) fin--;
  return texto.slice(0, fin).replace(/\/v1$/i, "");
}

/** Lo más que acepta setTimeout: más de 2^31 - 1 ms desborda y dispara de inmediato. */
const MS_MAX = 2_147_483_647;

function configurar(o: OpcionesCliente): Config {
  const timeoutMs = o.timeoutMs ?? 10_000;
  if (!(typeof timeoutMs === "number" && timeoutMs > 0 && timeoutMs <= MS_MAX)) {
    throw new RangeError(
      "timeoutMs debe ser un número de milisegundos mayor que 0 y de hasta 2147483647.",
    );
  }
  const esperaMaximaMs = o.esperaMaximaMs ?? 10_000;
  if (!(typeof esperaMaximaMs === "number" && esperaMaximaMs >= 0 && esperaMaximaMs <= MS_MAX)) {
    throw new RangeError("esperaMaximaMs debe ser un número de milisegundos de 0 a 2147483647.");
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
    // Sin base, la API pública. Con offline: true nunca se pide nada a la API: sin base, los
    // errores dan solo la ruta.
    base: o.base !== undefined ? baseDe(o.base) : o.offline === true ? "" : baseDe(URL_API),
    timeoutMs,
    reintentos,
    esperaMaximaMs,
    fetch: o.fetch,
    cache: cache === undefined ? undefined : crearCache(maxEntradas),
    ttlMs,
    offline: o.offline === true,
  };
}

/** Parámetros de ruta que nunca aparecen en errores, URLs ni causas. */
const SENSIBLES: ReadonlySet<string> = new Set(["clabe"]);

/**
 * Arma la URL de `plantilla` con sus valores (codificados) y el resto como query, y revisa los
 * valores de la ruta. Los errores llevan los valores públicos de la ruta y `{nombre}` en lugar de los sensibles.
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
  // Solo se ocultan los sensibles (la CLABE): las claves de catálogo (código de banco, cvegeo,
  // entidad) son públicas y se muestran, igual que en los errores de la API.
  const ocultos = new Map<string, string>();
  for (const [nombre, v] of deRuta) {
    if (SENSIBLES.has(nombre) && v !== "")
      ocultos.set(v, nombre).set(encodeURIComponent(v), nombre);
  }
  const visible = plantilla.replace(/\{(\w+)\}/g, (marca, nombre: string) =>
    SENSIBLES.has(nombre) ? marca : encodeURIComponent(valores[nombre] as string),
  );
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
    urlOculta: c.base + visible + sufijo,
    instancia: visible,
    ocultar: (texto) => texto.replace(patron, (v) => `{${ocultos.get(v)}}`),
    // /v1/status no trae meta; una ruta que el cliente no conoce, solo si llega.
    conMeta: modo === "estable" || modo === "caduca",
    forma: formaDe(plantilla),
    signal,
    valores,
    query,
    advertencias: [],
  };
  // Las reglas de la API para los valores de la ruta, las del núcleo: antes de armar la URL.
  for (const [nombre, v] of deRuta) {
    const regla = Object.hasOwn(REGLAS_RUTA, nombre)
      ? REGLAS_RUTA[nombre as keyof typeof REGLAS_RUTA]
      : undefined;
    if (regla !== undefined && !cumpleRegla(regla, v)) {
      throw problemaLocal(pedido, "parametro-invalido", regla.detalle, { parametro: nombre });
    }
  }
  return pedido;
}

/** Responde con el paquete; su código, el núcleo y los datos se cargan aquí, al usarlos. */
async function desdePaquete(
  plantilla: RutaDelPaquete,
  pedido: Pedido & Contexto,
  causa?: MexicoApiError,
): Promise<RespuestaPrevia> {
  const { responderPaquete } = await import("./paquete.js");
  const contexto: Contexto = { ...pedido, causa };
  if (causa !== undefined) {
    contexto.advertencias.push(`${AVISO_RESPALDO}: ${causa.message}`);
  }
  const { data, meta, advertencias = [] } = await responderPaquete(plantilla, contexto);
  return congelar({
    data,
    meta,
    origen: "paquete" as const,
    // Primero las del cliente (respaldo, antigüedad) y luego las que daría la API.
    advertencias: [...contexto.advertencias, ...advertencias],
  });
}

/**
 * `r` con las advertencias del cálculo (`data.advertencias`, en `/v1/dias-habiles`) también en las
 * de primer nivel, después de las que ya trae y sin repetir ninguna: quien solo mira `advertencias`
 * ve todo lo que hay que decir. `data` no cambia.
 */
function conAdvertenciasDelCalculo(r: RespuestaPrevia): RespuestaPrevia {
  const delCalculo = esObjeto(r.data) ? r.data.advertencias : undefined;
  if (!Array.isArray(delCalculo)) return r;
  const textos = delCalculo.filter((a): a is string => typeof a === "string");
  const todas = [...new Set([...r.advertencias, ...textos])];
  // Igual a las que ya trae (ninguna nueva ni repetida): la misma respuesta.
  if (todas.length === r.advertencias.length && todas.every((a, i) => a === r.advertencias[i])) {
    return r;
  }
  return congelar({ ...r, advertencias: todas });
}

/**
 * `r` con `avisos`: sus advertencias con su código, en el mismo orden. Si `data` trae advertencias
 * (`/v1/dias-habiles`), también `data.avisos` con las suyas, solo los textos. Los códigos salen
 * del catálogo del cliente aunque la API ya los traiga (una API anterior no los trae y una nueva
 * puede tener códigos que esta versión no conoce): así siempre son de `CodigoAviso`.
 */
function conAvisos(r: RespuestaPrevia): RespuestaSinMeta<unknown> {
  const delCalculo = esObjeto(r.data) ? r.data.advertencias : undefined;
  const data = Array.isArray(delCalculo)
    ? {
        ...(r.data as Objeto),
        avisos: avisosDe(delCalculo.filter((a): a is string => typeof a === "string")),
      }
    : r.data;
  return congelar({ ...r, data, avisos: avisosDe(r.advertencias) });
}

/**
 * Lo que entrega el cliente por cada respuesta de `responder`: la misma respuesta guardada en la
 * caché da el mismo objeto en cada consulta.
 */
const completas = new WeakMap<RespuestaPrevia, RespuestaSinMeta<unknown>>();

async function ejecutar(
  c: Config,
  plantilla: string,
  parametros: Readonly<Record<string, unknown>> | undefined,
  opciones: OpcionesConsulta | undefined,
): Promise<RespuestaSinMeta<unknown>> {
  const r = await responder(c, plantilla, parametros, opciones);
  let completa = completas.get(r);
  if (completa === undefined) {
    completa = conAvisos(conAdvertenciasDelCalculo(r));
    completas.set(r, completa);
  }
  return completa;
}

async function responder(
  c: Config,
  plantilla: string,
  parametros: Readonly<Record<string, unknown>> | undefined,
  opciones: OpcionesConsulta | undefined,
): Promise<RespuestaPrevia> {
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
      throw new TypeError(`El paquete no trae ${plantilla}: solo la API la responde.`);
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
 * La regla de la API entre la autoridad y el tipo de plazo con el nombre del método (`tipoPlazo`):
 * TypeError antes de ir a la red o al paquete. Una autoridad que no existe la rechaza después la
 * regla de la API, como en la API. La regla se carga al usarla: importar el cliente no la carga.
 */
async function revisarDiasHabiles({
  autoridad = "lft",
  tipoPlazo,
}: ConsultaDiasHabiles): Promise<void> {
  const { NOMBRES_SDK, revisarTipoPlazoConocida } = await import("@mexicoapi/core/combinaciones");
  const combinacion = revisarTipoPlazoConocida(autoridad, tipoPlazo, NOMBRES_SDK);
  if (combinacion !== null) throw new TypeError(combinacion.detalle);
}

/**
 * Cliente de la API de MéxicoAPI. Los datos estables (estados, municipios, bancos, validación de
 * la CLABE) salen del paquete sin red; los que caducan (días hábiles e inhábiles, FIX, UDIS, UMA,
 * salario mínimo y tarifas de ISR) se piden a la API (sin `base`, la pública: `URL_API`) y, si
 * no responde, salen del paquete con `origen: "paquete"` y advertencias. Con `offline: true`
 * nunca usa la red. Cada respuesta dice su `origen`; todo lo que entrega está congelado. Los
 * métodos usan los nombres del núcleo y `consultar` los de la API (ver `Cliente`).
 */
export function crearCliente(opciones: OpcionesCliente = {}): Cliente {
  const c = configurar(opciones ?? {});
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
    diasHabiles: async (consulta, op) => {
      await revisarDiasHabiles(consulta);
      const { desde, dias, autoridad = "lft", tipoPlazo, permitirIncompleto } = consulta;
      return pedir(
        "/v1/dias-habiles",
        { autoridad, tipo_plazo: tipoPlazo, desde, dias, permitir_incompleto: permitirIncompleto },
        op,
      );
    },
    diasInhabiles: ({ anio, autoridad = "lft" }, op) =>
      pedir("/v1/dias-inhabiles", { autoridad, anio }, op),
    fixPublicado: (fecha, op) => pedir("/v1/tipo-cambio/fix", { publicado: fecha }, op),
    fixParaOperacion: (fecha, op) => pedir("/v1/tipo-cambio/fix", { operacion: fecha }, op),
    fixUltimo: (op) => pedir("/v1/tipo-cambio/fix/ultimo", {}, op),
    udi: (fecha, op) => pedir("/v1/udis", { fecha }, op),
    uma: (anio, op) => pedir("/v1/constantes/uma/{anio}", { anio }, op),
    umaVigente: (fecha, op) => pedir("/v1/constantes/uma", { fecha }, op),
    salarioMinimo: (anio, op) => pedir("/v1/constantes/salario-minimo/{anio}", { anio }, op),
    tarifaIsr: (periodo, anio, op) =>
      pedir("/v1/isr/tarifa/{periodo}/{anio}", { periodo, anio }, op),
    status: (op) => pedir("/v1/status", {}, op),
  });
}
