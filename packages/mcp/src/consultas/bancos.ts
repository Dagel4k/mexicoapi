// Bancos y CLABE con el catálogo de bancos que trae el paquete: datos estables, sin red. La CLABE
// nunca sale del equipo.
import { type Banco, normalizarClabe } from "mexicoapi";
import type { Herramienta } from "../herramientas.js";
import {
  anotaciones,
  aUnaLinea,
  consultar,
  esquemaSalida,
  FECHA,
  FUENTE_VALIDADORES,
  type OpcionesHerramientas,
  procedencia,
  resultado,
} from "../respuesta.js";
import { esquemaValidacion, motivos } from "./validacion.js";

const BANCO = {
  type: "object",
  properties: {
    codigo: { type: "string" },
    codigo_spei: { type: "string" },
    nombre_corto: { type: "string" },
    razon_social: { type: ["string", "null"] },
    sector: { type: ["string", "null"] },
    tipo: { type: "string" },
    participacion: { type: "string" },
    activo: { type: "boolean" },
    baja_detectada: { type: ["string", "null"] },
    historial: {
      type: "array",
      items: {
        type: "object",
        properties: {
          codigo_spei: { type: "string" },
          nombre_corto: { type: "string" },
          desde: FECHA,
          hasta: { type: ["string", "null"], format: "date" },
        },
        required: ["nombre_corto", "desde", "hasta"],
      },
    },
  },
  required: ["codigo", "codigo_spei", "nombre_corto", "activo", "historial"],
} as const;

const DETALLE_CLABE = {
  type: ["object", "null"],
  properties: {
    codigo_banco: { type: "string" },
    codigo_plaza: { type: "string" },
    cuenta: { type: "string" },
    digito_control: { type: "string" },
    banco: {
      type: ["object", "null"],
      properties: {
        codigo: { type: "string" },
        nombre_corto: { type: "string" },
        activo: { type: "boolean" },
      },
      required: ["codigo", "nombre_corto", "activo"],
    },
    plaza: { type: ["object", "null"] },
  },
  required: ["codigo_banco", "codigo_plaza", "cuenta", "digito_control", "banco"],
} as const;

interface DetalleClabe {
  codigo_banco: string;
  codigo_plaza: string;
  cuenta: string;
  digito_control: string;
  banco: { codigo: string; nombre_corto: string; activo: boolean } | null;
}

export function validarClabeHerramienta({ cliente }: OpcionesHerramientas): Herramienta {
  return {
    name: "validar_clabe",
    title: "Validar CLABE",
    description:
      "Valida una CLABE interbancaria de 18 dígitos: dígito de control y código de banco contra el catálogo de bancos que trae el paquete. Acepta espacios y guiones entre los dígitos. No usa la red ni confirma que la cuenta exista. Devuelve el banco (activo: false si ya no aparece en el SPEI), la plaza y la cuenta.",
    inputSchema: {
      type: "object",
      properties: {
        clabe: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "La CLABE, con o sin espacios y guiones.",
        },
      },
      required: ["clabe"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(esquemaValidacion(DETALLE_CLABE), { origenes: ["paquete"] }),
    annotations: anotaciones(false),
    async ejecutar(args, { signal }) {
      // Sin los separadores que quita el validador; si no quedan 18 dígitos, el cliente responde
      // con la regla de la API (parametro-invalido) sin repetir la CLABE.
      const clabe = normalizarClabe(args.clabe as string);
      const r = await consultar(signal, () => cliente.clabe(clabe, { fuente: "paquete", signal }));
      const v = r.data;
      const detalle = v.detalle as DetalleClabe | null;
      let lineas: string[];
      if (v.valido && detalle?.banco) {
        // Con el catálogo, una CLABE válida siempre trae su banco.
        const { banco } = detalle;
        const activo = banco.activo ? "activo en el SPEI" : "ya no aparece en el SPEI";
        lineas = [
          `CLABE válida: banco ${banco.codigo} ${aUnaLinea(banco.nombre_corto)} (${activo}), plaza ${detalle.codigo_plaza}, cuenta ${detalle.cuenta}, dígito de control ${detalle.digito_control}.`,
        ];
      } else {
        // Todos los motivos, como en errores; el del banco dice cuál código no está.
        const texto = v.errores
          .map((e) =>
            e === "banco"
              ? `el código de banco ${clabe.slice(0, 3)} no está en el catálogo`
              : motivos([e]),
          )
          .join(", ");
        lineas = [`CLABE inválida: ${texto}.`];
      }
      lineas.push(aUnaLinea(v.nota));
      const p = procedencia(r);
      const fuentes = [...p.fuentes, FUENTE_VALIDADORES];
      return resultado(lineas, v, { ...p, fuentes });
    },
  };
}

const PARTICIPACION: Readonly<Record<string, string>> = {
  directa: "participante directo",
  no_confirmada: "participación no confirmada",
};

/** Los nombres cortos que tuvo antes, sin el actual, con sus periodos. */
function anteriores(b: Banco): string[] {
  return b.historial
    .filter((h) => h.nombre_corto !== b.nombre_corto)
    .map((h) => `${aUnaLinea(h.nombre_corto)} (${h.desde} a ${h.hasta ?? "hoy"})`);
}

export function bancoPorCodigoHerramienta({ cliente }: OpcionesHerramientas): Herramienta {
  return {
    name: "banco_por_codigo",
    title: "Banco por código",
    description:
      "Devuelve un banco o participante del SPEI por el código de 3 dígitos con el que empieza la CLABE: nombre corto, razón social, clave SPEI, si sigue activo y su historial de nombres. Sale del catálogo que trae el paquete, sin red.",
    inputSchema: {
      type: "object",
      properties: {
        codigo: {
          type: "string",
          pattern: "^[0-9]{3}$",
          description: "Los 3 primeros dígitos de la CLABE.",
        },
      },
      required: ["codigo"],
      additionalProperties: false,
    },
    outputSchema: esquemaSalida(BANCO, { origenes: ["paquete"] }),
    annotations: anotaciones(false),
    async ejecutar(args, { signal }) {
      const codigo = args.codigo as string;
      const r = await consultar(signal, () => cliente.banco(codigo, { fuente: "paquete", signal }));
      const b = r.data;
      const razon = b.razon_social === null ? "" : `: ${aUnaLinea(b.razon_social)}`;
      const participacion = PARTICIPACION[b.participacion] ?? aUnaLinea(b.participacion);
      const estado = b.activo
        ? `Activo en el SPEI, ${participacion}, clave SPEI ${b.codigo_spei}.`
        : `Ya no aparece en el SPEI${b.baja_detectada === null ? "" : ` (baja detectada el ${b.baja_detectada})`}; clave SPEI ${b.codigo_spei}.`;
      const lineas = [`${b.codigo} ${aUnaLinea(b.nombre_corto)}${razon}`, estado];
      const previos = anteriores(b);
      if (previos.length > 0) lineas.push(`Nombres anteriores: ${previos.join("; ")}.`);
      return resultado(lineas, b, procedencia(r));
    },
  };
}
