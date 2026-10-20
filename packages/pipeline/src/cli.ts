import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { esFechaIsoValida } from "@mexicoapi/core";
import { coberturasEnTexto, leerCoberturas, porVencer } from "./coberturas.js";
import { curarDatos } from "./curado/curar.js";
import { CURADOS, DIRECTORIO_CURADO } from "./curado/registro.js";
import { crearBancos, HOSTS_BANCOS, registrosDesdeHistorico } from "./datasets/bancos/bancos.js";
import type { Diferencias } from "./diferencias.js";
import { dofEnTexto, HOST_SIDOF, revisarDof } from "./dof.js";
import { fechaEnMexico } from "./fecha.js";
import { capturarHistoricoCep } from "./historico.js";
import type { Cliente } from "./http.js";
import {
  type Contexto,
  ejecutarDataset,
  type ResultadoCorrida,
  restringirCliente,
} from "./marco.js";
import { DATASETS } from "./registro.js";
import { type ErrorDeDataset, resumenMarkdown } from "./resumen.js";
import { type ResultadoRevision, revisarDataset } from "./revision.js";
import { construirSitio } from "./sitio/construir.js";
import { verificarDatos } from "./verificar.js";

export interface Entorno {
  crearCliente: (intervaloMinimoMs: number) => Cliente;
  raizDatos: string;
  ahora: () => Date;
  escribir: (texto: string) => void;
  escribirError: (texto: string) => void;
}

const USO = `Uso:
  actualizar <id...> [--seco] [--fecha AAAA-MM-DD] [--resumen <ruta-sin-extension>] [--datos <ruta>]
  bancos-historico [--desde AAAA-MM] [--fecha AAAA-MM-DD] [--intervalo <segundos, entero >= 1, 30 por omisión>] [--datos <ruta>]
  verificar [--datos <ruta>]
  revisar --antes <ruta> [--datos <ruta>] [--fecha AAAA-MM-DD]
  curar [--datos <ruta>]
  construir --salida <ruta> [--datos <ruta>]
  coberturas [--dias <entero >= 0>] [--fecha AAAA-MM-DD] [--json] [--datos <ruta>]
  dof [--fecha AAAA-MM-DD] [--json]
Datasets: ${[...DATASETS.keys()].join(", ")}
Curados (data/curado/*.yaml): ${CURADOS.map((d) => d.id).join(", ")}
`;

const OPCIONES_POR_COMANDO: Record<string, readonly string[]> = {
  actualizar: ["seco", "fecha", "resumen", "datos"],
  "bancos-historico": ["desde", "fecha", "intervalo", "datos"],
  verificar: ["datos"],
  revisar: ["antes", "datos", "fecha"],
  curar: ["datos"],
  construir: ["salida", "datos"],
  coberturas: ["dias", "fecha", "json", "datos"],
  dof: ["fecha", "json"],
};

function leer(argumentos: readonly string[]) {
  return parseArgs({
    args: [...argumentos],
    allowPositionals: true,
    options: {
      seco: { type: "boolean" },
      fecha: { type: "string" },
      resumen: { type: "string" },
      desde: { type: "string" },
      intervalo: { type: "string" },
      datos: { type: "string" },
      antes: { type: "string" },
      salida: { type: "string" },
      dias: { type: "string" },
      json: { type: "boolean" },
    },
  });
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Meses AAAA-MM de `desde` a `hasta`, ambos incluidos. */
function mesesEntre(desde: string, hasta: string): string[] {
  const meses: string[] = [];
  let anio = Number(desde.slice(0, 4));
  let mes = Number(desde.slice(5, 7));
  let actual = desde;
  while (actual <= hasta) {
    meses.push(actual);
    if (mes === 12) {
      anio++;
      mes = 1;
    } else {
      mes++;
    }
    actual = `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}`;
  }
  return meses;
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
  const ctx: Contexto = { cliente: entorno.crearCliente(1000), fecha, raizDatos };
  const resultados: ResultadoCorrida[] = [];
  const detalles = new Map<string, Diferencias<unknown>>();
  const errores: ErrorDeDataset[] = [];

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
      if (resultado.estado === "requiere_revision") {
        for (const motivo of resultado.motivos) entorno.escribir(`  - ${motivo}\n`);
      }
    } catch (error) {
      const mensaje = mensajeDe(error);
      errores.push({ dataset: id, mensaje });
      entorno.escribirError(`${id}: ${mensaje}\n`);
    }
  }

  if (valores.resumen !== undefined) {
    await escribirArchivo(`${valores.resumen}.md`, resumenMarkdown(resultados, detalles, errores));
    await escribirArchivo(
      `${valores.resumen}.json`,
      `${JSON.stringify({ resultados, errores }, null, 2)}\n`,
    );
  }

  if (errores.length > 0) return 1;
  return resultados.some((r) => r.estado === "requiere_revision") ? 3 : 0;
}

async function bancosHistorico(
  valores: {
    desde?: string | undefined;
    fecha?: string | undefined;
    intervalo?: string | undefined;
  },
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
  const desde = valores.desde ?? "2010-01";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(desde)) {
    entorno.escribirError(`Mes inválido: ${desde} (se espera AAAA-MM)\n`);
    return 1;
  }
  if (desde > fecha.slice(0, 7)) {
    entorno.escribirError(`--desde (${desde}) es posterior al mes de ${fecha}\n`);
    return 1;
  }
  const intervalo = valores.intervalo ?? "30";
  if (!/^\d+$/.test(intervalo) || Number(intervalo) < 1) {
    entorno.escribirError(`--intervalo inválido: ${intervalo} (entero >= 1)\n${USO}`);
    return 1;
  }
  const segundos = Number(intervalo);
  const meses = mesesEntre(desde, fecha.slice(0, 7));
  entorno.escribir(
    `bancos: ${meses.length} meses, un pedido cada ${segundos} s; duración estimada: ${Math.ceil((meses.length * segundos) / 60)} min\n`,
  );
  const cliente = restringirCliente(entorno.crearCliente(segundos * 1000), HOSTS_BANCOS);
  try {
    const historico = await capturarHistoricoCep(cliente, desde, fecha, entorno.escribir);
    const omitidos = meses.filter((mes) => !historico.some((o) => o.fecha.startsWith(mes)));
    for (const mes of omitidos) {
      entorno.escribirError(`bancos: sin datos del CEP en ${mes}; el historial queda con hueco\n`);
    }
    const ctx: Contexto = { cliente, fecha, raizDatos };
    const { resultado } = await ejecutarDataset(crearBancos({ historico }), ctx, {
      anteriorInicial: registrosDesdeHistorico(historico),
    });
    entorno.escribir(`bancos: ${resultado.estado} (${resultado.registros} registros)\n`);
    if (resultado.estado === "requiere_revision") {
      for (const motivo of resultado.motivos) entorno.escribir(`  - ${motivo}\n`);
    }
    return resultado.estado === "requiere_revision" || omitidos.length > 0 ? 3 : 0;
  } catch (error) {
    entorno.escribirError(`bancos: ${mensajeDe(error)}\n`);
    return 1;
  }
}

/**
 * Compara los datos de `--antes` (main) con los de `--datos` (un PR del bot) y decide, con las
 * reglas de `actualizar` y las fuentes que arma el código para cada manifiesto, si los cambios
 * piden revisión: 0 si ninguno la pide, 3 si alguno sí y 1 si un snapshot o un manifiesto nuevo no
 * se puede leer o no es válido.
 */
async function revisar(
  valores: { antes?: string | undefined; fecha?: string | undefined },
  entorno: Entorno,
  raizDatos: string,
): Promise<number> {
  if (valores.antes === undefined) {
    entorno.escribirError(`Falta --antes.
${USO}`);
    return 1;
  }
  const fecha = resolverFecha(valores.fecha, entorno);
  if (fecha === null) {
    entorno.escribirError(`Fecha inválida: ${valores.fecha}
`);
    return 1;
  }
  const resultados: ResultadoRevision[] = [];
  let errores = 0;
  for (const def of DATASETS.values()) {
    try {
      const r = await revisarDataset(def, valores.antes, raizDatos, fecha);
      resultados.push(r);
      entorno.escribir(`${r.dataset}: ${r.estado} (+${r.altas} -${r.bajas} ~${r.cambios})
`);
      for (const motivo of r.motivos)
        entorno.escribir(`  - ${motivo}
`);
    } catch (error) {
      errores++;
      entorno.escribirError(`${def.id}: ${mensajeDe(error)}
`);
    }
  }
  if (errores > 0) return 1;
  return resultados.some((r) => r.estado === "requiere_revision") ? 3 : 0;
}

/**
 * Las coberturas de los datos curados y los días que faltan para que terminen; con `--dias`, solo
 * las que terminan en ese plazo o ya terminaron. Con `--json`, la lista que usa la alerta de
 * frescura.yml.
 */
async function coberturas(
  valores: { dias?: string | undefined; fecha?: string | undefined; json?: boolean | undefined },
  entorno: Entorno,
  raizDatos: string,
): Promise<number> {
  const { dias } = valores;
  if (dias !== undefined && !/^(?:0|[1-9]\d{0,4})$/.test(dias)) {
    entorno.escribirError(`--dias inválido: ${dias} (entero de 0 a 99999)\n${USO}`);
    return 1;
  }
  const fecha = resolverFecha(valores.fecha, entorno);
  if (fecha === null) {
    entorno.escribirError(`Fecha inválida: ${valores.fecha}\n`);
    return 1;
  }
  let lista: ReturnType<typeof porVencer>;
  try {
    lista = porVencer(
      await leerCoberturas(raizDatos),
      fecha,
      dias === undefined ? dias : Number(dias),
    );
  } catch (error) {
    entorno.escribirError(`coberturas: ${mensajeDe(error)}\n`);
    return 1;
  }
  entorno.escribir(
    valores.json === true
      ? `${JSON.stringify(lista, null, 2)}\n`
      : coberturasEnTexto(lista, fecha, dias === undefined ? dias : Number(dias)),
  );
  return 0;
}

/**
 * Lee el índice del SIDOF de la fecha (la de la Ciudad de México, por omisión) y el del día
 * anterior, y lista las publicaciones cuyo título coincide con una captura pendiente de
 * data/curado/; con `--json`, lo que usa el vigía del DOF de frescura.yml. Si el SIDOF no responde
 * o responde con otra forma, lo avisa y termina en 0: el vigía no detiene la corrida. Solo un
 * error que no viene del SIDOF termina en 1.
 */
async function dof(
  valores: { fecha?: string | undefined; json?: boolean | undefined },
  entorno: Entorno,
): Promise<number> {
  const fecha = resolverFecha(valores.fecha, entorno);
  if (fecha === null) {
    entorno.escribirError(`Fecha inválida: ${valores.fecha}\n`);
    return 1;
  }
  const cliente = restringirCliente(entorno.crearCliente(1000), [HOST_SIDOF]);
  let resultado: Awaited<ReturnType<typeof revisarDof>>;
  try {
    resultado = await revisarDof(cliente, fecha);
  } catch (error) {
    entorno.escribirError(`dof: ${mensajeDe(error)}\n`);
    return 1;
  }
  const { revision, avisos } = resultado;
  for (const aviso of avisos) entorno.escribirError(`dof: ${aviso}\n`);
  entorno.escribir(
    valores.json === true ? `${JSON.stringify(revision, null, 2)}\n` : dofEnTexto(revision),
  );
  return 0;
}

async function curar(entorno: Entorno, raizDatos: string): Promise<number> {
  let salida: Awaited<ReturnType<typeof curarDatos>>;
  try {
    salida = await curarDatos(raizDatos);
  } catch (error) {
    entorno.escribirError(`curar: ${mensajeDe(error)}
`);
    return 1;
  }
  for (const p of salida.problemas)
    entorno.escribirError(`${p}
`);
  if (salida.problemas.length > 0) return 1;
  if (salida.resultados.length === 0) {
    entorno.escribir(`curar: no hay YAML en ${join(raizDatos, DIRECTORIO_CURADO)}
`);
  }
  for (const r of salida.resultados) {
    entorno.escribir(`${r.dataset}: ${r.estado} (${r.registros} registros)
`);
  }
  return 0;
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
  const permitidas = comando === undefined ? undefined : OPCIONES_POR_COMANDO[comando];
  if (permitidas !== undefined) {
    const sobran = Object.keys(values).filter((k) => !permitidas.includes(k));
    if (sobran.length > 0 || (comando !== "actualizar" && resto.length > 0)) {
      const motivo =
        sobran.length > 0
          ? `Opciones que no aplican a ${comando}: ${sobran.map((k) => `--${k}`).join(", ")}`
          : `Argumentos de más para ${comando}: ${resto.join(" ")}`;
      entorno.escribirError(`${motivo}\n${USO}`);
      return 1;
    }
  }

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
    case "revisar":
      return revisar(values, entorno, raizDatos);
    case "curar":
      return curar(entorno, raizDatos);
    case "coberturas":
      return coberturas(values, entorno, raizDatos);
    case "dof":
      return dof(values, entorno);
    case "construir": {
      if (values.salida === undefined) {
        entorno.escribirError(`Falta --salida.
${USO}`);
        return 1;
      }
      try {
        const { archivos, bytes } = await construirSitio({ raizDatos, salida: values.salida });
        entorno.escribir(`sitio: ${archivos} archivos, ${bytes} bytes en ${values.salida}
`);
        return 0;
      } catch (error) {
        entorno.escribirError(`construir: ${mensajeDe(error)}
`);
        return 1;
      }
    }
    default:
      entorno.escribirError(`Comando desconocido o ausente.\n${USO}`);
      return 1;
  }
}
