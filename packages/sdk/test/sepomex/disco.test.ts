// Fallos del sistema de archivos (disco lleno, sin permiso) y lectura acotada de `importar`, con
// node:fs/promises envuelto para provocar los errores.
import { mkdir, mkdtemp, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cp, estado, importar, LIMITES, sync } from "../../src/sepomex/index.js";
import { cargarSqlite, nodeConSqlite } from "../../src/sepomex/sqlite.js";
import { fetchFalso, zipOficial } from "./ayudas.js";
import { rechazo } from "./comun.js";

const fs = vi.hoisted(() => ({
  /** Parte de la ruta en la que `open`, `mkdir` o `writeFile` fallan, con su código. */
  falla: undefined as { en: string; codigo: string; funcion: string } | undefined,
  /** `stat` dice que el archivo pesa 10 bytes (como si creciera después de revisarlo). */
  statChico: false,
  lecturasMeta: 0,
}));

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  const fallar = (funcion: string, ruta: unknown) => {
    const f = fs.falla;
    if (f && f.funcion === funcion && String(ruta).includes(f.en)) {
      throw Object.assign(new Error(`${f.codigo}: falla de prueba, ${funcion} '${ruta}'`), {
        code: f.codigo,
      });
    }
  };
  return {
    ...real,
    open: async (ruta: string, ...resto: [never]) => {
      fallar("open", ruta);
      return real.open(ruta, ...resto);
    },
    mkdir: async (ruta: string, ...resto: [never]) => {
      fallar("mkdir", ruta);
      return real.mkdir(ruta, ...resto);
    },
    writeFile: async (ruta: string, ...resto: [never, never]) => {
      fallar("writeFile", ruta);
      return real.writeFile(ruta, ...resto);
    },
    readFile: async (ruta: string, ...resto: [never]) => {
      if (String(ruta).endsWith("meta.json")) fs.lecturasMeta++;
      return real.readFile(ruta, ...resto);
    },
    stat: async (ruta: string, ...resto: [never]) => {
      const info = await real.stat(ruta, ...resto);
      if (fs.statChico && String(ruta).endsWith("grande.txt")) {
        return Object.assign(Object.create(Object.getPrototypeOf(info)), info, { size: 10 });
      }
      return info;
    },
  };
});

let trabajo: string;
let dir: string;
const aviso = () => {};

beforeEach(async () => {
  trabajo = await mkdtemp(join(tmpdir(), "mexicoapi-sepomex-"));
  dir = join(trabajo, "cache");
  fs.falla = undefined;
  fs.statChico = false;
});

afterEach(async () => {
  fs.falla = undefined;
  await rm(trabajo, { recursive: true, force: true, maxRetries: 3 });
});

const archivo = async (nombre: string, bytes: Uint8Array) => {
  const ruta = join(trabajo, nombre);
  await writeFile(ruta, bytes);
  return ruta;
};

it("un disco lleno al escribir es SepomexError `escritura` y la caché anterior queda", async () => {
  const zip = await archivo("cp.zip", zipOficial());
  const antes = await importar(zip, { dir, aviso });
  const archivos = (await readdir(dir)).sort();
  fs.falla = { en: ".json.tmp-", codigo: "ENOSPC", funcion: "open" };
  const error = await rechazo(
    importar(zip, { dir, aviso }),
    "escritura",
    /No se pudo guardar el catálogo en .*cache \(ENOSPC: falla de prueba/,
  );
  expect((error.cause as { code?: string }).code).toBe("ENOSPC");
  expect((await readdir(dir)).sort()).toEqual(archivos);
  expect(await estado({ dir })).toEqual(antes);
});

it("sin permiso para crear el directorio o el candado: `escritura`, sin pedir nada", async () => {
  fs.falla = { en: "cache", codigo: "EACCES", funcion: "mkdir" };
  const { fetch, llamadas } = fetchFalso();
  await rechazo(sync({ dir, aviso, fetch }), "escritura", /EACCES/);
  fs.falla = { en: "sync.lock", codigo: "EACCES", funcion: "writeFile" };
  await rechazo(sync({ dir, aviso, fetch }), "escritura", /EACCES/);
  expect(llamadas).toHaveLength(0);
});

it("importar rechaza lo que no es un archivo", async () => {
  await mkdir(join(trabajo, "carpeta.zip"));
  await rechazo(
    importar(join(trabajo, "carpeta.zip"), { dir, aviso }),
    "archivo-invalido",
    /carpeta\.zip no es un archivo/,
  );
});

it("importar deja de leer al pasar del límite aunque el tamaño cambie después de revisarlo", async () => {
  const grande = join(trabajo, "grande.txt");
  await writeFile(grande, "");
  await truncate(grande, LIMITES.txt + 1);
  fs.statChico = true;
  await rechazo(importar(grande, { dir, aviso }), "archivo-invalido", /pasa de 60\.0 MB/);
});

it("no vuelve a leer meta.json en cada consulta si no cambió", async () => {
  await importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
  fs.lecturasMeta = 0;
  await cp("80000", { dir });
  await cp("80010", { dir });
  await estado({ dir });
  expect(fs.lecturasMeta).toBe(1);
  await importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
  fs.lecturasMeta = 0;
  await cp("80000", { dir });
  expect(fs.lecturasMeta).toBe(1);
});

it("sabe desde qué Node hay node:sqlite y lo dice si no lo hay", async () => {
  for (const v of ["20.11.1", "20.19.0", "22.12.0", "23.3.0"])
    expect(nodeConSqlite(v), v).toBe(false);
  for (const v of ["22.13.0", "22.20.1", "23.4.0", "24.0.0", "26.1.0"]) {
    expect(nodeConSqlite(v), v).toBe(true);
  }
  expect(await cargarSqlite("20.11.1")).toEqual({
    motivo:
      "Node 20.11.1 no trae node:sqlite sin bandera (llegó en 22.13): la caché queda solo en JSON.",
  });
  expect(await cargarSqlite()).toHaveProperty("modulo");
});

it("estado dice por qué no hay SQLite", async () => {
  const sin = await importar(await archivo("cp.zip", zipOficial()), { dir, aviso, sqlite: false });
  expect(sin.sqlite).toBeNull();
  expect(sin.sin_sqlite).toBe("Se guardó sin SQLite porque se pidió con sqlite: false.");
  const con = await importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
  expect(con.sqlite).not.toBeNull();
  expect(con.sin_sqlite).toBeNull();
  expect((await estado({ dir }))?.sin_sqlite).toBeNull();
});
