import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/canonico.js";
import { archivosCurado } from "../../src/curado/generar.js";
import { interpretarCurado } from "../../src/curado/leer.js";
import { curadoDiasSat, curadoUma, type DefinicionCurado } from "../../src/curado/registro.js";
import { escribirDirectorioAtomico } from "../../src/escritura.js";
import { verificarDatos } from "../../src/verificar.js";
import { YAML_SAT, YAML_UMA } from "./ejemplos.js";

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "verificar-curado-"));
  await mkdir(join(raiz, "curado"));
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

const yamlUma = () => join(raiz, "curado", "constantes-uma.yaml");
const dirUma = () => join(raiz, "constantes-uma");

// biome-ignore lint/suspicious/noExplicitAny: cualquier dataset curado
async function generar(def: DefinicionCurado<any>, yaml: string): Promise<void> {
  const { documento } = interpretarCurado(def, yaml);
  if (documento === null) throw new Error("YAML inválido");
  await escribirDirectorioAtomico(join(raiz, def.directorio), archivosCurado(def, documento));
}

describe("verificarDatos con datos curados", () => {
  it("pasa sin YAML ni carpetas, y con el YAML y sus datos generados", async () => {
    expect(await verificarDatos(raiz)).toEqual([]);
    await writeFile(yamlUma(), YAML_UMA);
    await generar(curadoUma, YAML_UMA);
    expect(await verificarDatos(raiz)).toEqual([]);
  });

  it("pide correr curar si falta la carpeta generada o si no corresponde al YAML", async () => {
    await writeFile(yamlUma(), YAML_UMA);
    expect(await verificarDatos(raiz)).toEqual([
      "constantes-uma: faltan los datos generados; corre curar",
    ]);
    await generar(curadoUma, YAML_UMA);
    await writeFile(yamlUma(), YAML_UMA.replace("Unidad de medida", "Unidad de Medida"));
    expect(await verificarDatos(raiz)).toEqual([
      "constantes-uma: uma.json no corresponde a curado/constantes-uma.yaml; corre curar",
      "constantes-uma: manifest.json no corresponde a curado/constantes-uma.yaml; corre curar",
    ]);
  });

  it("detecta el JSON editado a mano aunque el manifiesto tenga su hash", async () => {
    await writeFile(yamlUma(), YAML_UMA);
    await generar(curadoUma, YAML_UMA);
    const datos = join(dirUma(), "uma.json");
    const texto = (await readFile(datos, "utf8")).replace('"3566.22"', '"3566.23"');
    await writeFile(datos, texto);
    const manifiesto = JSON.parse(await readFile(join(dirUma(), "manifest.json"), "utf8"));
    manifiesto.data_sha256 = sha256Hex(texto);
    await writeFile(join(dirUma(), "manifest.json"), `${JSON.stringify(manifiesto, null, 2)}\n`);
    expect(await verificarDatos(raiz)).toEqual([
      "constantes-uma: uma.json no corresponde a curado/constantes-uma.yaml; corre curar",
      "constantes-uma: manifest.json no corresponde a curado/constantes-uma.yaml; corre curar",
    ]);
  });

  it("detecta archivos de más o faltantes en la carpeta generada", async () => {
    await writeFile(yamlUma(), YAML_UMA);
    await generar(curadoUma, YAML_UMA);
    await mkdir(join(dirUma(), "raw"));
    await writeFile(join(dirUma(), "raw", "nota.html"), "x");
    await rm(join(dirUma(), "manifest.json"));
    expect(await verificarDatos(raiz)).toEqual([
      "constantes-uma: falta manifest.json; corre curar",
      "constantes-uma: archivo no declarado: raw/nota.html",
    ]);
  });

  it("revisa el calendario.json de un calendario contra su YAML", async () => {
    const yamlSat = join(raiz, "curado", "dias-inhabiles-sat.yaml");
    const calendario = join(raiz, "dias-inhabiles-sat", "calendario.json");
    await writeFile(yamlSat, YAML_SAT);
    await generar(curadoDiasSat, YAML_SAT);
    expect(await verificarDatos(raiz)).toEqual([]);
    const texto = await readFile(calendario, "utf8");
    await writeFile(calendario, texto.replace('"2026-11-30"', '"2026-12-31"'));
    expect(await verificarDatos(raiz)).toEqual([
      "dias-inhabiles-sat: calendario.json no corresponde a curado/dias-inhabiles-sat.yaml; corre curar",
    ]);
    await rm(calendario);
    expect(await verificarDatos(raiz)).toEqual([
      "dias-inhabiles-sat: falta calendario.json; corre curar",
    ]);
  });

  it("reporta los problemas del YAML con su ruta", async () => {
    await writeFile(yamlUma(), YAML_UMA.replace('mensual: "3566.22"', 'mensual: "3566.23"'));
    await mkdir(dirUma());
    expect(await verificarDatos(raiz)).toEqual([
      "curado/constantes-uma.yaml: invariante: 2026: mensual es 3566.23, se esperaba 3566.22 (diaria × 30.4)",
      "curado/constantes-uma.yaml: invariante: 2026: anual es 42794.64, se esperaba 42794.76 (mensual × 12)",
      "curado/constantes-uma.yaml: invariante: 2026: el fragmento de la fuente no contiene la mensual 3,566.23",
    ]);
  });

  it("falla si una fuente no trae url, fecha de publicación o fragmento", async () => {
    await writeFile(yamlUma(), YAML_UMA);
    await generar(curadoUma, YAML_UMA);
    const casos: [string, string][] = [
      ["    url: https://dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09/01/2026\n", "url"],
      ["    fecha_publicacion: 2026-01-09\n", "fecha_publicacion"],
      [/ {4}fragmento: "\[\.\.\.\] es de \$117[^\n]*\n/.exec(YAML_UMA)?.[0] ?? "", "fragmento"],
    ];
    for (const [linea, campo] of casos) {
      await writeFile(yamlUma(), YAML_UMA.replace(linea, ""));
      expect(await verificarDatos(raiz)).toEqual([
        `curado/constantes-uma.yaml: fuentes.uma-2026.${campo}: falta`,
      ]);
    }
  });

  it("detecta una carpeta generada sin YAML y archivos ajenos en data/curado", async () => {
    await writeFile(yamlUma(), YAML_UMA);
    await generar(curadoUma, YAML_UMA);
    await rm(yamlUma());
    await writeFile(join(raiz, "curado", "constantes-uma.yml"), YAML_UMA);
    await mkdir(join(raiz, "curado", "viejos"));
    await writeFile(join(raiz, "curado", "viejos", "uma.yaml"), YAML_UMA);
    expect(await verificarDatos(raiz)).toEqual([
      "curado: archivo no declarado: constantes-uma.yml",
      "curado: archivo no declarado: viejos/uma.yaml",
      "constantes-uma: falta curado/constantes-uma.yaml",
    ]);
  });
});
