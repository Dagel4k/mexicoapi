// Tipos públicos de mexicoapi/sepomex. Solo hay tipos y ninguno es de Node: quien usa el paquete
// no necesita @types/node para compilar.
import type { Aviso } from "@mexicoapi/core";

/** Lo mínimo de una señal de cancelación, para un proyecto sin los tipos del DOM ni de Node. */
export interface SenalAborto {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(tipo: "abort", oyente: () => void): void;
  removeEventListener(tipo: "abort", oyente: () => void): void;
}

// El AbortSignal del entorno si sus tipos están cargados (Node, DOM); si no, el mínimo.
type SenalDelEntorno = typeof globalThis extends { AbortSignal: { prototype: infer S } }
  ? S
  : SenalAborto;

/** Lo que `sync` le pasa a `fetch`. */
export interface InitFetchSepomex {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  /** Las redirecciones no se siguen: una respuesta 3xx es una página inesperada. */
  redirect: "manual";
  /** Se aborta cuando la descarga completa pasa de 5 minutos. */
  signal?: SenalDelEntorno;
}

/** Lo que `sync` usa del lector de un cuerpo (el de un `ReadableStream`). */
export interface LectorCuerpo {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(motivo?: unknown): Promise<void>;
}

/**
 * Lo que `sync` usa de la respuesta de `fetch`. Si trae `body`, se lee por partes y se corta al
 * pasar del límite; si no, se usa `arrayBuffer()` y el límite se revisa al final.
 */
export interface RespuestaFetchSepomex {
  readonly status: number;
  readonly headers: { get(nombre: string): string | null };
  readonly body?: { getReader(): LectorCuerpo } | null | undefined;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Un `fetch` como el global de Node, o uno propio con la misma forma (un proxy, una prueba). */
export type FetchSepomex = (url: string, init: InitFetchSepomex) => Promise<RespuestaFetchSepomex>;

export interface OpcionesDirectorio {
  /**
   * Directorio de la caché. Por omisión, `%LOCALAPPDATA%\mexicoapi\sepomex` en Windows y
   * `$XDG_CACHE_HOME/mexicoapi/sepomex` (o `~/.cache/mexicoapi/sepomex`) en los demás.
   */
  dir?: string | undefined;
}

export interface OpcionesGuardado extends OpcionesDirectorio {
  /**
   * Recibe el aviso de Correos de México y la nota de MéxicoAPI antes de descargar o importar.
   * Por omisión se escriben en la salida de errores (stderr).
   */
  aviso?: ((texto: string) => void) | undefined;
  /** Con `false` no se escribe el SQLite aunque `node:sqlite` exista. */
  sqlite?: boolean | undefined;
}

export interface OpcionesSync extends OpcionesGuardado {
  /**
   * Para hacer las peticiones. Por omisión se usa `node:https` con las direcciones IPv4 primero
   * (el sitio de Correos de México corta las conexiones TLS por IPv6), 60 s como máximo sin
   * recibir nada y 5 minutos para toda la descarga.
   */
  fetch?: FetchSepomex | undefined;
}

/** Cómo quedó el catálogo guardado en la caché. */
export interface ResumenSepomex {
  /** Directorio de la caché. */
  readonly dir: string;
  /** Cuándo se descargó o importó (ISO 8601, UTC). */
  readonly descargado: string;
  /** `descarga` si lo bajó `sync`; `archivo` si vino de `importar`. */
  readonly origen: "descarga" | "archivo";
  /** Página de Correos de México de donde sale el catálogo. */
  readonly fuente: string;
  /** "Última Actualización de Información" que decía la página al descargar; null si no se supo. */
  readonly as_of: string | null;
  /** Aviso de uso de Correos de México, tal como viene en la primera línea del archivo. */
  readonly aviso: string;
  /** Que los datos no vienen de MéxicoAPI. */
  readonly nota: string;
  readonly filas: number;
  readonly codigos_postales: number;
  readonly municipios: number;
  /** Códigos postales cuyo municipio no está en el catálogo de INEGI del paquete. */
  readonly sin_municipio_inegi: number;
  /**
   * Lo que conviene revisar del catálogo: códigos postales con un municipio que no está en INEGI,
   * que aparecen en más de un municipio o un aviso de uso distinto del conocido.
   */
  readonly advertencias: readonly string[];
  /** Las mismas advertencias, en el mismo orden, cada una con su código estable. */
  readonly avisos: readonly Aviso[];
  /** SHA-256 del TXT de Correos de México. */
  readonly sha256: string;
  /** Ruta del JSON con el catálogo. */
  readonly json: string;
  /** Ruta del SQLite, o null si no se escribió (sin `node:sqlite` o con `sqlite: false`). */
  readonly sqlite: string | null;
  /** Por qué no hay SQLite (Node sin `node:sqlite`, `sqlite: false`...); null si lo hay. */
  readonly sin_sqlite: string | null;
}
