import { validarClabe } from "@mexicoapi/core";
import { catalogoBancos, metaInterna } from "../cargas.js";
import { requerido } from "../parametros.js";
import { URL_DOCS } from "../problemas.js";
import { CACHE_CLABE, respuestaJson } from "../respuestas.js";
import type { Contexto } from "../rutas.js";

const DOCS_CLABE = `${URL_DOCS}/api/README.md#clabe`;

/**
 * `GET /v1/clabe/{clabe}`: valida contra el catálogo de bancos. Un banco inactivo tiene formato
 * válido (`activo: false` lo dice); la plaza queda en null mientras no haya dataset de plazas.
 */
export async function clabe(c: Contexto): Promise<Response> {
  const [interna, bancos] = await Promise.all([metaInterna(c.entorno), catalogoBancos(c.entorno)]);
  const dataset = interna.datasets.bancos;
  if (dataset === undefined) throw new Error("El meta interno no tiene el dataset bancos.");
  const data = validarClabe(requerido(c.parametros, "clabe"), { bancos });
  return respuestaJson(
    { data, meta: { ...dataset.meta, docs: DOCS_CLABE } },
    { cache: CACHE_CLABE },
  );
}
