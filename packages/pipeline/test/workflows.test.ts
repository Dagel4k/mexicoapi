import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { leerCoberturas, PREFIJO_TITULO, porVencer } from "../src/coberturas.js";
import { DATASETS } from "../src/registro.js";

// Los workflows del bot no corren código del repo para saber qué carpetas puede tocar cada grupo:
// las listas van escritas en el YAML. Estas pruebas las comparan con el registro de datasets.

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));

interface Paso {
  name?: string;
  id?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, string>;
}

interface Job {
  needs?: string;
  if?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Paso[];
}

interface Workflow {
  on: { workflow_dispatch: { inputs: { dataset: { options: string[] } } } };
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}

async function workflow(nombre: string): Promise<Workflow> {
  return parse(await readFile(join(RAIZ, ".github", "workflows", nombre), "utf8")) as Workflow;
}

function paso(wf: Workflow, job: string, nombre: string): Paso {
  const encontrado = wf.jobs[job]?.steps.find((p) => p.name === nombre);
  if (encontrado === undefined) throw new Error(`no existe el paso "${nombre}" en ${job}`);
  return encontrado;
}

/** Las líneas de `patron=` y de la función `ruta_valida` de un bloque run, sin sangría. */
function reglaDeRutas(run: string): string {
  const lineas = run.split("\n").map((l) => l.trimStart());
  const inicio = lineas.findIndex(
    (l, i) => l.startsWith("patron=") && lineas[i + 1] === "ruta_valida() {",
  );
  const fin = lineas.indexOf("}", inicio + 2);
  if (inicio === -1 || fin === -1) throw new Error("no se encontró ruta_valida");
  return lineas.slice(inicio, fin + 1).join("\n");
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

  it("publicar y solo-datos revisan cada ruta con la misma regla, que rechaza los puntos", async () => {
    const datos = await workflow("datos.yml");
    const ci = await workflow("ci.yml");
    const enPublicar = reglaDeRutas(
      paso(datos, "publicar", "Revisar y aplicar el parche").run ?? "",
    );
    const enCi = reglaDeRutas(paso(ci, "solo-datos", "Exigir que solo toque data/").run ?? "");
    expect(enPublicar).toBe(enCi);
    // Fuera cualquier componente vacío o que empiece con punto (., .., .git, ocultos).
    expect(enPublicar).toContain('case "/$1/" in\n*/.* | *//*) return 1 ;;\nesac');
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
        expect(`/${ruta}/`, ruta).not.toMatch(/\/[/.]/);
      }
    }
  });
});

/** Una expresión de GitHub Actions: `${{ texto }}`. */
const expresion = (texto: string): string => `\${{ ${texto} }}`;

/** La función `nombre` de un bloque run, sin sangría: de `nombre() {` a su `}`. */
function funcion(run: string, nombre: string): string {
  const lineas = run.split("\n").map((l) => l.trimStart());
  const inicio = lineas.indexOf(`${nombre}() {`);
  const fin = lineas.indexOf("}", inicio);
  if (inicio === -1 || fin === -1) throw new Error(`no se encontró ${nombre}`);
  return lineas.slice(inicio, fin + 1).join("\n");
}

describe("alerta de coberturas en frescura.yml", () => {
  it("coberturas instala y corre el pipeline sin poder escribir, con las acciones fijadas", async () => {
    const frescura = await workflow("frescura.yml");
    const datos = await workflow("datos.yml");
    const job = frescura.jobs.coberturas as Job;
    expect(job.permissions).toEqual({ contents: "read" });
    // Una corrida a mano en otra rama no abre issues con los data/ de esa rama.
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(frescura.env).toEqual({ DIAS_AVISO: "30" });
    expect(job.outputs).toEqual({ lista: expresion("steps.calcular.outputs.lista") });
    // Las mismas versiones fijadas por SHA que el bot de datos.
    const usos = (j: Job | undefined) => (j?.steps ?? []).flatMap((p) => p.uses ?? []);
    expect(usos(job)).toEqual([
      expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
      expect.stringMatching(/^pnpm\/action-setup@[0-9a-f]{40}$/),
      expect.stringMatching(/^actions\/setup-node@[0-9a-f]{40}$/),
    ]);
    expect(usos(datos.jobs.generar)).toEqual(expect.arrayContaining(usos(job)));
    expect(job.steps[0]?.with).toMatchObject({ "persist-credentials": false });
    const calcular = job.steps.find((p) => p.id === "calcular");
    expect(calcular?.env).toBeUndefined();
    expect(calcular?.run).toContain(
      `node packages/pipeline/dist/bin.js coberturas --dias "\${DIAS_AVISO}" --json`,
    );
  });

  it("avisar-coberturas solo escribe issues, no instala nada y recibe la lista por env", async () => {
    const frescura = await workflow("frescura.yml");
    const job = frescura.jobs["avisar-coberturas"] as Job;
    expect(job.needs).toBe("coberturas");
    expect(job.if).toBe(
      "github.ref == 'refs/heads/main' && needs.coberturas.outputs.lista != '[]'",
    );
    expect(job.permissions).toEqual({ issues: "write" });
    expect(job.steps.flatMap((p) => p.uses ?? [])).toEqual([]);
    const [unico] = job.steps;
    expect(job.steps).toHaveLength(1);
    expect(unico?.env).toEqual({
      LISTA: expresion("needs.coberturas.outputs.lista"),
      GH_TOKEN: expresion("github.token"),
      GH_REPO: expresion("github.repository"),
    });
    // Nada se interpola en el script: todo llega por env.
    for (const nombre of ["coberturas", "avisar-coberturas"]) {
      for (const p of frescura.jobs[nombre]?.steps ?? []) {
        expect(p.run ?? "", `${nombre} ${p.name}`).not.toContain("$" + "{{");
      }
    }
    // Busca el issue abierto igual que la revisión de frescura, sin crear nada si falla.
    const revisar = paso(frescura, "revisar", "Revisar frescura de los datos").run ?? "";
    expect(funcion(unico?.run ?? "", "buscar_abierto")).toBe(funcion(revisar, "buscar_abierto"));
    expect(unico?.run).toContain("blob/main/docs/operacion/datos-curados.md");
    expect(unico?.run).toContain(`mientras la cobertura termine en \${DIAS_AVISO} días o menos`);
    // La forma de la lista se revisa antes del bucle: una falla de jq ahí no se vería.
    const guardia = unico?.run?.indexOf('jq -e \'type == "array"') ?? -1;
    expect(guardia).toBeGreaterThan(-1);
    expect(guardia).toBeLessThan(unico?.run?.indexOf("while IFS=") ?? -1);
    expect(unico?.run).not.toMatch(/gh issue (close|comment)/);
  });

  it("lee los campos que da el comando y acepta el título de cada cobertura real", async () => {
    const frescura = await workflow("frescura.yml");
    const run = frescura.jobs["avisar-coberturas"]?.steps[0]?.run ?? "";
    const campos = /jq -r '\.\[\] \| \[([^\]]+)\] \| @tsv'/.exec(run)?.[1];
    expect(campos).toBe(".id, .titulo, .resumen, .detalle");
    const patron = /^\s*patron='([^']+)'$/m.exec(run)?.[1];
    expect(patron).toBeDefined();
    const lista = porVencer(await leerCoberturas(join(RAIZ, "data")), "2026-10-18");
    expect(lista.length).toBeGreaterThan(0);
    for (const c of lista) {
      for (const campo of ["id", "titulo", "resumen", "detalle"]) {
        expect(typeof c[campo as keyof typeof c], campo).toBe("string");
      }
      expect(c.titulo).toBe(`${PREFIJO_TITULO}${c.id}`);
      expect(c.titulo, c.id).toMatch(new RegExp(patron as string));
      // Un tabulador o un salto de línea romperían el renglón que lee el workflow.
      expect(`${c.resumen}${c.detalle}`, c.id).not.toMatch(/[\t\n]/);
    }
    for (const malo of [
      "Cobertura por vencer: ../x",
      "Cobertura por vencer: a b c",
      "Cobertura por vencer: $(x)",
      "Otra cosa: dias-inhabiles.sat general",
    ]) {
      expect(malo).not.toMatch(new RegExp(patron as string));
    }
  });
});

describe("revision-datos de ci.yml", () => {
  it("repite la revisión con el código de main, sin caché ni escritura, y verify la exige", async () => {
    const ci = await workflow("ci.yml");
    const job = ci.jobs["revision-datos"] as Job;
    expect(job.needs).toBe("solo-datos");
    expect(job.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(ci.jobs["solo-datos"]?.outputs).toEqual({
      es_bot: expresion("steps.bot.outputs.es_bot"),
    });
    const recalcular = paso(ci, "revision-datos", "Recalcular la revisión con el código de main");
    expect(recalcular.run).toContain("git archive --format=tar 'HEAD^1' data");
    expect(recalcular.run).toContain(`revisar --antes "\${antes}/data" || codigo=$?`);
    expect(recalcular.run).toContain(`echo "::stop-commands::\${pausa}"`);
    const exigir = paso(ci, "revision-datos", "Exigir la etiqueta revisar y una aprobación");
    expect(exigir.env?.GH_TOKEN).toBe(expresion("github.token"));
    expect(exigir.env?.CABEZA).toBe(expresion("github.event.pull_request.head.sha"));
    expect(exigir.run).not.toContain("$" + "{{");
    // Una aprobación del commit actual, de una persona (no Bot) con permiso de escritura.
    expect(exigir.run).toContain('.user.type != "Bot"');
    expect(exigir.run).toContain(".commit_id == $sha");
    expect(exigir.run).toContain("admin | maintain | write)");
    // Aprobar vuelve a correr CI, y solo-datos reconoce el PR del bot en ese evento.
    const on = (ci as unknown as { on: Record<string, unknown> }).on;
    expect(on.pull_request_review).toEqual({ types: ["submitted", "dismissed"] });
    const bot = paso(ci, "solo-datos", "Ver si el PR es del bot de datos");
    expect(bot.env?.RAMA).toBe(expresion("github.event.pull_request.head.ref"));
    expect(bot.run).toContain(`[ "\${EVENTO}" = "pull_request_review" ]`);
    const verify = ci.jobs.verify as Job & { needs: string[] };
    expect(verify.needs).toContain("revision-datos");
    expect(paso(ci, "verify", "Revisar los jobs requeridos").run).toContain(
      `"revision-datos=\${REVISION_DATOS}"`,
    );
  });

  it("ningún job de ci.yml usa la caché de pnpm", async () => {
    const ci = await workflow("ci.yml");
    for (const [nombre, job] of Object.entries(ci.jobs)) {
      for (const p of job.steps) {
        expect(p.with?.cache, `${nombre} ${p.uses}`).toBeUndefined();
      }
    }
  });
});

describe("publicar de datos.yml", () => {
  it("cada grupo tiene umbral de líneas y uno sobre el umbral no se fusiona solo", async () => {
    const datos = await workflow("datos.yml");
    const grupos = [
      ...(paso(datos, "preparar", "Resolver grupo de datos").run ?? "").matchAll(
        /^\s*([a-z]+)\) ids="/gm,
      ),
    ].map((g) => g[1]);
    const aplicar = paso(datos, "publicar", "Revisar y aplicar el parche");
    expect(aplicar.id).toBe("aplicar");
    const umbrales = [...(aplicar.run ?? "").matchAll(/^\s*([a-z]+)\) limite=(\d+) ;;$/gm)];
    expect(umbrales.map((u) => u[1])).toEqual(grupos);
    for (const [, , limite] of umbrales) expect(Number(limite)).toBeGreaterThan(0);
    const publicar = paso(datos, "publicar", "Publicar resultado");
    expect(publicar.env?.PARCHE_GRANDE).toBe(expresion("steps.aplicar.outputs.grande"));
    expect(publicar.run).toContain(
      `if [ "\${CODIGO}" = "3" ] || [ "\${PARCHE_GRANDE}" = "si" ] || [ -n "\${PARCHE_BINARIOS}" ]; then`,
    );
    expect(publicar.env?.PARCHE_BINARIOS).toBe(expresion("steps.aplicar.outputs.binarios"));
    expect(datos.jobs.publicar?.outputs?.publicado).toContain(
      "steps.aplicar.outputs.grande != 'si' && steps.aplicar.outputs.binarios == ''",
    );
    // Las líneas se cuentan en el índice, después de aplicar: un texto enviado como parche
    // binario cuenta igual. Solo el PDF de participantes puede ser binario sin pedir revisión.
    const run = aplicar.run ?? "";
    const aplicado = run.indexOf("git_o_falla apply --index");
    const conteo = run.indexOf("git -c core.attributesFile=/dev/null diff --cached --numstat -z");
    expect(aplicado).toBeGreaterThan(-1);
    expect(conteo).toBeGreaterThan(aplicado);
    expect(run).toContain(String.raw`^data/bancos/raw/[A-Za-z0-9._-]+\.pdf$`);
  });

  it("el resumen va en un bloque de código y los artefactos se leen solo si son archivos comunes", async () => {
    const datos = await workflow("datos.yml");
    const run = paso(datos, "publicar", "Publicar resultado").run ?? "";
    expect(funcion(run, "es_archivo")).toBe('es_archivo() {\n[ -f "$1" ] && [ ! -L "$1" ]\n}');
    expect(funcion(run, "resumen")).toContain(`if ! es_archivo "\${resumen_md}"; then`);
    expect(funcion(run, "resumen")).toContain(`echo "\${cerca}text"`);
    // El tope se mide después de agregar los espacios de ancho cero (3 bytes por @ o #N).
    const res = funcion(run, "resumen");
    const aSeguro = res.indexOf(`> "\${seguro}"`);
    expect(aSeguro).toBeGreaterThan(-1);
    expect(aSeguro).toBeLessThan(res.indexOf("-gt 60000"));
    expect(funcion(run, "motivos")).toContain(`if es_archivo "\${resumen_json}"; then`);
    expect(paso(datos, "publicar", "Revisar y aplicar el parche").run).toContain(
      `if [ ! -f "\${PARCHE}" ] || [ -L "\${PARCHE}" ]; then`,
    );
    expect(paso(datos, "estado-kv", "Escribir estado en KV").run).toContain(
      `if [ ! -f "\${RESUMEN}" ] || [ -L "\${RESUMEN}" ]; then`,
    );
  });
});

describe("issues de alerta", () => {
  it("cada búsqueda de un issue filtra por la cuenta que lo abre", async () => {
    const casos: [string, string][] = [
      ["datos.yml", `--author "app/\${APP_SLUG}"`],
      ["frescura.yml", "--author app/github-actions"],
    ];
    for (const [nombre, autor] of casos) {
      const wf = await workflow(nombre);
      const lineas = Object.values(wf.jobs)
        .flatMap((j) => j.steps)
        .flatMap((p) => (p.run ?? "").split("\n"))
        .filter((l) => l.includes("gh issue list"));
      expect(lineas.length, nombre).toBeGreaterThan(1);
      for (const l of lineas) expect(l, nombre).toContain(autor);
    }
  });
});

describe("estado-kv de datos.yml", () => {
  it("no corre si la corrida se canceló", async () => {
    const datos = await workflow("datos.yml");
    expect(datos.jobs["estado-kv"]?.if).toMatch(/^!cancelled\(\) && /);
  });

  // El token de despliegue puede publicar el Worker: estado-kv solo debe recibir el de KV.
  it("usa solo CLOUDFLARE_KV_TOKEN, sin el respaldo del token de despliegue", async () => {
    const datos = await workflow("datos.yml");
    const job = datos.jobs["estado-kv"] as Job;
    expect(JSON.stringify(job)).not.toContain("CLOUDFLARE_API_TOKEN ");
    expect(JSON.stringify(job)).not.toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(paso(datos, "estado-kv", "Escribir estado en KV").env?.CLOUDFLARE_API_TOKEN).toBe(
      expresion("secrets.CLOUDFLARE_KV_TOKEN"),
    );
    expect(paso(datos, "estado-kv", "Comprobar secretos de Cloudflare").env).toEqual({
      TIENE_CF: expresion(
        "secrets.CLOUDFLARE_KV_TOKEN != '' && secrets.CLOUDFLARE_ACCOUNT_ID != ''",
      ),
    });
  });
});

describe("publicacion.yml", () => {
  it("una corrida a la vez, instalación filtrada y el .tgz revisado antes de publicar", async () => {
    const wf = (await workflow("publicacion.yml")) as Workflow & {
      concurrency: { group: string; "cancel-in-progress": boolean };
    };
    expect(wf.concurrency).toEqual({ group: "publicacion", "cancel-in-progress": false });
    const instalar = paso(wf, "preparar", "Instalar dependencias");
    expect(instalar.env).toEqual({ NOMBRE: expresion("steps.revisar.outputs.nombre") });
    expect(instalar.run).toBe(`pnpm install --frozen-lockfile --filter "\${NOMBRE}..."`);
    const publicar = paso(wf, "publicar", "Publicar en npm con procedencia").run ?? "";
    expect(publicar).toContain(
      'for (const campo of ["scripts", "publishConfig", "bundleDependencies", "bundledDependencies"])',
    );
    expect(publicar).toContain(
      'for (const campo of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"])',
    );
    expect(publicar).toContain("if (!esRango(rango))");
    expect(publicar).toContain(
      "package/package.json | package/README.md | package/CHANGELOG.md | package/LICENSE) ;;",
    );
    expect(publicar).toContain("grep -qv '^-'");
    // Las revisiones van antes de publicar.
    expect(publicar.indexOf("rutas-tgz")).toBeLessThan(publicar.indexOf("npm publish"));
  });
});
