// Fallos del sistema de archivos (disco lleno, sin permiso) y lectura acotada de `importar`, con
// node:fs/promises envuelto para provocar los errores.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cp, importar, LIMITES, resumen, sync } from "../../src/sepomex/index.js";
import { cargarSqlite, nodeConSqlite } from "../../src/sepomex/sqlite.js";
import { fetchFalso, txt, zipOficial } from "./ayudas.js";
import { rechazo } from "./comun.js";

const fs = vi.hoisted(() => ({
  /** Parte de la ruta en la que `open`, `mkdir` o `writeFile` fallan, con su código. */
  falla: undefined as { en: string; codigo: string; funcion: string } | undefined,
  /**
   * Tamaño que dice el `stat` del descriptor de `grande.txt` (como si el archivo cambiara después
   * de revisarlo); undefined deja el real.
   */
  tamanoDescriptor: undefined as number | undefined,
  /** Lecturas de meta.json, por ruta o por descriptor. */
  lecturasMeta: 0,
  /** `stat` por ruta de lo que se importa o de meta.json (lo que debe revisarse en el descriptor). */
  statPorRuta: [] as string[],
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
      const archivo = await real.open(ruta, ...resto);
      const nombre = String(ruta);
      if (nombre.endsWith("meta.json")) {
        const leer = archivo.readFile.bind(archivo);
        archivo.readFile = ((...args: Parameters<typeof leer>) => {
          fs.lecturasMeta++;
          return leer(...args);
        }) as typeof archivo.readFile;
      }
      const tamano = fs.tamanoDescriptor;
      if (tamano !== undefined && nombre.endsWith("grande.txt")) {
        const revisar = archivo.stat.bind(archivo);
        archivo.stat = (async () => {
          const info = await revisar();
          return Object.assign(Object.create(Object.getPrototypeOf(info)), info, { size: tamano });
        }) as typeof archivo.stat;
      }
      return archivo;
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
      const nombre = String(ruta);
      if (/(meta\.json|grande\.txt|carpeta\.zip|cp\.zip)$/.test(nombre)) {
        fs.statPorRuta.push(nombre);
      }
      return real.stat(ruta, ...resto);
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
  fs.tamanoDescriptor = undefined;
  fs.statPorRuta = [];
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
  expect(await resumen({ dir })).toEqual(antes);
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
  fs.tamanoDescriptor = 10;
  await rechazo(importar(grande, { dir, aviso }), "archivo-invalido", /pasa de 60\.0 MB/);
});

it("importar revisa el tamaño en el archivo abierto, no en la ruta", async () => {
  // La ruta tiene un archivo chico y el descriptor dice más del límite: manda el descriptor.
  const grande = await archivo("grande.txt", txt());
  fs.tamanoDescriptor = LIMITES.txt + 1;
  await rechazo(
    importar(grande, { dir, aviso }),
    "archivo-invalido",
    /pesa 60\.0 MB y el límite es 60\.0 MB/,
  );
  expect(fs.statPorRuta).toEqual([]);
});

it("importar abre primero y revisa sobre el descriptor, sin stat de la ruta", async () => {
  await importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
  await mkdir(join(trabajo, "carpeta.zip"));
  await rechazo(
    importar(join(trabajo, "carpeta.zip"), { dir, aviso }),
    "archivo-invalido",
    /carpeta\.zip no es un archivo/,
  );
  expect(fs.statPorRuta.filter((r) => !r.endsWith("meta.json"))).toEqual([]);
});

it("una carpeta que el sistema no deja abrir (EISDIR) tampoco es un archivo", async () => {
  const ruta = await archivo("cp.zip", zipOficial());
  fs.falla = { en: "cp.zip", codigo: "EISDIR", funcion: "open" };
  await rechazo(importar(ruta, { dir, aviso }), "archivo-invalido", /cp\.zip no es un archivo\./);
});

it.skipIf(process.platform === "win32")(
  "importar rechaza un FIFO y un dispositivo sin quedarse esperando",
  async () => {
    const fifo = join(trabajo, "tuberia.zip");
    execFileSync("mkfifo", [fifo]);
    await rechazo(
      importar(fifo, { dir, aviso }),
      "archivo-invalido",
      /tuberia\.zip no es un archivo/,
    );
    await rechazo(importar("/dev/null", { dir, aviso }), "archivo-invalido", /no es un archivo/);
  },
);

it("no vuelve a leer meta.json en cada consulta si no cambió", async () => {
  await importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
  fs.lecturasMeta = 0;
  await cp("80000", { dir });
  await cp("80010", { dir });
  await resumen({ dir });
  expect(fs.lecturasMeta).toBe(1);
  await importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
  fs.lecturasMeta = 0;
  await cp("80000", { dir });
  expect(fs.lecturasMeta).toBe(1);
  // La marca (mtime, tamaño, inodo) sale del descriptor abierto, no de un stat de la ruta.
  expect(fs.statPorRuta.filter((r) => r.endsWith("meta.json"))).toEqual([]);
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

it("resumen dice por qué no hay SQLite", async () => {
  const sin = await importar(await archivo("cp.zip", zipOficial()), { dir, aviso, sqlite: false });
  expect(sin.sqlite).toBeNull();
  expect(sin.sin_sqlite).toBe("Se guardó sin SQLite porque se pidió con sqlite: false.");
  const con = await importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
  expect(con.sqlite).not.toBeNull();
  expect(con.sin_sqlite).toBeNull();
  expect((await resumen({ dir }))?.sin_sqlite).toBeNull();
});
