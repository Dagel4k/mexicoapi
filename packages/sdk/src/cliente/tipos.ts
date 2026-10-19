// Tipos públicos del cliente de la API. Solo hay tipos: este módulo no pesa en el paquete.
import type {
  Autoridad,
  Banco,
  DetalleClabe,
  DiaInhabil,
  Estado,
  FechaISO,
  Fuente,
  Municipio,
  ResultadoDiasHabiles,
  ResultadoValidacion,
  SalarioMinimo,
  TarifaIsr,
  TipoCambioFix,
  TipoPlazo,
  Udi,
  Uma,
} from "@mexicoapi/core";
import type { BancoCatalogo } from "../datos/bancos.js";
import type { MetaDatos } from "../datos/tipos.js";

/** De dónde salió una respuesta: de la API o de los datos que trae el paquete. */
export type Origen = "api" | "paquete";

/** El `meta` de la API: dataset, `as_of`, fuentes con su licencia y enlace a la documentación. */
export type Meta = MetaDatos;

/** Respuesta de una ruta sin `meta` (`/v1/status`). Está congelada. */
export interface RespuestaSinMeta<D> {
  readonly data: D;
  readonly origen: Origen;
  /**
   * Todo lo que hay que avisarle a quien usa el dato. Primero los del cliente: que la API no
   * respondió y se usó el paquete o una respuesta guardada, o que los datos del paquete de una
   * serie llegan a más de 7 días antes de hoy. Después, los de la API en su campo `advertencias`
   * de primer nivel (`/v1/dias-inhabiles`: la lista de un año puede estar incompleta para algún
   * tipo de plazo), o los mismos calculados con el paquete. Al final, los del cálculo que vienen
   * en `data.advertencias` (`/v1/dias-habiles`: calendario incompleto, art. 715, prórroga del
   * art. 12), que siguen también en `data`. Sin repetidos; vacío si no hay nada que avisar.
   */
  readonly advertencias: readonly string[];
}

/** `data` y `meta` como los da la API, más su origen y las advertencias. Está congelada. */
export interface Respuesta<D> extends RespuestaSinMeta<D> {
  readonly meta: Meta;
}

/** FIX que aplica a una operación según el CFF, art. 20 (`/v1/tipo-cambio/fix?operacion=`). */
export interface FixOperacion {
  fecha_operacion: FechaISO;
  /** Publicación en el DOF que aplica: la última antes de la operación. */
  fecha_publicacion: FechaISO;
  /** Pesos por dólar, con 4 decimales, como lo publica el DOF. */
  valor: string;
  fundamento: Fuente;
}

/**
 * Resultado de `/v1/clabe/{clabe}`: el banco trae `activo`, porque se valida con el catálogo, y
 * `banco_revisado` siempre es true.
 */
export type ResultadoClabe = ResultadoValidacion<
  Omit<DetalleClabe, "banco"> & { banco: BancoCatalogo | null }
> & {
  /** Si el código de banco se revisó contra el catálogo: en la API y en `clabe()`, siempre. */
  banco_revisado: boolean;
};

/** Un dataset en `/v1/status`. */
export interface EstadoDataset {
  dataset: string;
  as_of: FechaISO;
  records: number;
  data_sha256: string;
  /** Solo en las series (FIX y UDIS): primera y última fecha publicada. */
  cobertura?: { desde: FechaISO; hasta: FechaISO };
  status: "ok" | "stale" | "unknown";
  last_attempt: string | null;
  last_success: string | null;
  frescura_horas: number;
}

/** Sin parámetros. */
type Ninguno = Record<never, never>;

interface Ruta<P, D> {
  parametros: P;
  respuesta: Respuesta<D>;
}

/**
 * Rutas de la API v1: sus parámetros (los de la ruta y los de la query en un solo objeto, con
 * los nombres de la API) y su respuesta. Se puede ampliar con
 * `declare module "mexicoapi/cliente" { interface RutasApi { ... } }` para pedir con
 * `consultar` una ruta nueva antes de que el cliente la traiga; una ruta que el cliente no
 * conoce se pide siempre a la API.
 */
export interface RutasApi {
  "/v1/estados": Ruta<Ninguno, readonly Estado[]>;
  "/v1/estados/{cve_ent}": Ruta<{ cve_ent: string }, Estado>;
  "/v1/estados/{cve_ent}/municipios": Ruta<{ cve_ent: string }, readonly Municipio[]>;
  "/v1/municipios": Ruta<Ninguno, readonly Municipio[]>;
  "/v1/municipios/{cvegeo}": Ruta<{ cvegeo: string }, Municipio>;
  "/v1/bancos": Ruta<Ninguno, readonly Banco[]>;
  "/v1/bancos/{codigo}": Ruta<{ codigo: string }, Banco>;
  "/v1/clabe/{clabe}": Ruta<{ clabe: string }, ResultadoClabe>;
  "/v1/dias-habiles": Ruta<
    {
      desde: FechaISO;
      dias: number;
      permitir_incompleto?: boolean | undefined;
    } & (
      | { autoridad: Exclude<Autoridad, "sat">; tipo_plazo?: undefined }
      // Obligatorio con `sat`; con las demás autoridades da 400.
      | { autoridad: "sat"; tipo_plazo: TipoPlazo }
    ),
    ResultadoDiasHabiles
  >;
  "/v1/dias-inhabiles": Ruta<{ autoridad: Autoridad; anio: number }, readonly DiaInhabil[]>;
  "/v1/tipo-cambio/fix": Ruta<
    { publicado: FechaISO; operacion?: undefined } | { operacion: FechaISO; publicado?: undefined },
    TipoCambioFix | FixOperacion
  >;
  "/v1/tipo-cambio/fix/ultimo": Ruta<Ninguno, TipoCambioFix>;
  "/v1/udis": Ruta<{ fecha: FechaISO }, Udi>;
  "/v1/constantes/uma": Ruta<{ fecha: FechaISO }, Uma>;
  "/v1/constantes/uma/{anio}": Ruta<{ anio: number }, Uma>;
  "/v1/constantes/salario-minimo/{anio}": Ruta<{ anio: number }, readonly SalarioMinimo[]>;
  "/v1/isr/tarifa/{periodo}/{anio}": Ruta<
    { periodo: TarifaIsr["periodo"]; anio: number },
    TarifaIsr
  >;
  "/v1/status": { parametros: Ninguno; respuesta: RespuestaSinMeta<readonly EstadoDataset[]> };
}

export type RutaApi = keyof RutasApi;

/** Argumentos de `consultar` para una ruta: sus parámetros (opcionales si no tiene) y opciones. */
export type ArgumentosDe<R extends RutaApi> = Ninguno extends RutasApi[R]["parametros"]
  ? [parametros?: RutasApi[R]["parametros"], opciones?: OpcionesConsulta]
  : [parametros: RutasApi[R]["parametros"], opciones?: OpcionesConsulta];

/** Señal para cancelar una consulta; un `AbortSignal` sirve. */
export interface SenalAborto {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(tipo: "abort", oyente: () => void): void;
  removeEventListener(tipo: "abort", oyente: () => void): void;
}

// El AbortSignal del entorno si sus tipos están cargados (DOM, Node, Workers); si no, el mínimo.
type SenalDelEntorno = typeof globalThis extends { AbortSignal: { prototype: infer S } }
  ? S
  : SenalAborto;

/** Lo que el cliente le pasa a `fetch`. */
export interface InitFetch {
  headers: Record<string, string>;
  signal: SenalDelEntorno;
  /** La API no redirige lo que pide el cliente: una redirección es un fallo de conexión. */
  redirect: "error";
}

/** Lo que el cliente usa del lector de un cuerpo (el de un `ReadableStream`). */
export interface LectorCuerpo {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(motivo?: unknown): Promise<void>;
}

/**
 * Lo que el cliente usa de la respuesta de `fetch`. Si trae `body`, el cuerpo se lee por partes
 * y se corta al pasar de 8 MB; si no, se usa `text()` y el tope se revisa al final.
 */
export interface RespuestaFetch {
  readonly status: number;
  readonly headers: { get(nombre: string): string | null };
  readonly body?: { getReader(): LectorCuerpo } | null | undefined;
  text(): Promise<string>;
}

/** Un `fetch` como el de Node, los navegadores y los Workers, o uno propio con la misma forma. */
export type FetchCompatible = (url: string, init: InitFetch) => Promise<RespuestaFetch>;

/** Caché en memoria de las respuestas de la API. */
export interface OpcionesCache {
  /**
   * Cuánto se usa una respuesta sin volver a pedirla, en milisegundos (5 minutos por omisión).
   * Nunca más de lo que permite el `Cache-Control` de la API.
   */
  ttlMs?: number | undefined;
  /** Respuestas que se guardan; al pasar el límite sale la menos usada (100 por omisión). */
  maxEntradas?: number | undefined;
}

/** Origen de la API: un texto o un objeto con `href`, como un `URL`. */
export type Base = string | { readonly href: string };

/** Opciones que valen con y sin red. */
export interface OpcionesComunes {
  /**
   * Tiempo máximo de cada intento, incluida la lectura del cuerpo, en milisegundos (10 000 por
   * omisión). Un intento que se pasa no se reintenta: la consulta falla o, si se puede, responde
   * con la caché o con el paquete.
   */
  timeoutMs?: number | undefined;
  /**
   * Reintentos ante fallos de red, 5xx y 429, de 0 a 10 (2 por omisión), mientras quepan en
   * `esperaMaximaMs`. Un intento que agotó el tiempo no se reintenta.
   */
  reintentos?: number | undefined;
  /**
   * Lo más que espera en total una consulta entre reintentos, en milisegundos (10 000 por
   * omisión; 0 para no esperar nunca). Nunca reintenta antes de lo que pide un `Retry-After`,
   * que se respeta hasta 60 s: si no cabe en lo que queda, no reintenta y responde de inmediato
   * con el error, la caché o el paquete. La API pide 60 s en un 429, así que con el valor por
   * omisión un 429 no se reintenta.
   */
  esperaMaximaMs?: number | undefined;
  /** `fetch` a usar; por omisión, el global. */
  fetch?: FetchCompatible | undefined;
  /** `true` para la caché con sus valores por omisión; sin ella, no se guarda nada. */
  cache?: boolean | OpcionesCache | undefined;
}

/**
 * Opciones de `crearCliente`, todas opcionales. Sin `base`, los datos que caducan se piden a la
 * API pública (`URL_API`); con `base`, a esa. Con `offline: true` el cliente nunca usa la red:
 * todo sale del paquete.
 */
export type OpcionesCliente = OpcionesComunes & {
  /**
   * Origen de la API (con o sin `/v1` al final), sin query, fragmento ni credenciales
   * (`usuario:clave@` lanza TypeError). Sin él, la API pública: `URL_API`
   * (https://mexicoapi.dagel4k.workers.dev).
   */
  base?: Base | undefined;
  /** Nunca usa la red: todo sale del paquete, como con `fuente: "paquete"` en cada consulta. */
  offline?: boolean | undefined;
};

export interface OpcionesConsulta {
  /**
   * `"api"`: solo la API, sin respaldo en el paquete. `"paquete"`: solo los datos del paquete, sin
   * red. Sin ella, los datos estables (estados, municipios, bancos y la validación de la CLABE)
   * salen del paquete, y los que caducan (días hábiles e inhábiles, FIX, UDIS, UMA, salario
   * mínimo y tarifas de ISR) de la API, con los del paquete de respaldo si la API no responde.
   *
   * Los estables del paquete no traen advertencia de antigüedad: su `meta.as_of` es la fecha del
   * último cambio en la fuente, no de la última revisión (un catálogo que no cambió en años tiene
   * un `as_of` viejo y está al día), y el paquete no guarda cuándo se construyó. Para tenerlos al
   * día con la fuente, `fuente: "api"`.
   */
  fuente?: "api" | "paquete" | undefined;
  /** Cancela la consulta, también durante las esperas entre reintentos. */
  signal?: SenalAborto | undefined;
}

interface ConsultaDiasHabilesComun {
  desde: FechaISO;
  /** Días hábiles a sumar, de 1 a 3650. */
  dias: number;
  /**
   * Calcula fuera de la cobertura del calendario con advertencia: con los días ya publicados si
   * el plazo tiene respaldo (el SAT `general` después de sus vacaciones publicadas) y, más allá,
   * contando solo fines de semana.
   */
  permitirIncompleto?: boolean | undefined;
}

/**
 * Parámetros de `diasHabiles`, con los nombres del núcleo (`consultar` usa los de la API). Con
 * `sat`, `tipoPlazo` es obligatorio; con las demás autoridades no se acepta. `diasHabiles` revisa
 * eso y que el valor sea `general` o `declaraciones_pagos` antes de ir a la red o al paquete y, si
 * no cumple, lanza TypeError que nombra `tipoPlazo`.
 */
export type ConsultaDiasHabiles = ConsultaDiasHabilesComun &
  (
    | {
        /** `lft` (por omisión) o `cnbv`. */
        autoridad?: Exclude<Autoridad, "sat"> | undefined;
        tipoPlazo?: undefined;
      }
    | {
        autoridad: "sat";
        /**
         * `general` o `declaraciones_pagos`, en el que las vacaciones del SAT son hábiles (CFF
         * art. 12).
         */
        tipoPlazo: TipoPlazo;
      }
  );

export interface ConsultaDiasInhabiles {
  anio: number;
  /** `lft` (por omisión), `cnbv` o `sat`. */
  autoridad?: Autoridad | undefined;
}

/**
 * Cliente de la API. Cada método lanza `MexicoApiError` si la API (o el paquete) responde con un
 * problema, o si la API no responde y no hay respaldo.
 *
 * Nombres: los métodos tipados (`diasHabiles`, `umaVigente`, `fixParaOperacion`...) y sus
 * parámetros van en camelCase, como el núcleo (`tipoPlazo`, `permitirIncompleto`, igual que en
 * `sumarDiasHabiles`). `consultar`, las rutas de `RutasApi` y lo que llega en `data`, `meta` y los
 * problemas usan los nombres de la API (`tipo_plazo`, `permitir_incompleto`, `inhabiles_saltados`),
 * igual que la CLI en sus opciones (`--tipo-plazo`) y en su salida `--json`.
 */
export interface Cliente {
  /** Cualquier ruta de `RutasApi`, con las mismas reglas de origen que los métodos. */
  consultar<R extends RutaApi>(
    ruta: R,
    ...args: ArgumentosDe<R>
  ): Promise<RutasApi[R]["respuesta"]>;
  estados(opciones?: OpcionesConsulta): Promise<Respuesta<readonly Estado[]>>;
  /** Por su clave INEGI de 2 dígitos (`"25"`). */
  estado(cve_ent: string, opciones?: OpcionesConsulta): Promise<Respuesta<Estado>>;
  /** Todos, o los de un estado por su clave de 2 dígitos. */
  municipios(
    cve_ent?: string | undefined,
    opciones?: OpcionesConsulta,
  ): Promise<Respuesta<readonly Municipio[]>>;
  /** Por su clave geoestadística de 5 dígitos (`"25006"`). */
  municipio(cvegeo: string, opciones?: OpcionesConsulta): Promise<Respuesta<Municipio>>;
  bancos(opciones?: OpcionesConsulta): Promise<Respuesta<readonly Banco[]>>;
  /** Por los 3 dígitos con los que empieza la CLABE (`"002"`). */
  banco(codigo: string, opciones?: OpcionesConsulta): Promise<Respuesta<Banco>>;
  /** Valida contra el catálogo de bancos. Por omisión, sin red: la CLABE no sale del equipo. */
  clabe(clabe: string, opciones?: OpcionesConsulta): Promise<Respuesta<ResultadoClabe>>;
  diasHabiles(
    consulta: ConsultaDiasHabiles,
    opciones?: OpcionesConsulta,
  ): Promise<Respuesta<ResultadoDiasHabiles>>;
  diasInhabiles(
    consulta: ConsultaDiasInhabiles,
    opciones?: OpcionesConsulta,
  ): Promise<Respuesta<readonly DiaInhabil[]>>;
  /** FIX publicado en el DOF en `fecha`. */
  fixPublicado(fecha: FechaISO, opciones?: OpcionesConsulta): Promise<Respuesta<TipoCambioFix>>;
  /** FIX que aplica a una operación de `fecha` (CFF, art. 20). */
  fixParaOperacion(fecha: FechaISO, opciones?: OpcionesConsulta): Promise<Respuesta<FixOperacion>>;
  /** La publicación más reciente (del paquete, la última que trae, con su advertencia). */
  fixUltimo(opciones?: OpcionesConsulta): Promise<Respuesta<TipoCambioFix>>;
  udi(fecha: FechaISO, opciones?: OpcionesConsulta): Promise<Respuesta<Udi>>;
  /** La UMA de un año: rige del 1 de febrero al 31 de enero siguiente. */
  uma(anio: number, opciones?: OpcionesConsulta): Promise<Respuesta<Uma>>;
  /** La UMA vigente en `fecha`: en enero, la del año anterior. */
  umaVigente(fecha: FechaISO, opciones?: OpcionesConsulta): Promise<Respuesta<Uma>>;
  /** El salario mínimo de un año, uno por zona (`general` y `zlfn`). */
  salarioMinimo(
    anio: number,
    opciones?: OpcionesConsulta,
  ): Promise<Respuesta<readonly SalarioMinimo[]>>;
  /** La tarifa de ISR de un periodo (`mensual` o `anual`) y un año. */
  tarifaIsr(
    periodo: TarifaIsr["periodo"],
    anio: number,
    opciones?: OpcionesConsulta,
  ): Promise<Respuesta<TarifaIsr>>;
  /**
   * Frescura de cada dataset. Solo la API la tiene: con `fuente: "paquete"` u `offline: true`
   * lanza TypeError sin pedir nada.
   */
  status(opciones?: OpcionesConsulta): Promise<RespuestaSinMeta<readonly EstadoDataset[]>>;
}
