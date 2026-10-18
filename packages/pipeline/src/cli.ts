import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { esFechaIsoValida } from "@mexicoapi/core";
import { crearBancos, registrosDesdeHistorico } from "./datasets/bancos/bancos.js";
import type { Diferencias } from "./diferencias.js";
import { fechaEnMexico } from "./fecha.js";
import { capturarHistoricoCep } from "./historico.js";
import type { Cliente } from "./http.js";
import { type Contexto, ejecutarDataset, type ResultadoCorrida } from "./marco.js";
import { DATASETS } from "./registro.js";
import { resumenMarkdown } from "./resumen.js";
import { verificarDatos } from "./verificar.js";

export interface Entorno {
  cliente: Cliente;
  raizDatos: string;
  ahora: () => Date;
  escribir: (texto: string) => void;
  escribirError: (texto: string) => void;
}

interface ErrorDataset {
  dataset: string;
  mensaje: string;
}

const USO = `Uso:
  actualizar <id...> [--seco] [--fecha AAAA-MM-DD] [--resumen <ruta-sin-extension>] [--datos <ruta>]
  bancos-historico [--desde AAAA-MM] [--fecha AAAA-MM-DD] [--datos <ruta>]
  verificar [--datos <ruta>]
Datasets: ${[...DATASETS.keys()].join(", ")}
`;

function leer(argumentos: readonly string[]) {
  return parseArgs({
    args: [...argumentos],
    allowPositionals: true,
    options: {
      seco: { type: "boolean" },
      fecha: { type: "string" },
      resumen: { type: "string" },
      desde: { type: "string" },
      datos: { type: "string" },
    },
  });
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolverFecha(valor: string | undefined, entorno: Entorno): string | null {
  const fecha = valor ?? fechaEnMexico(entorno.ahora());
  return esFechaIsoValida(fecha) ? fecha : null;
}

async function escribirArchivo(ruta: string, texto: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, texto, "utf8");
}

async function actualizar(
  ids: readonly string[],
  valores: { seco?: boolean | undefined; fecha?: string | undefined; resumen?: string | undefined },
  entorno: Entorno,
  raizDatos: string,
): Promise<number> {
  if (ids.length === 0) {
    entorno.escribirError(`Falta al menos un dataset.\n${USO}`);
    return 1;
  }
  const desconocidos = ids.filter((id) => !DATASETS.has(id));
  if (desconocidos.length > 0) {
    entorno.escribirError(`Dataset desconocido: ${desconocidos.join(", ")}\n`);
    return 1;
  }
  const fecha = resolverFecha(valores.fecha, entorno);
  if (fecha === null) {
    entorno.escribirError(`Fecha inválida: ${valores.fecha}\n`);
    return 1;
  }
  const ctx: Contexto = { cliente: entorno.cliente, fecha, raizDatos };
  const resultados: ResultadoCorrida[] = [];
  const detalles = new Map<string, Diferencias<unknown>>();
  const errores: ErrorDataset[] = [];

  for (const id of ids) {
    const def = DATASETS.get(id);
    if (def === undefined) continue;
    try {
      const { resultado, diferencias } = await ejecutarDataset(def, ctx, {
        seco: valores.seco === true,
      });
      resultados.push(resultado);
      detalles.set(id, diferencias);
      entorno.escribir(
        `${id}: ${resultado.estado} (${resultado.registros} registros, +${resultado.altas} -${resultado.bajas} ~${resultado.cambios})\n`,
      );
    } catch (error) {
      const mensaje = mensajeDe(error);
      errores.push({ dataset: id, mensaje });
      entorno.escribirError(`${id}: ${mensaje}\n`);
    }
  }

  if (valores.resumen !== undefined) {
    let md = resumenMarkdown(resultados, detalles);
    if (errores.length > 0) {
      md += `\n## Errores\n\n${errores.map((e) => `- ${e.dataset}: ${e.mensaje}`).join("\n")}\n`;
    }
    await escribirArchivo(`${valores.resumen}.md`, md);
    await escribirArchivo(
      `${valores.resumen}.json`,
      `${JSON.stringify({ resultados, errores }, null, 2)}\n`,
    );
  }

  if (errores.length > 0) return 1;
  return resultados.some((r) => r.estado === "requiere_revision") ? 3 : 0;
}

async function bancosHistorico(
  valores: { desde?: string | undefined; fecha?: string | undefined },
  entorno: Entorno,
  raizDatos: string,
): Promise<number> {
  const fecha = resolverFecha(valores.fecha, entorno);
  if (fecha === null) {
    entorno.escribirError(`Fecha inválida: ${valores.fecha}\n`);
    return 1;
  }
  const existente = join(raizDatos, "bancos", "bancos.json");
  const yaExiste = await access(existente).then(
    () => true,
    () => false,
  );
  if (yaExiste) {
    entorno.escribirError(
      `bancos: ya existe ${existente}; el arranque histórico solo corre sin datos previos\n`,
    );
    return 1;
  }
  try {
    const historico = await capturarHistoricoCep(
      entorno.cliente,
      valores.desde ?? "2010-01",
      fecha,
      entorno.escribir,
    );
    const ctx: Contexto = { cliente: entorno.cliente, fecha, raizDatos };
    const { resultado } = await ejecutarDataset(crearBancos({ historico }), ctx, {
      anteriorInicial: registrosDesdeHistorico(historico),
    });
    entorno.escribir(`bancos: ${resultado.estado} (${resultado.registros} registros)\n`);
    return resultado.estado === "requiere_revision" ? 3 : 0;
  } catch (error) {
    entorno.escribirError(`bancos: ${mensajeDe(error)}\n`);
    return 1;
  }
}

export async function principal(argumentos: readonly string[], entorno: Entorno): Promise<number> {
  let parseado: ReturnType<typeof leer>;
  try {
    parseado = leer(argumentos);
  } catch (error) {
    entorno.escribirError(`${mensajeDe(error)}\n${USO}`);
    return 1;
  }
  const { values, positionals } = parseado;
  const [comando, ...resto] = positionals;
  const raizDatos = values.datos ?? entorno.raizDatos;

  switch (comando) {
    case "actualizar":
      return actualizar(resto, values, entorno, raizDatos);
    case "bancos-historico":
      return bancosHistorico(values, entorno, raizDatos);
    case "verificar": {
      const problemas = await verificarDatos(raizDatos);
      for (const p of problemas) entorno.escribirError(`${p}\n`);
      if (problemas.length === 0) entorno.escribir("datos: sin problemas\n");
      return problemas.length === 0 ? 0 : 1;
    }
    default:
      entorno.escribirError(`Comando desconocido o ausente.\n${USO}`);
      return 1;
  }
}
