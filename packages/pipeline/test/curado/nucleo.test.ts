// curar, verificar y el bot arman cada calendario con crearCalendarioCurado del núcleo, como el
// Worker y el paquete: si el núcleo lo rechaza, fallan con su mensaje en vez de escribir un
// calendario que ellos no cargarían. El núcleo se envuelve para contar las llamadas y rechazar.
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiaInhabilCurado } from "@mexicoapi/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type Entorno, principal } from "../../src/cli.js";
import { descansosBancarios } from "../../src/datasets/sidof.js";
import { YAML_CNBV, YAML_SAT } from "./ejemplos.js";

const nucleo = vi.hoisted(() => ({
  rechazo: undefined as string | undefined,
  llamadas: [] as string[],
}));

vi.mock("@mexicoapi/core/curados", async (original) => {
  const real = await original<typeof import("@mexicoapi/core/curados")>();
  return {
    ...real,
    crearCalendarioCurado: (datos: Parameters<typeof real.crearCalendarioCurado>[0]) => {
      nucleo.llamadas.push(datos.autoridad);
      if (nucleo.rechazo !== undefined) throw new RangeError(nucleo.rechazo);
      return real.crearCalendarioCurado(datos);
    },
  };
});

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "curar-nucleo-"));
  await mkdir(join(raiz, "curado"));
  nucleo.rechazo = undefined;
  nucleo.llamadas = [];
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

function entorno(): Entorno & { salida: string[]; errores: string[] } {
  const salida: string[] = [];
  const errores: string[] = [];
  return {
    crearCliente: () => {
      throw new Error("curar no usa la red");
    },
    raizDatos: raiz,
    ahora: () => new Date("2026-10-18T12:00:00Z"),
    escribir: (t) => void salida.push(t),
    escribirError: (t) => void errores.push(t),
    salida,
    errores,
  };
}

const escribirYaml = (nombre: string, texto: string) =>
  writeFile(join(raiz, "curado", nombre), texto);

it("curar y verificar arman cada calendario con el núcleo", async () => {
  await escribirYaml("dias-inhabiles-sat.yaml", YAML_SAT);
  await escribirYaml("dias-inhabiles-cnbv.yaml", YAML_CNBV);
  expect(await principal(["curar"], entorno())).toBe(0);
  expect(nucleo.llamadas.sort()).toEqual(["cnbv", "sat"]);
  nucleo.llamadas = [];
  expect(await principal(["verificar"], entorno())).toBe(0);
  expect(nucleo.llamadas.sort()).toEqual(["cnbv", "sat"]);
});

it("si el núcleo rechaza un calendario, curar sale 1 con su mensaje y no escribe nada", async () => {
  await escribirYaml("dias-inhabiles-sat.yaml", YAML_SAT);
  nucleo.rechazo =
    "El calendario de sat tiene un día inesperado, repetido o fuera de orden: 2026-01-01.";
  const e = entorno();
  expect(await principal(["curar"], e)).toBe(1);
  expect(e.errores.join("")).toContain(
    "curado/dias-inhabiles-sat.yaml: el núcleo rechaza el calendario: El calendario de sat tiene un día inesperado, repetido o fuera de orden: 2026-01-01.",
  );
  expect(e.salida).toEqual([]);
  expect(await readdir(raiz)).toEqual(["curado"]);
});

it("el bot toma los feriados bancarios del calendario que arma el núcleo", () => {
  const fuente = {
    nombre: "Disposiciones de la CNBV para 2026",
    url: "https://dof.gob.mx/",
    fecha_publicacion: "2025-12-10",
    fragmento: "IX. Los sábados y domingos.",
  };
  const dia = (fecha: string): DiaInhabilCurado => ({
    fecha,
    autoridad: "cnbv",
    motivo: "Día de prueba",
    tipo: "descanso",
    fuente,
  });
  const cobertura = { descanso: { desde: "2026-01-01", hasta: "2026-12-31" } };
  const esDescanso = descansosBancarios(cobertura, [dia("2026-11-02"), dia("2026-12-25")]);
  expect(nucleo.llamadas).toEqual(["cnbv"]);
  expect(esDescanso("2026-11-02")).toBe(true);
  expect(esDescanso("2026-11-03")).toBe(false);
  nucleo.rechazo = "El calendario de cnbv no cita los fines de semana de 2026.";
  expect(() => descansosBancarios(cobertura, [dia("2026-12-25")])).toThrow(
    /el núcleo rechaza el calendario: El calendario de cnbv no cita/,
  );
});
