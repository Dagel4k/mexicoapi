/** Datos inválidos o fuente con forma inesperada. */
export class ErrorDatos extends Error {
  readonly dataset: string | null;

  constructor(mensaje: string, dataset: string | null = null) {
    super(mensaje);
    this.name = "ErrorDatos";
    this.dataset = dataset;
  }
}
