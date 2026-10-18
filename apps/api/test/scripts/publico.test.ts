// La revisión que hace el globalSetup de la integración (test/integracion/worker.ts) antes de
// levantar el Worker: el `public/` del build tiene que salir de los `data/` de hoy.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diferenciasConDatos } from "../integracion/publico.ts";

const PLAZOS = { general: { cobertura: { desde: "2026-01-01", hasta: "2026-12-31" } } };
const FINES = { "2026": { nombre: "Ley", url: "https://ley.prueba" } };

let raiz: string;
let publico: URL;
let datos: URL;

const escribir = async (ruta: string, valor: unknown) => {
  await mkdir(join(raiz, ruta, ".."), { recursive: true });
  await writeFile(join(raiz, ruta), JSON.stringify(valor));
};

const manifiesto = (dataset: string, data_sha256: string) => ({ dataset, data_sha256 });

/** Un build y unos datos que coinciden: dos datasets, uno curado con su calendario. */
async function coincidentes() {
  await escribir("data/udis/manifest.json", manifiesto("udis", "a1"));
  await escribir("data/dias-inhabiles-cnbv/manifest.json", manifiesto("dias-inhabiles.cnbv", "b2"));
  await escribir("data/dias-inhabiles-cnbv/calendario.json", {
    autoridad: "cnbv",
    plazos: PLAZOS,
    fuentes_fin_de_semana: FINES,
  });
  // Los YAML de los curados no tienen manifiesto.
  await writeFile(join(raiz, "data", "README.md"), "");
  await mkdir(join(raiz, "data", "curado"), { recursive: true });
  await escribir("public/v1/_internos/meta.json", {
    datasets: { udis: { records: 1, data_sha256: "a1" } },
    curados: { "dias-inhabiles.cnbv": { records: 1, data_sha256: "b2" } },
  });
  await escribir("public/v1/_internos/calendarios/cnbv.json", {
    autoridad: "cnbv",
    plazos: PLAZOS,
    fuentes_fin_de_semana: FINES,
    dias: [],
  });
}

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "publico-"));
  publico = pathToFileURL(join(raiz, "public/"));
  datos = pathToFileURL(join(raiz, "data/"));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("diferenciasConDatos", () => {
  it("no encuentra nada si el build salió de estos datos", async () => {
    await coincidentes();
    expect(await diferenciasConDatos(publico, datos)).toEqual([]);
  });

  it("nombra el dataset cuyos datos cambiaron después del build", async () => {
    await coincidentes();
    await escribir("data/udis/manifest.json", manifiesto("udis", "a2"));
    expect(await diferenciasConDatos(publico, datos)).toEqual(["udis: data_sha256 distinto"]);
  });

  it("nombra los datasets que solo están de un lado", async () => {
    await coincidentes();
    await escribir("data/bancos/manifest.json", manifiesto("bancos", "c3"));
    await escribir("public/v1/_internos/meta.json", {
      datasets: { udis: { data_sha256: "a1" }, viejo: { data_sha256: "d4" } },
      curados: { "dias-inhabiles.cnbv": { data_sha256: "b2" } },
    });
    expect(await diferenciasConDatos(publico, datos)).toEqual([
      "bancos: no está en public",
      "viejo: ya no está en data",
    ]);
  });

  it("nombra el calendario cuya cobertura cambió aunque sus días sean los mismos", async () => {
    await coincidentes();
    await escribir("data/dias-inhabiles-cnbv/calendario.json", {
      autoridad: "cnbv",
      plazos: { general: { cobertura: { desde: "2026-01-01", hasta: "2027-12-31" } } },
      fuentes_fin_de_semana: FINES,
    });
    expect(await diferenciasConDatos(publico, datos)).toEqual([
      "dias-inhabiles.cnbv: calendario distinto",
    ]);
  });
});
