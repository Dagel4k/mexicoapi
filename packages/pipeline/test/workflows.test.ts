import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DATASETS } from "../src/registro.js";

// Los workflows del bot no corren código del repo para saber qué carpetas puede tocar cada grupo:
// las listas van escritas en el YAML. Estas pruebas las comparan con el registro de datasets.

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));

interface Paso {
  name?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Workflow {
  on: { workflow_dispatch: { inputs: { dataset: { options: string[] } } } };
  jobs: Record<string, { steps: Paso[] }>;
}

async function workflow(nombre: string): Promise<Workflow> {
  return parse(await readFile(join(RAIZ, ".github", "workflows", nombre), "utf8")) as Workflow;
}

function paso(wf: Workflow, job: string, nombre: string): Paso {
  const encontrado = wf.jobs[job]?.steps.find((p) => p.name === nombre);
  if (encontrado === undefined) throw new Error(`no existe el paso "${nombre}" en ${job}`);
  return encontrado;
}

const carpetasDelRegistro = (): string[] => [...DATASETS.values()].map((d) => d.directorio).sort();

describe("carpetas del bot de datos en los workflows", () => {
  it("cada grupo de preparar lista los ids y las carpetas de sus datasets", async () => {
    const datos = await workflow("datos.yml");
    const run = paso(datos, "preparar", "Resolver grupo de datos").run ?? "";
    const grupos = [...run.matchAll(/^\s*([a-z]+)\) ids="([^"]+)"; carpetas="([^"]+)" ;;$/gm)];
    const nombres = grupos.map((g) => g[1]);
    expect(nombres).toEqual(["inegi", "bancos", "fix", "udis"]);
    expect(datos.on.workflow_dispatch.inputs.dataset.options).toEqual(nombres);
    const vistos: string[] = [];
    for (const [, grupo, ids = "", carpetas = ""] of grupos) {
      const defs = ids.split(" ").map((id) => {
        const def = DATASETS.get(id);
        if (def === undefined) throw new Error(`${grupo}: dataset desconocido ${id}`);
        return def;
      });
      expect(carpetas.split(" ").sort(), grupo).toEqual(defs.map((d) => d.directorio).sort());
      vistos.push(...ids.split(" "));
    }
    expect(vistos.sort()).toEqual([...DATASETS.keys()].sort());
  });

  it("solo-datos de ci.yml acepta las carpetas de todos los datasets y ninguna más", async () => {
    const ci = await workflow("ci.yml");
    const env = paso(ci, "solo-datos", "Exigir que solo toque data/").env ?? {};
    expect((env.CARPETAS ?? "").split(" ").sort()).toEqual(carpetasDelRegistro());
  });

  it("los archivos actuales de esas carpetas cumplen la regla de nombres de los workflows", async () => {
    // La misma regla que publicar (datos.yml) y solo-datos (ci.yml) aplican a cada ruta.
    const regla = /^data\/[a-z-]+\/[A-Za-z0-9._/-]+$/;
    for (const carpeta of carpetasDelRegistro()) {
      const dir = join(RAIZ, "data", carpeta);
      const archivos = await readdir(dir, { recursive: true, withFileTypes: true });
      for (const a of archivos.filter((x) => x.isFile())) {
        const ruta = relative(RAIZ, join(a.parentPath, a.name)).replaceAll("\\", "/");
        expect(ruta).toMatch(regla);
        expect(`/${ruta.toLowerCase()}/`).not.toMatch(/\/(\.\.?|\.git[^/]*)?\//);
      }
    }
  });
});
