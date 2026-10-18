// Guardados al mismo tiempo en un directorio: el candado `sync.lock` deja pasar a uno y la caché
// queda válida; un candado abandonado se puede tomar; la limpieza solo borra lo que ya no vale.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  cp,
  importar,
  type ResumenSepomex,
  resumen,
  SepomexError,
  sync,
} from "../../src/sepomex/index.js";
import { fetchFalso, lineasTxt, txt, zipOficial } from "./ayudas.js";
import { rechazo } from "./comun.js";

let trabajo: string;
let dir: string;
const aviso = () => {};

beforeEach(async () => {
  trabajo = await mkdtemp(join(tmpdir(), "mexicoapi-sepomex-"));
  dir = join(trabajo, "cache");
});

afterEach(async () => {
  await rm(trabajo, { recursive: true, force: true, maxRetries: 3 });
});

const archivo = async (nombre: string, bytes: Uint8Array) => {
  const ruta = join(trabajo, nombre);
  await writeFile(ruta, bytes);
  return ruta;
};

/** Los archivos que nombra el estado, relativos al directorio. */
const nombresDe = (e: ResumenSepomex) =>
  [e.json, e.sqlite].filter((r): r is string => r !== null).map((r) => r.slice(e.dir.length + 1));

async function cacheValida(): Promise<void> {
  const e = (await resumen({ dir })) as ResumenSepomex;
  expect((await cp("80000", { dir }))?.cp).toBe("80000");
  expect((await readdir(dir)).sort()).toEqual(["meta.json", ...nombresDe(e)].sort());
}

const candado = (datos: Record<string, unknown>) =>
  writeFile(join(dir, "sync.lock"), JSON.stringify(datos));

it("dos guardados a la vez dejan una caché válida: uno espera su turno con un error claro", async () => {
  const a = await archivo("a.txt", txt());
  const b = await archivo("b.txt", txt(lineasTxt().map((l) => l.replace("Culiacán Centro", "B"))));
  for (let vuelta = 0; vuelta < 12; vuelta++) {
    const sqlite = vuelta % 2 === 0;
    const resultados = await Promise.allSettled([
      importar(a, { dir, aviso, sqlite }),
      new Promise((listo) => setTimeout(listo, vuelta % 6)).then(() =>
        importar(b, { dir, aviso, sqlite }),
      ),
    ]);
    expect(resultados.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of resultados) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(SepomexError);
        expect((r.reason as SepomexError).tipo).toBe("ocupado");
      }
    }
    await cacheValida();
  }
});

it("con el candado de un proceso vivo dice que otra sincronización está en curso", async () => {
  await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
  const datos = {
    pid: process.pid,
    host: hostname(),
    desde: "2026-10-18T13:00:00.000Z",
    ficha: "x",
  };
  await candado(datos);
  const { fetch, llamadas } = fetchFalso();
  await rechazo(
    sync({ dir, aviso, fetch }),
    "ocupado",
    new RegExp(
      `otra sincronización está guardando en .* \\(proceso ${process.pid} desde 2026-10-18T13:00:00\\.000Z\\)`,
      "i",
    ),
  );
  expect(llamadas).toHaveLength(0);
  expect(JSON.parse(await readFile(join(dir, "sync.lock"), "utf8"))).toEqual(datos);
  await rm(join(dir, "sync.lock"));
  await cacheValida();
});

it("toma un candado abandonado hace más de 10 minutos", async () => {
  await mkdir(dir, { recursive: true });
  await candado({ pid: process.pid, host: hostname(), desde: "x", ficha: "vieja" });
  const hace11min = new Date(Date.now() - 11 * 60_000);
  await utimes(join(dir, "sync.lock"), hace11min, hace11min);
  await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
  await cacheValida();
});

it("toma el candado de un proceso que ya terminó en este equipo", async () => {
  const hijo = spawnSync(process.execPath, ["-e", ""], { timeout: 30_000 });
  expect(hijo.status).toBe(0);
  await mkdir(dir, { recursive: true });
  await candado({ pid: hijo.pid, host: hostname(), desde: new Date().toISOString(), ficha: "x" });
  await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
  await cacheValida();
});

it("un candado vacío o de otro equipo, si es reciente, se respeta", async () => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sync.lock"), "");
  await rechazo(
    importar(await archivo("a.zip", zipOficial()), { dir, aviso }),
    "ocupado",
    /proceso \?/,
  );
  await candado({ pid: 1, host: "otro-equipo", desde: new Date().toISOString(), ficha: "x" });
  await rechazo(
    importar(await archivo("a.zip", zipOficial()), { dir, aviso }),
    "ocupado",
    /proceso 1 /,
  );
});

it("borra los archivos del catálogo reemplazado y los huérfanos viejos, no los recientes", async () => {
  const primera = await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
  const viejo = join(dir, "codigos-aaaaaaaaaaaa.json");
  const temporalViejo = join(dir, "meta.json.tmp-aaaaaaaaaaaa");
  const reciente = join(dir, "codigos-bbbbbbbbbbbb.sqlite");
  for (const ruta of [viejo, temporalViejo, reciente]) await writeFile(ruta, "x");
  const hace2h = new Date(Date.now() - 2 * 3_600_000);
  await utimes(viejo, hace2h, hace2h);
  await utimes(temporalViejo, hace2h, hace2h);
  const segunda = await importar(await archivo("b.zip", zipOficial()), { dir, aviso });
  expect((await readdir(dir)).sort()).toEqual(
    ["meta.json", "codigos-bbbbbbbbbbbb.sqlite", ...nombresDe(segunda)].sort(),
  );
  expect(nombresDe(primera).some((n) => nombresDe(segunda).includes(n))).toBe(false);
});

it("repara una caché con meta.json dañado", async () => {
  await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
  await writeFile(join(dir, "meta.json"), "{");
  await rechazo(resumen({ dir }), "cache-invalida", /dañado/);
  await importar(await archivo("a.zip", zipOficial()), { dir, aviso });
  expect((await cp("80000", { dir }))?.cp).toBe("80000");
});
