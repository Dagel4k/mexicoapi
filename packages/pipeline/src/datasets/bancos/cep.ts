import type { FechaISO, TipoBanco } from "@mexicoapi/core";
import { z } from "zod";
import { limpiarTexto } from "../../canonico.js";
import { ErrorDatos } from "../../errores.js";

const ID = "bancos";
const CODIGO = /^\d{4,5}$/;

export type EntradaCep = readonly [codigo_spei: string, nombre_corto: string];

const esquemaCep = z.object({
  instituciones: z
    .array(
      z.tuple([
        z.string().regex(CODIGO),
        z.string().refine((n) => limpiarTexto(n) !== "", "nombre vacío"),
      ]),
    )
    .min(1),
});

/** URL de la lista de participantes SPEI vigentes en una fecha. */
export function urlCep(fecha: FechaISO): string {
  const [a, m, d] = fecha.split("-");
  return `https://www.banxico.org.mx/cep/instituciones.do?fecha=${d}-${m}-${a}`;
}

/** Lee la respuesta del CEP; no ordena ni quita repetidos. */
export function interpretarCep(bytes: Uint8Array): EntradaCep[] {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ErrorDatos("La respuesta del CEP no es JSON válido", ID);
  }
  const r = esquemaCep.safeParse(json);
  if (!r.success) {
    const p = r.error.issues[0];
    const donde = p === undefined ? "" : `: ${p.path.map(String).join(".") || "(raíz)"}`;
    throw new ErrorDatos(`La respuesta del CEP no tiene la forma esperada${donde}`, ID);
  }
  return r.data.instituciones.map(([codigo, nombre]) => [codigo, limpiarTexto(nombre)] as const);
}

function validar(codigoSpei: string): void {
  if (!CODIGO.test(codigoSpei)) throw new RangeError(`Código SPEI inválido: ${codigoSpei}`);
}

/** Los 3 dígitos del código de banco de la CLABE. */
export function codigoClabe(codigoSpei: string): string {
  validar(codigoSpei);
  return codigoSpei.slice(-3);
}

export function tipoBanco(codigoSpei: string): TipoBanco {
  validar(codigoSpei);
  if (codigoSpei === "2001") return "banco_central";
  if (codigoSpei.length === 5) {
    const prefijo = codigoSpei.slice(0, 2);
    if (prefijo === "40") return "banca_multiple";
    if (prefijo === "37") return "banca_desarrollo";
    if (prefijo === "90") return "otra_entidad";
  }
  throw new RangeError(`No se reconoce el tipo del código SPEI ${codigoSpei}`);
}
