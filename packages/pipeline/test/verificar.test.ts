import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/canonico.js";
import { principal } from "../src/cli.js";
import { verificarDatos } from "../src/verificar.js";
import { crearEntorno } from "./ayudas.js";

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "verificar-"));
  const codigo = await principal(
    ["actualizar", "inegi.estados", "bancos"],
    await crearEntorno(raiz),
  );
  expect(codigo).toBe(0);
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

const estados = () => join(raiz, "inegi-estados", "estados.json");
const manifiesto = () => join(raiz, "inegi-estados", "manifest.json");

async function reescribir(ruta: string, f: (texto: string) => string): Promise<void> {
  await writeFile(ruta, f(await readFile(ruta, "utf8")));
}

/** Cambia los datos y deja el manifiesto coherente (hash y conteo). */
async function reescribirDatos(f: (registros: Record<string, unknown>[]) => unknown[]) {
  const nuevos = f(JSON.parse(await readFile(estados(), "utf8")));
  const texto = `${JSON.stringify(nuevos, null, 2)}\n`;
  await writeFile(estados(), texto);
  const m = JSON.parse(await readFile(manifiesto(), "utf8"));
  m.data_sha256 = sha256Hex(texto);
  m.records = nuevos.length;
  await writeFile(manifiesto(), `${JSON.stringify(m, null, 2)}\n`);
}

describe("verificarDatos", () => {
  it("no encuentra problemas tras actualizar, ni sin data/", async () => {
    expect(await verificarDatos(raiz)).toEqual([]);
    expect(await verificarDatos(join(raiz, "no-existe"))).toEqual([]);
  });

  it("detecta un byte cambiado en los datos", async () => {
    await reescribir(estados(), (t) => t.replace("Aguascalientes", "Aguascalientez"));
    const p = await verificarDatos(raiz);
    expect(p).toEqual(["inegi-estados: data_sha256 no coincide"]);
  });

  it("detecta un crudo borrado y uno alterado", async () => {
    await rm(join(raiz, "inegi-estados", "raw", "mgee.json"));
    expect((await verificarDatos(raiz)).join("\n")).toContain("falta el crudo raw/mgee.json");
    await writeFile(join(raiz, "bancos", "raw", "cep-instituciones.json"), "{}");
    expect((await verificarDatos(raiz)).join("\n")).toContain(
      "el sha256 de raw/cep-instituciones.json no coincide",
    );
  });

  it("detecta records equivocado", async () => {
    await reescribir(manifiesto(), (t) => t.replace(/"records": 32/, '"records": 31'));
    expect(await verificarDatos(raiz)).toEqual([
      "inegi-estados: records es 31 pero el archivo tiene 32",
    ]);
  });

  it("detecta un archivo no canónico (tabulaciones)", async () => {
    await reescribirDatos((r) => r);
    const m = JSON.parse(await readFile(manifiesto(), "utf8"));
    const tabulado = `${JSON.stringify(JSON.parse(await readFile(estados(), "utf8")), null, "\t")}\n`;
    await writeFile(estados(), tabulado);
    m.data_sha256 = sha256Hex(tabulado);
    await writeFile(manifiesto(), `${JSON.stringify(m, null, 2)}\n`);
    expect(await verificarDatos(raiz)).toEqual([
      "inegi-estados: estados.json no está en forma canónica",
    ]);
  });

  it("detecta registros fuera de orden y claves duplicadas", async () => {
    await reescribirDatos((r) => [r[1], r[0], ...r.slice(2)]);
    expect((await verificarDatos(raiz)).join("\n")).toContain("registros fuera de orden: 01");
    await reescribirDatos((r) => [r[0], r[0], ...r.slice(2)]);
    expect((await verificarDatos(raiz)).join("\n")).toContain("clave duplicada");
  });

  it("detecta llaves de más, esquema inválido e invariantes", async () => {
    await reescribirDatos((r) => r.map((x, i) => (i === 0 ? { ...x, extra: 1 } : x)));
    expect((await verificarDatos(raiz)).join("\n")).toContain("orden de llaves del esquema");
    await reescribirDatos((r) => r.map((x, i) => (i === 0 ? { ...x, cve_ent: "1" } : x)));
    expect((await verificarDatos(raiz)).join("\n")).toContain("esquema inválido");
  });

  it("detecta invariantes violados", async () => {
    await reescribirDatos((r) => r.slice(0, 5));
    expect((await verificarDatos(raiz)).join("\n")).toContain("invariante:");
  });

  it("detecta archivos no declarados y rutas de crudo peligrosas", async () => {
    await writeFile(join(raiz, "inegi-estados", "raw", "extra.json"), "{}");
    await writeFile(join(raiz, "inegi-estados", "suelto.txt"), "x");
    const p = (await verificarDatos(raiz)).join("\n");
    expect(p).toContain("archivo no declarado: raw/extra.json");
    expect(p).toContain("archivo no declarado: suelto.txt");
    await rm(join(raiz, "inegi-estados", "raw", "extra.json"));
    await rm(join(raiz, "inegi-estados", "suelto.txt"));
    await reescribir(manifiesto(), (t) => t.replace("raw/mgee.json", "raw/../../x"));
    expect((await verificarDatos(raiz)).join("\n")).toContain("ruta de crudo no permitida");
  });

  it("detecta manifiestos defectuosos y directorios ajenos", async () => {
    await reescribir(manifiesto(), (t) => t.replace('"inegi.estados"', '"inegi.municipios"'));
    expect((await verificarDatos(raiz)).join("\n")).toContain("se esperaba inegi.estados");
    await reescribir(manifiesto(), (t) => t.replace('"estados.json"', '"otro.json"'));
    expect((await verificarDatos(raiz)).join("\n")).toContain("se esperaba estados.json");
    await writeFile(manifiesto(), "{");
    expect(await verificarDatos(raiz)).toEqual(["inegi-estados: manifest.json no es JSON válido"]);
    await writeFile(manifiesto(), '{"dataset":"x"}');
    expect((await verificarDatos(raiz))[0]).toContain("manifest.json inválido");
    await rm(manifiesto());
    expect(await verificarDatos(raiz)).toEqual(["inegi-estados: falta manifest.json"]);
    await mkdir(join(raiz, "ajeno"));
    await writeFile(join(raiz, "ajeno", "manifest.json"), "{}");
    expect((await verificarDatos(raiz)).join("\n")).toContain("ajeno: manifest.json inválido");
  });

  it("detecta datos que no son JSON y un directorio sin dataset registrado", async () => {
    await writeFile(estados(), "no json");
    expect((await verificarDatos(raiz)).join("\n")).toContain("estados.json no es JSON válido");
    const m = JSON.parse(await readFile(manifiesto(), "utf8"));
    await mkdir(join(raiz, "ajeno"));
    await writeFile(join(raiz, "ajeno", "manifest.json"), JSON.stringify(m));
    expect((await verificarDatos(raiz)).join("\n")).toContain(
      "ajeno: directorio sin dataset registrado",
    );
  });

  it("valida fechas reales en el manifiesto y fetched_at como instante UTC", async () => {
    const m = JSON.parse(await readFile(manifiesto(), "utf8"));
    const con = async (cambio: (x: typeof m) => void): Promise<string> => {
      const copia = structuredClone(m);
      cambio(copia);
      await writeFile(manifiesto(), `${JSON.stringify(copia, null, 2)}\n`);
      return (await verificarDatos(raiz)).join("\n");
    };
    expect(
      await con((x) => {
        x.as_of = "2026-02-30";
      }),
    ).toContain("manifest.json inválido (as_of");
    expect(
      await con((x) => {
        x.sources[0].published_at = "2026-13-01";
      }),
    ).toContain("manifest.json inválido (sources.0.published_at");
    for (const malo of ["2026-10-17", "2026-10-17T12:00:00+00:00", "2026-10-17T12:00:00.5Z"]) {
      expect(
        await con((x) => {
          x.fetched_at = malo;
        }),
      ).toContain("manifest.json inválido (fetched_at");
    }
    expect(
      await con((x) => {
        x.as_of = "2024-02-29";
        x.sources[0].published_at = null;
        x.fetched_at = "2026-10-17T12:00:00Z";
      }),
    ).toBe("");
  });

  it("detecta textos fuera de NFC y manifiestos con llaves de más o no canónicos", async () => {
    await reescribirDatos((r) =>
      r.map((x, i) => (i === 0 ? { ...x, nombre: "Aguascalientes\u0301" } : x)),
    );
    expect((await verificarDatos(raiz)).join("\n")).toContain("no están en NFC");
    await reescribirDatos((r) => r);
    const m = JSON.parse(await readFile(manifiesto(), "utf8"));
    await writeFile(manifiesto(), `${JSON.stringify({ ...m, extra: 1 }, null, 2)}\n`);
    expect((await verificarDatos(raiz)).join("\n")).toContain("manifest.json inválido");
    await writeFile(manifiesto(), JSON.stringify(m));
    expect((await verificarDatos(raiz)).join("\n")).toContain(
      "manifest.json no está en forma canónica",
    );
  });
});
