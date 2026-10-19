// `revisar` compara los datos de un PR del bot con los de main y decide, con las mismas reglas que
// `actualizar`, si piden revisión humana. El job revision-datos de ci.yml lo corre con el código
// de main, así que la decisión no depende de lo que diga el job que procesó las fuentes.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { principal } from "../src/cli.js";
import { crearEntorno, PRUEBA_LENTA } from "./ayudas.js";

const REAL = fileURLToPath(new URL("../../../data", import.meta.url));

let antes: string;
let despues: string;
beforeEach(async () => {
  antes = await mkdtemp(join(tmpdir(), "revisar-antes-"));
  despues = await mkdtemp(join(tmpdir(), "revisar-despues-"));
  for (const raiz of [antes, despues]) {
    for (const dir of [
      "inegi-estados",
      "inegi-municipios",
      "bancos",
      "tipo-cambio-fix",
      "udis",
      "curado",
    ]) {
      await cp(join(REAL, dir), join(raiz, dir), { recursive: true });
    }
  }
});
afterEach(async () => {
  await rm(antes, { recursive: true, force: true });
  await rm(despues, { recursive: true, force: true });
});

/** Lee, cambia y vuelve a escribir el snapshot de `archivo` en los datos nuevos. */
async function cambiar<T>(archivo: string, cambio: (registros: T[]) => T[]): Promise<void> {
  const ruta = join(despues, archivo);
  const registros = JSON.parse(await readFile(ruta, "utf8")) as T[];
  await writeFile(ruta, `${JSON.stringify(cambio(registros), null, 2)}\n`);
}

async function revisar(...extra: string[]) {
  const entorno = await crearEntorno(despues);
  const codigo = await principal(["revisar", "--antes", antes, "--datos", despues, ...extra], {
    ...entorno,
    // revisar no usa la red: cualquier pedido es un error.
    crearCliente: () => {
      throw new Error("revisar no debe crear un cliente HTTP");
    },
  });
  return { codigo, salida: entorno.salida.join(""), errores: entorno.errores.join("") };
}

interface Udi {
  fecha: string;
  valor: string;
}

describe("revisar", { timeout: PRUEBA_LENTA }, () => {
  it("sin cambios termina en 0 y lo dice por dataset", async () => {
    const r = await revisar();
    expect(r.codigo).toBe(0);
    for (const id of ["inegi.estados", "inegi.municipios", "bancos", "tipo-cambio.fix", "udis"]) {
      expect(r.salida).toContain(`${id}: sin_cambios`);
    }
    expect(r.errores).toBe("");
  });

  it("una UDI nueva dentro del umbral no pide revisión", async () => {
    await cambiar<Udi>("udis/udis.json", (rs) => [
      ...rs,
      { fecha: "2026-10-26", valor: (rs.at(-1) as Udi).valor },
    ]);
    const r = await revisar();
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain("udis: actualizado (+1 -0 ~0)");
  });

  it("cambiar un valor ya publicado pide revisión, con el motivo del dataset", async () => {
    await cambiar<Udi>("udis/udis.json", (rs) =>
      rs.map((u) => (u.fecha === "2026-10-01" ? { ...u, valor: "9.000000" } : u)),
    );
    const r = await revisar();
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain("udis: requiere_revision (+0 -0 ~1)");
    expect(r.salida).toMatch(/cambió el valor de 2026-10-01: \S+ → 9\.000000/);
  });

  it("un cambio en más del 0.5 % de los municipios pide revisión; uno solo, no", async () => {
    interface Municipio {
      cvegeo: string;
      nombre: string;
    }
    await cambiar<Municipio>("inegi-municipios/municipios.json", (rs) =>
      rs.map((m, i) => (i === 0 ? { ...m, nombre: `${m.nombre} (nuevo)` } : m)),
    );
    expect((await revisar()).codigo).toBe(0);
    await cambiar<Municipio>("inegi-municipios/municipios.json", (rs) =>
      rs.map((m, i) => (i < 40 ? { ...m, nombre: `${m.nombre} (nuevo)` } : m)),
    );
    const r = await revisar();
    expect(r.codigo).toBe(3);
    expect(r.salida).toMatch(/sobre el umbral de 0\.5 %/);
  });

  it("cualquier cambio en los estados pide revisión", async () => {
    await cambiar<{ nombre: string }>("inegi-estados/estados.json", (rs) =>
      rs.map((e, i) => (i === 0 ? { ...e, nombre: "Otro" } : e)),
    );
    const r = await revisar();
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain("cambio en el catálogo de estados");
  });

  it("sin el snapshot anterior es el inicial, como en actualizar", async () => {
    await rm(join(antes, "udis"), { recursive: true });
    const r = await revisar();
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain("udis: actualizado");
    expect(r.salida).toContain("snapshot inicial");
  });

  it("un snapshot que desaparece, no cumple el esquema o rompe un invariante es un error", async () => {
    await rm(join(despues, "udis", "udis.json"));
    let r = await revisar();
    expect(r.codigo).toBe(1);
    expect(r.errores).toContain("udis: desapareció el snapshot");

    await cp(join(antes, "udis"), join(despues, "udis"), { recursive: true });
    await cambiar<Udi>("udis/udis.json", (rs) => [...rs, { fecha: "2026-10-26", valor: "x" }]);
    r = await revisar();
    expect(r.codigo).toBe(1);
    expect(r.errores).toMatch(/^udis: Esquema inválido/m);

    await cp(join(antes, "udis"), join(despues, "udis"), { recursive: true });
    await cambiar<Udi>("udis/udis.json", (rs) => rs.filter((u) => u.fecha !== "2026-10-01"));
    r = await revisar();
    expect(r.codigo).toBe(1);
    expect(r.errores).toMatch(/^udis: Invariantes violados: huecos en la serie diaria/m);
  });

  it("pide --antes y no acepta argumentos de más", async () => {
    const entorno = await crearEntorno(despues);
    expect(await principal(["revisar", "--datos", despues], entorno)).toBe(1);
    expect(entorno.errores.join("")).toContain("Falta --antes");
    expect(await principal(["revisar", "--antes", antes, "udis"], entorno)).toBe(1);
    expect(await principal(["revisar", "--antes", antes, "--seco"], entorno)).toBe(1);
  });
});
