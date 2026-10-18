export interface Entorno {
  ASSETS: Fetcher;
  /** Estado de las corridas de datos, para `/v1/status`. */
  ESTADO?: KVNamespace;
  /** Límite de peticiones por IP; sin binding no se limita. */
  LIMITE?: RateLimit;
}

export interface Opciones {
  ahora?: () => Date;
}
