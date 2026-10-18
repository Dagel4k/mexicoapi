import { describe, expect, it } from "vitest";
import { urlCep } from "../src/datasets/bancos/cep.js";
import { ErrorDatos } from "../src/errores.js";
import { capturarHistoricoCep } from "../src/historico.js";
import { type Cliente, ErrorHttp } from "../src/http.js";
import { leerFixture } from "./ayudas.js";

const texto = (s: string) => new TextEncoder().encode(s);

function clienteFalso(
  respuestas: (fecha: string) => Uint8Array | number,
  pedidas: string[],
): Cliente {
  return {
    async obtener(url) {
      pedidas.push(url);
      const fecha = /fecha=(\d{2})-(\d{2})-(\d{4})/.exec(url);
      const iso = `${fecha?.[3]}-${fecha?.[2]}-${fecha?.[1]}`;
      const r = respuestas(iso);
      if (typeof r === "number") throw new ErrorHttp(`HTTP ${r}`, url, r);
      return { url, estado: 200, tipo: null, cuerpo: r, obtenido_en: "2026-10-17T00:00:00.000Z" };
    },
  };
}

describe("capturarHistoricoCep", () => {
  it("pide el día 1 de cada mes en orden", async () => {
    const cep = await leerFixture("bancos/cep-2012-01-03.json");
    const pedidas: string[] = [];
    const obs = await capturarHistoricoCep(
      clienteFalso(() => cep, pedidas),
      "2025-11",
      "2026-01-20",
    );
    expect(pedidas).toEqual([urlCep("2025-11-01"), urlCep("2025-12-01"), urlCep("2026-01-01")]);
    expect(obs.map((o) => o.fecha)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01"]);
    expect(obs[0]?.entradas.length).toBeGreaterThan(0);
  });

  it("si el día 1 viene sin instituciones prueba el 2", async () => {
    const cep = await leerFixture("bancos/cep-2012-01-03.json");
    const pedidas: string[] = [];
    const obs = await capturarHistoricoCep(
      clienteFalso((f) => (f.endsWith("-01") ? texto('{"overrideCaptcha":true}') : cep), pedidas),
      "2026-03",
      "2026-03-31",
    );
    expect(pedidas).toEqual([urlCep("2026-03-01"), urlCep("2026-03-02")]);
    expect(obs.map((o) => o.fecha)).toEqual(["2026-03-02"]);
  });

  it("salta el mes sin datos tras cinco intentos", async () => {
    const cep = await leerFixture("bancos/cep-2012-01-03.json");
    const pedidas: string[] = [];
    const obs = await capturarHistoricoCep(
      clienteFalso((f) => (f.startsWith("2026-02") ? texto("{}") : cep), pedidas),
      "2026-01",
      "2026-03-31",
    );
    expect(obs.map((o) => o.fecha)).toEqual(["2026-01-01", "2026-03-01"]);
    expect(pedidas.filter((u) => u.includes("-02-2026"))).toHaveLength(5);
  });

  it("no pide fechas futuras", async () => {
    const pedidas: string[] = [];
    const obs = await capturarHistoricoCep(
      clienteFalso(() => texto("{}"), pedidas),
      "2026-09",
      "2026-10-02",
    );
    expect(pedidas).toEqual([
      ...[1, 2, 3, 4, 5].map((d) => urlCep(`2026-09-0${d}`)),
      urlCep("2026-10-01"),
      urlCep("2026-10-02"),
    ]);
    expect(obs).toEqual([]);
  });

  it("avisa el avance cada 12 meses", async () => {
    const cep = await leerFixture("bancos/cep-2012-01-03.json");
    const avisos: string[] = [];
    await capturarHistoricoCep(
      clienteFalso(() => cep, []),
      "2024-01",
      "2025-06-01",
      (t) => avisos.push(t),
    );
    expect(avisos).toEqual(["Histórico: 12 meses revisados (hasta 2024-12).\n"]);
  });

  it("un fallo de red aborta, y el mes de inicio se valida", async () => {
    await expect(
      capturarHistoricoCep(
        clienteFalso(() => 503, []),
        "2026-01",
        "2026-02-01",
      ),
    ).rejects.toBeInstanceOf(ErrorHttp);
    await expect(
      capturarHistoricoCep(
        clienteFalso(() => 200, []),
        "2026-1",
        "2026-02-01",
      ),
    ).rejects.toThrow(RangeError);
  });

  it("propaga errores que no son de datos", async () => {
    const cliente: Cliente = {
      async obtener() {
        throw new Error("boom");
      },
    };
    await expect(capturarHistoricoCep(cliente, "2026-01", "2026-01-02")).rejects.toThrow("boom");
  });

  it("una respuesta que no es JSON detiene la captura sin pedir más", async () => {
    const cep = await leerFixture("bancos/cep-2012-01-03.json");
    const pedidas: string[] = [];
    const html = texto("<html><body>Acceso restringido</body></html>");
    const error = await capturarHistoricoCep(
      clienteFalso((f) => (f.startsWith("2026-03") ? html : cep), pedidas),
      "2026-01",
      "2026-06-30",
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorDatos);
    expect((error as Error).message).toContain("posible bloqueo");
    expect((error as Error).message).toContain(urlCep("2026-03-01"));
    expect(pedidas).toEqual([urlCep("2026-01-01"), urlCep("2026-02-01"), urlCep("2026-03-01")]);
  });

  it("bytes inválidos y cuerpo vacío también cuentan como bloqueo", async () => {
    for (const cuerpo of [new Uint8Array([0xff, 0xfe, 0x00]), new Uint8Array()]) {
      await expect(
        capturarHistoricoCep(
          clienteFalso(() => cuerpo, []),
          "2026-01",
          "2026-01-31",
        ),
      ).rejects.toBeInstanceOf(ErrorDatos);
    }
  });
});
