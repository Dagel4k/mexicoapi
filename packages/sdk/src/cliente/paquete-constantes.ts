// La UMA, el salario mínimo y las tarifas de ISR desde el paquete, con las reglas y los textos de
// las constantes del núcleo, los mismos que usa la API: antes del primer año cargado, no existe;
// después del último, todavía no se carga.
import { anioDeConstante, umaVigente } from "@mexicoapi/core/constantes";
import { problemaSinRegistro } from "@mexicoapi/core/rutas";
import type { MetaDatos } from "../datos/tipos.js";
import { type Contexto, conDocs, fallaDe, type RutaPaquete, valor } from "./paquete-comun.js";

const constantes = () => import("../datos/constantes.js");

/** Una ruta por año: el dato de ese año con la meta del dataset, o el 404 que le toca. */
function porAnio(
  buscar: (
    m: Awaited<ReturnType<typeof constantes>>,
    c: Contexto,
    anio: number,
  ) => {
    dato: unknown;
    nombre: string;
    anios: readonly number[];
    meta: MetaDatos;
  },
): RutaPaquete {
  return {
    responder: async (c) => {
      const anio = Number(valor(c, "anio"));
      const { dato, nombre, anios, meta } = buscar(await constantes(), c, anio);
      if (dato !== undefined) return { data: dato, meta };
      const consulta = anioDeConstante(anios, anio, nombre);
      // El paquete trae el dato de cada año de su lista.
      if (consulta.tipo === "encontrado") throw new Error(`Falta ${nombre} de ${anio}.`);
      throw fallaDe(c, problemaSinRegistro(consulta.tipo, consulta.detalle));
    },
  };
}

export const UMA_VIGENTE: RutaPaquete = {
  responder: async (c) => {
    const m = await constantes();
    const fecha = valor(c, "fecha");
    const consulta = umaVigente(m.umas(), fecha);
    if (consulta.tipo !== "encontrado") {
      const extras = { fecha, cobertura: consulta.cobertura };
      throw fallaDe(c, problemaSinRegistro(consulta.tipo, consulta.detalle, extras));
    }
    return { data: consulta.registro, meta: conDocs(m.meta.uma, "constantes") };
  },
};

export const UMA = porAnio((m, _c, anio) => ({
  dato: m.uma(anio),
  nombre: "la UMA",
  anios: m.anios.uma,
  meta: m.meta.uma,
}));

export const SALARIO_MINIMO = porAnio((m, _c, anio) => {
  const zonas = m.salarioMinimo(anio);
  return {
    dato: zonas.length === 0 ? undefined : zonas,
    nombre: "el salario mínimo",
    anios: m.anios.salarioMinimo,
    meta: m.meta.salarioMinimo,
  };
});

export const TARIFA_ISR = porAnio((m, c, anio) => {
  // La regla de la ruta solo deja pasar mensual y anual.
  const periodo = valor(c, "periodo") as "mensual" | "anual";
  return {
    dato: m.tarifaIsr(periodo, anio),
    nombre: `la tarifa ${periodo} de ISR`,
    anios: m.anios.isr[periodo],
    meta: m.meta.isr,
  };
});
