import { digitoControlClabe, NOTAS_VALIDACION } from "@mexicoapi/core";
import { beforeEach, describe, expect, it } from "vitest";
import bancos from "../../../../data/bancos/bancos.json" with { type: "json" };
import manifiesto from "../../../../data/bancos/manifest.json" with { type: "json" };
import { reiniciarCargas } from "../../src/cargas.js";
import { manejar } from "../../src/index.js";
import { CACHE_DATOS } from "../../src/respuestas.js";
import {
  type AssetFalso,
  crearAssets,
  entornoDe,
  peticion,
  SEGURIDAD_ESPERADA,
  seguridadDe,
} from "./ayudas.js";

const TIPO = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#";

// El meta y el shard de bancos como los escribe el build, con los datos reales de data/bancos.
const META_BANCOS = {
  dataset: manifiesto.dataset,
  as_of: manifiesto.as_of,
  sources: manifiesto.sources.map(({ name, url, license, license_url, citation }) => ({
    name,
    url,
    license,
    license_url,
    citation,
  })),
  docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/datos/bancos.md",
};

const INTERNA = {
  datasets: {
    bancos: {
      meta: META_BANCOS,
      records: manifiesto.records,
      data_sha256: manifiesto.data_sha256,
      frescura_horas: 72,
    },
  },
};

const ASSETS: Record<string, AssetFalso> = {
  "/v1/_internos/meta.json": { cuerpo: JSON.stringify(INTERNA) },
  "/v1/bancos.json": { cuerpo: JSON.stringify({ data: bancos, meta: META_BANCOS }) },
};

const META_CLABE = {
  ...META_BANCOS,
  docs: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#clabe",
};

/** Los 17 primeros dígitos más su dígito de control. */
const conDigito = (primeros17: string): string => primeros17 + digitoControlClabe(primeros17);

const otroDigito = (clabe: string): string =>
  clabe.slice(0, 17) + String((Number(clabe.slice(17)) + 1) % 10);

async function pedir(ruta: string, init?: RequestInit, mapa = ASSETS) {
  const assets = crearAssets(mapa);
  const respuesta = await manejar(peticion(ruta, init), entornoDe(assets));
  return { respuesta, assets };
}

beforeEach(() => reiniciarCargas());

describe("GET /v1/clabe/{clabe}", () => {
  it("los datos reales tienen a BBVA activo con el código 012 y a IXE inactivo con el 032", () => {
    const porCodigo = new Map(bancos.map((b) => [b.codigo, b]));
    expect(porCodigo.get("012")).toMatchObject({ nombre_corto: "BBVA MEXICO", activo: true });
    expect(porCodigo.get("032")).toMatchObject({ nombre_corto: "IXE", activo: false });
    expect(porCodigo.has("999")).toBe(false);
  });

  it("valida una CLABE de un banco activo con el dígito correcto", async () => {
    const clabe = conDigito("01201000123456789");
    const { respuesta, assets } = await pedir(`/v1/clabe/${clabe}`);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(respuesta.headers.get("cache-control")).toBe(CACHE_DATOS);
    expect(seguridadDe(respuesta)).toEqual(SEGURIDAD_ESPERADA);
    const texto = await respuesta.text();
    expect(Object.keys(JSON.parse(texto))).toEqual(["data", "meta"]);
    expect(JSON.parse(texto)).toEqual({
      data: {
        valor: clabe,
        valido: true,
        formato_valido: true,
        digito_verificador_valido: true,
        banco_revisado: true,
        errores: [],
        nota: NOTAS_VALIDACION.clabe,
        detalle: {
          codigo_banco: "012",
          codigo_plaza: "010",
          cuenta: "00123456789",
          digito_control: clabe.slice(17),
          banco: { codigo: "012", nombre_corto: "BBVA MEXICO", activo: true },
          plaza: null,
        },
      },
      meta: META_CLABE,
    });
    expect([...assets.pedidas].sort()).toEqual(["/v1/_internos/meta.json", "/v1/bancos.json"]);
  });

  it("un dígito de control incorrecto conserva el detalle y lo marca", async () => {
    const clabe = otroDigito(conDigito("01201000123456789"));
    const { respuesta } = await pedir(`/v1/clabe/${clabe}`);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({
      data: {
        valor: clabe,
        valido: false,
        formato_valido: true,
        digito_verificador_valido: false,
        errores: ["digito_verificador"],
        detalle: { banco: { codigo: "012", nombre_corto: "BBVA MEXICO", activo: true } },
      },
      meta: META_CLABE,
    });
  });

  it("un banco que no está en el catálogo es una falla de formato", async () => {
    const clabe = conDigito("99901000123456789");
    const { respuesta } = await pedir(`/v1/clabe/${clabe}`);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({
      data: {
        valor: clabe,
        valido: false,
        formato_valido: false,
        digito_verificador_valido: null,
        banco_revisado: true,
        errores: ["banco"],
        nota: NOTAS_VALIDACION.clabe,
        detalle: null,
      },
      meta: META_CLABE,
    });
  });

  it("un banco inactivo tiene formato válido y activo: false", async () => {
    const clabe = conDigito("03201000123456789");
    const { respuesta } = await pedir(`/v1/clabe/${clabe}`);
    expect(await respuesta.json()).toMatchObject({
      data: {
        valido: true,
        formato_valido: true,
        errores: [],
        detalle: { banco: { codigo: "032", nombre_corto: "IXE", activo: false }, plaza: null },
      },
    });
  });

  it("HEAD da los mismos encabezados sin cuerpo", async () => {
    const clabe = conDigito("01201000123456789");
    const get = (await pedir(`/v1/clabe/${clabe}`)).respuesta;
    const { respuesta } = await pedir(`/v1/clabe/${clabe}`, { method: "HEAD" });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toBeNull();
    expect([...respuesta.headers]).toEqual([...get.headers]);
  });

  it("lo que no son 18 dígitos da 400 sin tocar ASSETS", async () => {
    const valida = conDigito("01201000123456789");
    for (const valor of [
      valida.slice(0, 17),
      `${valida}0`,
      `${valida.slice(0, 17)}a`,
      "abcdefghijklmnopqr",
      `${valida.slice(0, 3)}-${valida.slice(3)}`,
      `${valida.slice(0, 17)}.`,
    ]) {
      const ruta = `/v1/clabe/${valor}`;
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(400);
      expect(respuesta.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(await respuesta.json(), ruta).toEqual({
        type: `${TIPO}parametro-invalido`,
        title: "Parámetro inválido",
        status: 400,
        detail: "La CLABE debe tener 18 dígitos.",
        instance: ruta,
        parametro: "clabe",
      });
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });

  it("espacios o dígitos de ancho completo llegan codificados y no se encuentran", async () => {
    for (const ruta of [
      "/v1/clabe/012 010 00123456789 1",
      "/v1/clabe/０１２０１０００１２３４５６７８９",
    ]) {
      const { respuesta, assets } = await pedir(ruta);
      expect(respuesta.status, ruta).toBe(404);
      expect(assets.pedidas, ruta).toEqual([]);
    }
  });

  it("no acepta parámetros de query", async () => {
    const clabe = conDigito("01201000123456789");
    const { respuesta } = await pedir(`/v1/clabe/${clabe}?bancos=todos`);
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toMatchObject({
      type: `${TIPO}parametro-desconocido`,
      parametro: "bancos",
    });
  });

  it("sin el dataset bancos en el meta interno, o sin el shard, da 500 genérico", async () => {
    const clabe = conDigito("01201000123456789");
    const sinDataset = {
      ...ASSETS,
      "/v1/_internos/meta.json": { cuerpo: JSON.stringify({ datasets: {} }) },
    };
    const { "/v1/bancos.json": _omitido, ...sinShard } = ASSETS;
    for (const mapa of [sinDataset, sinShard]) {
      reiniciarCargas();
      const { respuesta } = await pedir(`/v1/clabe/${clabe}`, undefined, mapa);
      expect(respuesta.status).toBe(500);
      expect(await respuesta.json()).toMatchObject({
        type: `${TIPO}error-interno`,
        detail: "Ocurrió un error interno.",
      });
    }
  });
});
