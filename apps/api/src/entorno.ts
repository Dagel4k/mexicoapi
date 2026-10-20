export interface Entorno {
  ASSETS: Fetcher;
  /** Estado de las corridas de datos, para `/v1/status`. */
  ESTADO?: KVNamespace;
  /** Límite de peticiones por IP; sin binding no se limita. */
  LIMITE?: RateLimit;
  /**
   * `X-Robots-Tag` de toda respuesta del Worker. El despliegue lo define solo en staging
   * (`noindex`), para que los buscadores no lo indexen; sin él no se manda.
   */
  X_ROBOTS_TAG?: string;
}

export interface Opciones {
  ahora?: () => Date;
}
