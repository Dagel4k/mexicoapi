import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { leerCoberturas, PREFIJO_TITULO, porVencer } from "../src/coberturas.js";
import { CAPTURAS_PENDIENTES, interpretarIndiceDof, publicacionesPorCapturar } from "../src/dof.js";
import { DATASETS } from "../src/registro.js";
import { LLAVE_INDEXNOW } from "../src/sitio/indexacion.js";
import { leerFixture } from "./ayudas.js";

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
  on: {
    schedule?: { cron: string }[];
    workflow_dispatch: { inputs: { dataset: { options: string[] } } };
  };
  concurrency?: { group: string; "cancel-in-progress": boolean };
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

/**
 * Los crons del bot de datos, en UTC, con su grupo. La Ciudad de México está en UTC-6 todo el año:
 * lunes 05:47 (INEGI), 07:47 (bancos), 12:47 (FIX), 14:17 (UDIS) y 16:17 (respaldo del FIX).
 */
const CRONS: [string, string][] = [
  ["47 11 * * 1", "inegi"],
  ["47 13 * * *", "bancos"],
  ["47 18 * * *", "fix"],
  ["17 20 * * *", "udis"],
  ["17 22 * * *", "fix"],
];

/** Minutos desde las 00:00 UTC de un cron con minuto y hora fijos. */
const minutoDelDia = (cron: string): number => {
  const [minuto, hora] = cron.split(" ").map(Number);
  return (hora as number) * 60 + (minuto as number);
};

describe("horario de datos.yml", () => {
  it("fija los crons y cada uno lleva su grupo en la concurrencia y en preparar", async () => {
    const datos = await workflow("datos.yml");
    expect(datos.on.schedule?.map((s) => s.cron)).toEqual(CRONS.map(([cron]) => cron));
    const run = paso(datos, "preparar", "Resolver grupo de datos").run ?? "";
    const enPreparar = [...run.matchAll(/^\s*"([^"]+)"\) grupo="([a-z]+)" ;;/gm)];
    expect(enPreparar.map(([, cron, grupo]) => [cron, grupo])).toEqual(CRONS);
    // Un cron que no está en la lista detiene la corrida en lugar de caer en un grupo.
    expect(run).toMatch(/^\s*\*\) echo "Cron sin grupo: \$\{CRON\}" >&2; exit 1 ;;$/m);
    const grupo = datos.concurrency?.group ?? "";
    const enConcurrencia = [
      ...grupo.matchAll(/github\.event\.schedule == '([^']+)' && '([a-z]+)'/g),
    ];
    expect(enConcurrencia.map(([, cron, g]) => [cron, g])).toEqual(CRONS);
    expect(grupo.startsWith("datos-${{ github.event.inputs.dataset || ")).toBe(true);
  });

  it("ningún cron cae en un cuarto de hora y FIX y UDIS van a una hora o más entre sí", async () => {
    // GitHub retrasa más las corridas programadas al inicio de cada hora.
    for (const [cron] of CRONS) expect(minutoDelDia(cron) % 15, cron).not.toBe(0);
    // La rama de un PR tiene que estar al día con main: dos PRs casi a la vez se estorban.
    const diarios = CRONS.filter(([, g]) => g === "fix" || g === "udis").map(([c]) => c);
    const minutos = diarios.map(minutoDelDia).sort((a, b) => a - b);
    for (let i = 1; i < minutos.length; i++) {
      expect((minutos[i] as number) - (minutos[i - 1] as number)).toBeGreaterThanOrEqual(60);
    }
    // El respaldo del FIX va unas horas después de la primera corrida.
    const [primera, respaldo] = CRONS.filter(([, g]) => g === "fix").map(([c]) => minutoDelDia(c));
    expect((respaldo as number) - (primera as number)).toBeGreaterThanOrEqual(180);
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

describe("horario de frescura.yml", () => {
  it("corre a diario a partir de las 13:13 de la Ciudad de México, fuera de los cuartos de hora", async () => {
    const frescura = await workflow("frescura.yml");
    expect(frescura.on.schedule?.map((s) => s.cron)).toEqual(["13 19 * * *"]);
    for (const s of frescura.on.schedule ?? []) {
      expect(minutoDelDia(s.cron) % 15, s.cron).not.toBe(0);
    }
  });
});

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

describe("vigía del DOF en frescura.yml", () => {
  it("dof corre el pipeline sin poder escribir, con la fecha de la Ciudad de México", async () => {
    const frescura = await workflow("frescura.yml");
    const job = frescura.jobs.dof as Job;
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(job.outputs).toEqual({
      lista: expresion("steps.buscar.outputs.lista"),
      otra_forma: expresion("steps.buscar.outputs.otra_forma"),
    });
    // Las mismas acciones fijadas por SHA que la alerta de coberturas.
    const usos = (j: Job | undefined) => (j?.steps ?? []).flatMap((p) => p.uses ?? []);
    expect(usos(job)).toEqual(usos(frescura.jobs.coberturas));
    expect(job.steps[0]?.with).toMatchObject({ "persist-credentials": false });
    const buscar = job.steps.find((p) => p.id === "buscar");
    expect(buscar?.env).toBeUndefined();
    const run = buscar?.run ?? "";
    // Sin --fecha: el comando toma la de la Ciudad de México.
    const comando = run.indexOf(
      `node packages/pipeline/dist/bin.js dof --json > "\${salida}" || codigo=$?`,
    );
    expect(comando).toBeGreaterThan(-1);
    // Mientras corre el CLI, que puede imprimir textos del SIDOF en sus errores, el runner no
    // interpreta comandos de workflow.
    expect(run.indexOf(`echo "::stop-commands::\${pausa}"`)).toBeLessThan(comando);
    expect(run.indexOf(`echo "::\${pausa}::"`)).toBeGreaterThan(comando);
    // Solo un error del comando deja el paso en rojo. Un índice que el SIDOF no respondió, o que
    // respondió con otra forma, deja un aviso y el paso sigue en verde; las fechas con otra forma
    // salen en otra_forma para el issue de avisar-dof.
    expect(run).toContain(`if [ "\${codigo}" -ne 0 ]; then`);
    expect(run.match(/\bexit 1\b/g)?.length).toBe(3);
    expect(run).toContain("jq -r '.indices[] | [.fecha, .estado] | @tsv'");
    expect(run).toMatch(/sin_respuesta\) echo "::warning::/);
    expect(run).toContain(`otra_forma="\${otra_forma:+\${otra_forma} }\${fecha}"`);
    expect(run).toContain(`echo "otra_forma=\${otra_forma}"`);
    // La forma de la lista de índices se revisa antes del bucle.
    expect(run.indexOf('jq -e \'.indices | type == "array"')).toBeLessThan(
      run.indexOf("while IFS="),
    );
    expect(run).toContain(
      `lista="$(jq -ce '.publicaciones | if type == "array" then . else error("no es un arreglo") end' "\${salida}")"`,
    );
  });

  it("avisar-dof solo escribe issues, no instala nada y nunca reabre ni comenta", async () => {
    const frescura = await workflow("frescura.yml");
    const job = frescura.jobs["avisar-dof"] as Job;
    expect(job.needs).toBe("dof");
    expect(job.if).toBe(
      "github.ref == 'refs/heads/main' && (needs.dof.outputs.lista != '[]' || needs.dof.outputs.otra_forma != '')",
    );
    expect(job.permissions).toEqual({ issues: "write" });
    expect(job.steps.flatMap((p) => p.uses ?? [])).toEqual([]);
    const [unico] = job.steps;
    expect(job.steps).toHaveLength(1);
    expect(unico?.env).toEqual({
      LISTA: expresion("needs.dof.outputs.lista"),
      OTRA_FORMA: expresion("needs.dof.outputs.otra_forma"),
      GH_TOKEN: expresion("github.token"),
      GH_REPO: expresion("github.repository"),
    });
    for (const nombre of ["dof", "avisar-dof"]) {
      for (const p of frescura.jobs[nombre]?.steps ?? []) {
        expect(p.run ?? "", `${nombre} ${p.name}`).not.toContain("$" + "{{");
      }
    }
    const run = unico?.run ?? "";
    // Busca por título exacto y autor, también entre los cerrados: un aviso que alguien cerró no
    // se vuelve a abrir.
    expect(funcion(run, "buscar_cualquiera")).toContain(
      "gh issue list --state all --limit 100 --author app/github-actions",
    );
    expect(run).not.toMatch(/gh issue (close|comment|edit|reopen)/);
    expect(run).toContain("blob/main/docs/operacion/datos-curados.md");
    // Si el SIDOF respondió con otra forma, un solo issue abierto a la vez, buscado igual que los
    // de la revisión de frescura: si alguien lo cierra y vuelve a pasar, se abre otro.
    const revisar = paso(frescura, "revisar", "Revisar frescura de los datos").run ?? "";
    expect(funcion(run, "buscar_abierto")).toBe(funcion(revisar, "buscar_abierto"));
    expect(run).toContain('titulo_forma="Vigía del DOF: el SIDOF respondió con otra forma"');
    expect(run).toContain(`if ! numero="$(buscar_abierto "\${titulo_forma}")"; then`);
    expect(run).toContain(
      `if ! [[ "\${OTRA_FORMA}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}( [0-9]{4}-[0-9]{2}-[0-9]{2})?$ ]]; then`,
    );
    // La forma de la lista se revisa antes del bucle, y cada publicación dentro de él.
    const guardia = run.indexOf('jq -e \'type == "array"');
    expect(guardia).toBeGreaterThan(-1);
    expect(guardia).toBeLessThan(run.indexOf("while IFS="));
    expect(run).toContain(
      `[ "\${url}" != "https://sidof.segob.gob.mx/notas/docFuente/\${codigo}" ]`,
    );
    // El título de la nota viene del SIDOF: va en un bloque de código, sin acentos graves.
    expect(run).toContain("echo '```text'");
    expect(run).toContain('gsub("`+"; "\\u0027")');
  });

  it("lee los campos que da el comando y acepta el título de cada publicación", async () => {
    const frescura = await workflow("frescura.yml");
    const run = frescura.jobs["avisar-dof"]?.steps[0]?.run ?? "";
    const campos = /jq -r '\.\[\] \| \[([^\]]+?)\] \| @tsv'/.exec(run)?.[1];
    expect(campos).toBe('.codigo, .titulo, .edicion, .fecha, .url, (.archivos | join(", "))');
    const patron = /^\s*patron='([^']+)'$/m.exec(run)?.[1];
    const archivos = /^\s*patron_archivos='([^']+)'$/m.exec(run)?.[1];
    expect(patron).toBeDefined();
    expect(archivos).toBeDefined();
    const notas = interpretarIndiceDof(
      await leerFixture("sidof/notas-17-12-2025.json"),
      "2025-12-17",
    );
    const lista = publicacionesPorCapturar(
      [
        ...notas,
        ...CAPTURAS_PENDIENTES.map((c, i) => ({
          codigo: String(i + 1),
          titulo: c.texto,
          edicion: "matutina" as const,
        })),
      ],
      "2025-12-17",
    );
    expect(lista).toHaveLength(CAPTURAS_PENDIENTES.length + 1);
    for (const p of lista) {
      expect(p.titulo, p.codigo).toMatch(new RegExp(patron as string));
      expect(p.archivos.join(", "), p.codigo).toMatch(new RegExp(archivos as string));
      expect(p.url).toBe(`https://sidof.segob.gob.mx/notas/docFuente/${p.codigo}`);
    }
    for (const malo of [
      "Publicación en el DOF: 5776445",
      "Publicación en el DOF: 5776445 (rmf) x",
      "Publicación en el DOF: $(x) (rmf)",
      "Publicación en el DOF: 5776445 (RMF)",
      "Cobertura por vencer: constantes.uma",
    ]) {
      expect(malo).not.toMatch(new RegExp(patron as string));
    }
    expect("data/curado/../x.yaml").not.toMatch(new RegExp(archivos as string));
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
    // Sin pull_request_review: en ese evento el emisor es quien revisa (una revisión de una
    // cuenta Bot marcaría como del bot el PR de una persona) y cualquiera podría correr CI con
    // un comentario. Después de aprobar se usa "Re-run failed jobs" en la corrida original.
    const on = (ci as unknown as { on: Record<string, unknown> }).on;
    expect(Object.keys(on).sort()).toEqual(["pull_request", "push"]);
    const bot = paso(ci, "solo-datos", "Ver si el PR es del bot de datos");
    expect(bot.env?.RAMA).toBe(expresion("github.head_ref"));
    expect(bot.run).toContain(`if [ "\${EVENTO}" = "pull_request" ]; then`);
    expect(bot.run).not.toContain("pull_request_review");
    expect(exigir.run).toContain("Re-run failed jobs");
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
    // En líneas y en bytes: un JSON de una sola línea cambia pocas líneas y muchos bytes.
    const umbrales = [
      ...(aplicar.run ?? "").matchAll(/^\s*([a-z]+)\) limite=(\d+); limite_bytes=(\d+) ;;$/gm),
    ];
    expect(umbrales.map((u) => u[1])).toEqual(grupos);
    // Los valores exactos: un cambio en un umbral apaga esta barrera sin que nada más lo note. El
    // margen de cada uno está en el comentario del paso y en docs/operacion/bot-de-datos.md.
    expect(Object.fromEntries(umbrales.map(([, g, l, b]) => [g, [Number(l), Number(b)]]))).toEqual({
      inegi: [400, 2097152],
      bancos: [300, 262144],
      fix: [300, 262144],
      udis: [400, 262144],
    });
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
    // Solo la ruta exacta que escribe el pipeline, y con un tope de bytes.
    expect(run).toContain('pdf="data/bancos/raw/participantes-spei.pdf"');
    expect(run).toContain("tope_pdf=5242880");
    // Pide revisión si pasa cualquiera de los dos, las líneas o los bytes.
    expect(run).toContain(
      `if [ "\${lineas}" -gt "\${limite}" ] || [ "\${bytes}" -gt "\${limite_bytes}" ]; then`,
    );
  });

  // La corrida de respaldo del FIX, o una que GitHub atrasó, puede partir de un main anterior a la
  // última publicación: con los mismos registros no abre otro PR ni comenta en el que ya está.
  it("no publica los registros que main o el PR abierto del grupo ya tienen", async () => {
    const datos = await workflow("datos.yml");
    const publicar = paso(datos, "publicar", "Publicar resultado");
    expect(publicar.env?.CARPETAS).toBe(expresion("needs.preparar.outputs.carpetas"));
    const run = publicar.run ?? "";
    // Solo los registros de las carpetas del grupo: el manifiesto y los crudos cambian con la hora
    // de la descarga aunque los datos sean los mismos.
    const sinNovedad = funcion(run, "sin_novedad");
    expect(sinNovedad).toContain(`read -r -a grupo_carpetas <<< "\${CARPETAS}"`);
    expect(sinNovedad).toContain(
      `rutas+=("data/\${carpeta}" ":(exclude)data/\${carpeta}/manifest.json" ":(exclude)data/\${carpeta}/raw")`,
    );
    expect(sinNovedad).toContain(`git diff --cached --quiet "$1" -- "\${rutas[@]}"`);
    // Primero contra main, después de ver que hay cambios y antes de buscar el PR abierto.
    const contraMain = run.indexOf(
      "if git fetch -q --no-tags --depth=1 origin main && sin_novedad FETCH_HEAD; then",
    );
    expect(contraMain).toBeGreaterThan(run.indexOf("if git diff --cached --quiet -- data/; then"));
    expect(contraMain).toBeLessThan(run.indexOf('pr_pendiente="$('));
    expect(run.indexOf("gh auth setup-git")).toBeLessThan(contraMain);
    // Después contra el PR abierto, antes de comentar en él.
    const contraPr = run.indexOf(
      `git fetch -q --no-tags --depth=1 origin "refs/pull/\${numero_pr}/head"`,
    );
    expect(contraPr).toBeGreaterThan(run.indexOf('pr_pendiente="$('));
    expect(contraPr).toBeLessThan(run.indexOf(`gh pr comment "\${pr_pendiente}"`));
    expect(run).toContain(`if [[ "\${numero_pr}" =~ ^[0-9]+$ ]]`);
    // Con los mismos registros solo se calla el comentario y el issue de revisión: el aviso de
    // PR atascado (48 horas o CI en rojo) corre siempre, así que no hay un exit antes de él.
    const atasco = run.indexOf(`gh pr view "\${pr_pendiente}" --json createdAt,statusCheckRollup`);
    expect(atasco).toBeGreaterThan(contraPr);
    expect(run.slice(contraPr, atasco)).not.toMatch(/\bexit\b/);
    expect(run).toContain(`mismo=si`);
    const comentario = run.indexOf(`gh pr comment "\${pr_pendiente}"`);
    expect(run.lastIndexOf(`if [ "\${mismo}" = "no" ]; then`, comentario)).toBeGreaterThan(
      contraPr,
    );
    expect(run).toContain(`if [ "\${pide_revision}" = "si" ] && [ "\${mismo}" = "no" ]; then`);
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

type JobRegistro = Omit<Job, "needs"> & {
  needs: string[];
  environment?: unknown;
  env?: Record<string, string>;
};

/** El filtro de jq con que se revisa server.json, del bloque run de un paso. */
const filtroServerJson = (run: string): string | undefined =>
  /jq -e --arg v "\$\{VERSION\}" '([^']+)' packages\/mcp\/server\.json/.exec(run)?.[1];

describe("registro oficial de MCP en publicacion.yml", () => {
  it("registro-mcp corre solo con mexicoapi-mcp@*, después de npm y sin el Environment npm", async () => {
    const wf = await workflow("publicacion.yml");
    const job = wf.jobs["registro-mcp"] as unknown as JobRegistro;
    expect(job.needs).toEqual(["preparar", "publicar"]);
    expect(job.if).toBe(
      "startsWith(github.event.release.tag_name, 'mexicoapi-mcp@') && needs.publicar.result == 'success'",
    );
    // id-token para el OIDC del registro, sin el Environment npm: su token no publica en npm.
    expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(job.environment).toBeUndefined();
    expect(JSON.stringify(job)).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/);
    // Solo el checkout, con la misma acción fijada por SHA que preparar: curl y jq son del runner.
    const usos = job.steps.flatMap((p) => p.uses ?? []);
    expect(usos).toEqual([expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/)]);
    expect(wf.jobs.preparar?.steps.flatMap((p) => p.uses ?? [])).toEqual(
      expect.arrayContaining(usos),
    );
    expect(job.steps[0]?.with).toEqual({ "persist-credentials": false });
    // En este orden: revisa server.json, espera a npm, entra con OIDC y publica.
    expect(job.steps.map((p) => p.name ?? p.uses?.split("@")[0])).toEqual([
      "actions/checkout",
      "Revisar server.json",
      "Instalar mcp-publisher",
      "Esperar la versión en npm",
      "Entrar al registro con OIDC",
      "Publicar en el registro de MCP",
      "Explicar el fallo",
    ]);
    // Nada se interpola en los scripts: todo llega por env.
    for (const p of job.steps) expect(p.run ?? "", p.name).not.toContain("$" + "{{");
  });

  it("cada paso que usa la red tiene su tope y el del job deja correr la explicación", async () => {
    const wf = await workflow("publicacion.yml");
    const job = wf.jobs["registro-mcp"] as unknown as JobRegistro & { "timeout-minutes": number };
    const topes: Record<string, number> = Object.fromEntries(
      job.steps.flatMap((p): [string, number][] => {
        const tope = (p as Paso & { "timeout-minutes"?: number })["timeout-minutes"];
        return tope === undefined ? [] : [[p.name ?? "", tope]];
      }),
    );
    expect(topes).toEqual({
      "Instalar mcp-publisher": 3,
      "Esperar la versión en npm": 12,
      "Entrar al registro con OIDC": 2,
      "Publicar en el registro de MCP": 3,
    });
    // Si un paso se cuelga, falla por su tope y no por el del job: Explicar el fallo sí corre.
    const suma = Object.values(topes).reduce((a, b) => a + b, 0);
    expect(job["timeout-minutes"]).toBeGreaterThanOrEqual(suma + 5);
  });

  it("baja mcp-publisher en una versión fija y revisa su sha256 antes de extraerlo", async () => {
    const wf = await workflow("publicacion.yml");
    const job = wf.jobs["registro-mcp"] as unknown as JobRegistro;
    // De registry_1.8.1_checksums.txt del release v1.8.1 de modelcontextprotocol/registry.
    expect(job.env).toEqual({
      MCP_PUBLISHER_VERSION: "1.8.1",
      MCP_PUBLISHER_SHA256: "a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc",
    });
    const run = paso(wf, "registro-mcp", "Instalar mcp-publisher").run ?? "";
    expect(run).toContain(
      `base="https://github.com/modelcontextprotocol/registry/releases/download/v\${MCP_PUBLISHER_VERSION}"`,
    );
    expect(run).toContain('tarball="mcp-publisher_linux_amd64.tar.gz"');
    expect(run).not.toContain("latest");
    // Nada pasa de curl a otro programa: primero se guarda y se revisa.
    expect(run).not.toMatch(/curl[^\n]*\|/);
    const descarga = run.indexOf(`curl -fsSL -o "\${dir}/\${tarball}" "\${base}/\${tarball}"`);
    const revision = run.indexOf(
      `echo "\${MCP_PUBLISHER_SHA256}  \${dir}/\${tarball}" | sha256sum -c -`,
    );
    const extraccion = run.indexOf("tar -xzf");
    expect(descarga).toBeGreaterThan(-1);
    expect(revision).toBeGreaterThan(descarga);
    expect(extraccion).toBeGreaterThan(revision);
    expect(run.startsWith("set -euo pipefail\n")).toBe(true);
  });

  it("espera a que npm muestre la versión con su mcpName, con un tope, y publica server.json", async () => {
    const wf = await workflow("publicacion.yml");
    const esperar = paso(wf, "registro-mcp", "Esperar la versión en npm");
    expect(esperar.env).toEqual({ VERSION: expresion("needs.preparar.outputs.version") });
    const run = esperar.run ?? "";
    // El mismo documento que lee el registro para validar el paquete, hasta 40 veces cada 15
    // segundos (10 minutos), sin esperar después del último intento.
    expect(run).toContain(`url="https://registry.npmjs.org/mexicoapi-mcp/\${VERSION}"`);
    expect(run).toContain(`if curl -fsS --max-time 30 -o "\${manifiesto}" "\${url}"; then`);
    expect(run).not.toContain("npm view");
    expect(run).toContain("for intento in $(seq 1 40); do");
    expect(run).toContain(`if [ "\${intento}" -lt 40 ]; then`);
    expect(run.indexOf("sleep 15")).toBeGreaterThan(
      run.indexOf(`if [ "\${intento}" -lt 40 ]; then`),
    );
    // Con un mcpName distinto, el registro lo rechazaría: se detiene ahí, sin reintentar.
    const revision = run.indexOf(
      `if ! jq -e '.mcpName == "io.github.Dagel4k/mexicoapi-mcp"' "\${manifiesto}" > /dev/null; then`,
    );
    expect(revision).toBeGreaterThan(run.indexOf("if curl -fsS"));
    expect(run.slice(revision)).toMatch(
      /^[^\n]*\n\s*echo "::error::[^"]*mcpName[^"]*"\n\s*exit 1\n/,
    );
    expect(run).toMatch(/echo "::error::[^"]*no aparece en npm/);
    expect(run.trimEnd().endsWith("exit 1")).toBe(true);
    expect(paso(wf, "registro-mcp", "Entrar al registro con OIDC").run).toBe(
      "mcp-publisher login github-oidc",
    );
    const publicar = paso(wf, "registro-mcp", "Publicar en el registro de MCP").run ?? "";
    expect(publicar).toContain("mcp-publisher publish packages/mcp/server.json");
    expect(publicar).toContain(`>> "\${GITHUB_STEP_SUMMARY}"`);
    // Si algo falla, el job queda en rojo y dice que npm ya publicó la versión.
    const fallo = paso(wf, "registro-mcp", "Explicar el fallo") as Paso & { if?: string };
    expect(fallo.if).toBe("failure()");
    expect(fallo.run).toMatch(/echo "::error::mexicoapi-mcp@\$\{VERSION\} ya está en npm/);
    expect(fallo.run).toContain("docs/operacion/publicacion-npm.md");
    expect(fallo.run).toContain(`>> "\${GITHUB_STEP_SUMMARY}"`);
    for (const p of wf.jobs["registro-mcp"]?.steps ?? []) {
      expect((p as Paso & { "continue-on-error"?: unknown })["continue-on-error"]).toBeUndefined();
    }
  });

  it("preparar y registro-mcp revisan que server.json traiga la versión del Release", async () => {
    const wf = await workflow("publicacion.yml");
    const enPreparar = paso(wf, "preparar", "Revisar server.json") as Paso & { if?: string };
    expect(enPreparar.if).toBe("steps.revisar.outputs.nombre == 'mexicoapi-mcp'");
    expect(enPreparar.env).toEqual({ VERSION: expresion("steps.revisar.outputs.version") });
    // En preparar, antes de consultar npm: si no coincide, no se publica nada.
    const nombres = wf.jobs.preparar?.steps.map((p) => p.name) ?? [];
    expect(nombres.indexOf("Revisar server.json")).toBe(
      nombres.indexOf("Revisar la etiqueta, el package.json y el CHANGELOG.md") + 1,
    );
    const enRegistro = paso(wf, "registro-mcp", "Revisar server.json");
    expect(enRegistro.env).toEqual({ VERSION: expresion("needs.preparar.outputs.version") });
    const filtro = filtroServerJson(enPreparar.run ?? "");
    expect(filtro).toBe(
      '.version == $v and (.packages | length) == 1 and .packages[0].version == $v and .packages[0].identifier == "mexicoapi-mcp"',
    );
    expect(filtroServerJson(enRegistro.run ?? "")).toBe(filtro);
    for (const run of [enPreparar.run ?? "", enRegistro.run ?? ""]) {
      expect(run).toMatch(/echo "::error::packages\/mcp\/server\.json no trae la versión/);
    }
    // registro-mcp lee el server.json del commit del Release, el que revisó preparar.
    expect(enRegistro.run).toContain(`if [ "$(git rev-parse HEAD)" != "\${GITHUB_SHA}" ]; then`);
  });
});

describe("aviso a IndexNow en despliegue.yml", () => {
  it("solo en producción, después del humo, sin romper el despliegue y con la llave del sitio", async () => {
    const wf = await workflow("despliegue.yml");
    const pasos = wf.jobs.desplegar?.steps ?? [];
    const nombres = pasos.map((p) => p.name);
    const indexnow = paso(wf, "desplegar", "Avisar a IndexNow") as Paso & {
      "continue-on-error"?: boolean;
      "timeout-minutes"?: number;
      if?: string;
    };
    expect(nombres.indexOf("Avisar a IndexNow")).toBeGreaterThan(
      nombres.indexOf("Prueba de humo en producción"),
    );
    expect(indexnow.if).toContain("steps.humo_prod.outputs.ok == 'true'");
    expect(indexnow["continue-on-error"]).toBe(true);
    expect(indexnow["timeout-minutes"]).toBe(3);
    expect(indexnow.env?.LLAVE_INDEXNOW).toBe(LLAVE_INDEXNOW);
    expect(indexnow.env?.URL_PROD).toBe(expresion("steps.conf_prod.outputs.url"));
    const run = indexnow.run ?? "";
    expect(run).not.toContain("${{");
    expect(run).toContain("https://api.indexnow.org/indexnow");
    expect(run).toContain("curl -fsS --max-time 30");
    expect(run).toContain("head -n 10000");
    expect(run).toContain("keyLocation");
    // Es el único paso que avisa, y no toca staging.
    expect(pasos.filter((p) => (p.run ?? "").includes("api.indexnow.org"))).toHaveLength(1);
    expect(run).not.toContain("URL_STAGING");
  });
});
