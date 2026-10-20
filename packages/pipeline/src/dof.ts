// Vigía del DOF: lee el índice del SIDOF de un día y del anterior, y lista las publicaciones cuyo
// título coincide con una de las capturas pendientes de data/curado/ (la RMF y sus modificaciones,
// las disposiciones de la CNBV, el salario mínimo, la UMA y el Anexo 8). No captura nada: avisa
// para que una persona siga el procedimiento de docs/operacion/datos-curados.md. Lo usa el comando
// `dof` y, con él, frescura.yml.
import { type FechaISO, sumarDias } from "@mexicoapi/core";
import { z } from "zod";
import {
  curadoDiasCnbv,
  curadoDiasSat,
  curadoSalarioMinimo,
  curadoTarifasIsr,
  curadoUma,
  DIRECTORIO_CURADO,
} from "./curado/registro.js";
import { ErrorDatos } from "./errores.js";
import { type Cliente, ErrorHttp } from "./http.js";

export const HOST_SIDOF = "sidof.segob.gob.mx";

/** El índice del SIDOF de una fecha: las notas del DOF de ese día, en sus tres ediciones. */
export function urlIndiceDof(fecha: FechaISO): string {
  const [anio, mes, dia] = fecha.split("-");
  return `https://${HOST_SIDOF}/dof/sidof/notas/${dia}-${mes}-${anio}`;
}

export type Edicion = "matutina" | "vespertina" | "extraordinaria";

export interface NotaDof {
  codigo: string;
  titulo: string;
  edicion: Edicion;
}

const yaml = (def: { yaml: string }): string => `data/${DIRECTORIO_CURADO}/${def.yaml}`;

export interface CapturaPendiente {
  /** Va en el título del issue. */
  clave: string;
  /** Texto que se busca en el título de la nota, sin distinguir mayúsculas ni acentos. */
  texto: string;
  archivos: readonly string[];
}

/** Lo que se busca en los títulos del DOF, en el orden en que se nombra en el issue. */
export const CAPTURAS_PENDIENTES: readonly CapturaPendiente[] = [
  {
    clave: "modificaciones-rmf",
    texto: "Resolución de Modificaciones a la Resolución Miscelánea Fiscal",
    archivos: [yaml(curadoDiasSat)],
  },
  {
    clave: "rmf",
    texto: "Resolución Miscelánea Fiscal para",
    archivos: [yaml(curadoDiasSat), yaml(curadoTarifasIsr)],
  },
  { clave: "cnbv", texto: "cerrar sus puertas", archivos: [yaml(curadoDiasCnbv)] },
  { clave: "salario-minimo", texto: "salarios mínimos", archivos: [yaml(curadoSalarioMinimo)] },
  { clave: "uma", texto: "Unidad de Medida y Actualización", archivos: [yaml(curadoUma)] },
  { clave: "anexo-8", texto: "Anexo 8", archivos: [yaml(curadoTarifasIsr)] },
];

const EDICIONES = [
  ["NotasMatutinas", "matutina"],
  ["NotasVespertinas", "vespertina"],
  ["NotasExtraordinarias", "extraordinaria"],
] as const;

// Las notas sin título son los encabezados de cada dependencia.
const esquemaNota = z.object({
  codNota: z.number().int().positive(),
  titulo: z.string().nullish(),
});

const esquemaIndice = z.object({
  messageCode: z.literal(200),
  response: z.literal("OK"),
  NotasMatutinas: z.array(esquemaNota),
  NotasVespertinas: z.array(esquemaNota),
  NotasExtraordinarias: z.array(esquemaNota),
});

/** El SIDOF responde así cuando no hay publicaciones (en la consulta de indicadores, con 404). */
function esSinPublicaciones(json: unknown): boolean {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return false;
  const o = json as Record<string, unknown>;
  return Object.keys(o).length === 2 && o.messageCode === 404 && o.response === "NOT_FOUND";
}

/**
 * Las notas con título del índice del SIDOF de `fecha`, matutinas, vespertinas y extraordinarias,
 * una vez cada una. Lanza ErrorDatos si la respuesta no tiene la forma esperada.
 */
export function interpretarIndiceDof(bytes: Uint8Array, fecha: FechaISO): NotaDof[] {
  const error = (detalle: string) =>
    new ErrorDatos(`el índice del SIDOF del ${fecha} ${detalle}`, null);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw error("no es JSON válido");
  }
  if (esSinPublicaciones(json)) return [];
  const r = esquemaIndice.safeParse(json);
  if (!r.success) {
    const ruta = r.error.issues[0]?.path.map(String).join(".") ?? "";
    throw error(`no tiene la forma esperada: ${ruta === "" ? "(raíz)" : ruta}`);
  }
  const vistas = new Set<string>();
  const notas: NotaDof[] = [];
  for (const [campo, edicion] of EDICIONES) {
    for (const n of r.data[campo]) {
      const codigo = String(n.codNota);
      if (n.titulo == null || n.titulo.trim() === "" || vistas.has(codigo)) continue;
      vistas.add(codigo);
      notas.push({ codigo, titulo: n.titulo, edicion });
    }
  }
  return notas;
}

/**
 * Sin acentos, mayúsculas ni caracteres invisibles, con los espacios juntos: así se comparan los
 * títulos.
 */
const normalizar = (texto: string): string =>
  texto
    .replace(/\p{Cf}/gu, "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const BUSQUEDAS = CAPTURAS_PENDIENTES.map((c) => ({
  captura: c,
  // Palabras completas: el Anexo 80 no es el Anexo 8.
  patron: new RegExp(
    `(?<![\\p{L}\\p{N}])${normalizar(c.texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "u",
  ),
}));

const TOPE_PUBLICACION = 500;

/**
 * El título de la nota en una línea, para el issue: sin controles ni separadores de línea, sin
 * caracteres invisibles, sin acentos graves (va en un bloque de código) y con un tope de largo.
 */
function enUnaLinea(titulo: string): string {
  const limpio = titulo
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replaceAll("`", "'")
    .replace(/\s+/g, " ")
    .trim();
  return limpio.length > TOPE_PUBLICACION ? `${limpio.slice(0, TOPE_PUBLICACION - 1)}…` : limpio;
}

export interface PublicacionPorCapturar {
  codigo: string;
  /** Título del issue: el mismo para la misma publicación en cada corrida. */
  titulo: string;
  /** El título de la nota en el DOF, en una línea. */
  publicacion: string;
  edicion: Edicion;
  fecha: FechaISO;
  /** El texto de la nota en el SIDOF. */
  url: string;
  /** Claves de las capturas pendientes con que coincide, en el orden de CAPTURAS_PENDIENTES. */
  capturas: string[];
  /** Los YAML de data/curado/ donde puede ir la captura. */
  archivos: string[];
}

/** Las notas cuyo título coincide con alguna captura pendiente. */
export function publicacionesPorCapturar(
  notas: readonly NotaDof[],
  fecha: FechaISO,
): PublicacionPorCapturar[] {
  return notas.flatMap((n) => {
    const titulo = normalizar(n.titulo);
    const capturas = BUSQUEDAS.filter((b) => b.patron.test(titulo)).map((b) => b.captura);
    const [primera] = capturas;
    if (primera === undefined) return [];
    return [
      {
        codigo: n.codigo,
        titulo: `Publicación en el DOF: ${n.codigo} (${primera.clave})`,
        publicacion: enUnaLinea(n.titulo),
        edicion: n.edicion,
        fecha,
        url: `https://${HOST_SIDOF}/notas/docFuente/${n.codigo}`,
        capturas: capturas.map((c) => c.clave),
        archivos: [...new Set(capturas.flatMap((c) => c.archivos))],
      },
    ];
  });
}

/**
 * Cómo quedó cada índice: `sin_respuesta` si el SIDOF no respondió (red, estado HTTP o una
 * redirección que el cliente no sigue) y `otra_forma` si respondió algo que no es el índice
 * (una página de error, un cuerpo que no es JSON o un JSON con otros campos).
 */
export type EstadoIndice = "revisado" | "sin_respuesta" | "otra_forma";

export interface IndiceDof {
  fecha: FechaISO;
  estado: EstadoIndice;
  /** Notas con título que se revisaron. */
  notas: number;
}

export interface RevisionDof {
  /** La fecha de la corrida. */
  fecha: FechaISO;
  /** El índice del día anterior y el del día, en ese orden. */
  indices: IndiceDof[];
  publicaciones: PublicacionPorCapturar[];
}

/**
 * Pide el índice del SIDOF de `fecha` y el del día anterior (así entra la edición vespertina que
 * salió después de la corrida de ayer) y busca las capturas pendientes en los dos. Un índice que no
 * se pudo leer queda con su estado y un aviso, y el otro se revisa igual. Solo lanza si el error
 * no viene del SIDOF.
 */
export async function revisarDof(
  cliente: Cliente,
  fecha: FechaISO,
): Promise<{ revision: RevisionDof; avisos: string[] }> {
  const indices: IndiceDof[] = [];
  const avisos: string[] = [];
  const vistas = new Set<string>();
  const publicaciones: PublicacionPorCapturar[] = [];
  for (const dia of [sumarDias(fecha, -1), fecha]) {
    let notas: NotaDof[];
    try {
      const { cuerpo } = await cliente.obtener(urlIndiceDof(dia), { aceptar: [404] });
      notas = interpretarIndiceDof(cuerpo, dia);
    } catch (e) {
      if (e instanceof ErrorHttp) {
        indices.push({ fecha: dia, estado: "sin_respuesta", notas: 0 });
        avisos.push(`el SIDOF no respondió al pedir el índice del ${dia}: ${e.message}`);
        continue;
      }
      if (e instanceof ErrorDatos) {
        indices.push({ fecha: dia, estado: "otra_forma", notas: 0 });
        avisos.push(`el SIDOF respondió con otra forma: ${e.message}`);
        continue;
      }
      throw e;
    }
    indices.push({ fecha: dia, estado: "revisado", notas: notas.length });
    for (const p of publicacionesPorCapturar(notas, dia)) {
      if (vistas.has(p.codigo)) continue;
      vistas.add(p.codigo);
      publicaciones.push(p);
    }
  }
  return { revision: { fecha, indices, publicaciones }, avisos };
}

const plural = (n: number, una: string, varias: string): string => `${n} ${n === 1 ? una : varias}`;

const ESTADOS: Record<Exclude<EstadoIndice, "revisado">, string> = {
  sin_respuesta: "el SIDOF no respondió",
  otra_forma: "el SIDOF respondió con otra forma",
};

/** La revisión en texto: cada índice y cada publicación con su enlace, capturas y archivos. */
export function dofEnTexto(r: RevisionDof): string {
  const renglones = r.indices.map(
    (i) =>
      `Índice del SIDOF del ${i.fecha}: ${i.estado === "revisado" ? plural(i.notas, "nota", "notas") : ESTADOS[i.estado]}.`,
  );
  if (!r.indices.some((i) => i.estado === "revisado")) {
    renglones.push("No se revisó ningún índice.");
  } else if (r.publicaciones.length === 0) {
    renglones.push("Ninguna nota coincide con una captura pendiente.");
  } else {
    const cuantas = plural(r.publicaciones.length, "nota coincide", "notas coinciden");
    renglones.push(`${cuantas} con una captura pendiente:`);
    for (const p of r.publicaciones) {
      renglones.push(
        `  ${p.codigo} (${p.fecha}, ${p.edicion}) ${p.publicacion}`,
        `    ${p.url}`,
        `    capturas: ${p.capturas.join(", ")}; archivos: ${p.archivos.join(", ")}`,
      );
    }
  }
  return `${renglones.join("\n")}\n`;
}
