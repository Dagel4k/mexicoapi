// La UMA, el salario mínimo y las tarifas de ISR desde el paquete, con las reglas y los textos del
// Worker (apps/api/src/computados/constantes.ts): antes del primer año cargado, no existe; después
// del último, todavía no se carga.
import type { MetaDatos } from "../datos/tipos.js";
import { type Contexto, conDocs, falla, type RutaPaquete, valor } from "./paquete-comun.js";

const constantes = () => import("../datos/constantes.js");

/** El 404 de un año que no está: antes del primero no existe; después del último, no se carga. */
function anioSinDato(c: Contexto, nombre: string, anios: readonly number[], anio: string) {
  const numero = Number(anio);
  // Las listas de años del paquete nunca están vacías.
  const primero = anios[0] as number;
  const ultimo = anios[anios.length - 1] as number;
  const cargados =
    primero === ultimo
      ? `el único año cargado es ${primero}`
      : `los años cargados van de ${primero} a ${ultimo}`;
  return numero > ultimo
    ? falla(c, "dato-no-disponible", `Todavía no se carga ${nombre} de ${anio}; ${cargados}.`)
    : falla(c, "no-encontrado", `No existe ${nombre} de ${anio} en los datos; ${cargados}.`);
}

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
      const anio = valor(c, "anio");
      const { dato, nombre, anios, meta } = buscar(await constantes(), c, Number(anio));
      if (dato === undefined) throw anioSinDato(c, nombre, anios, anio);
      return { data: dato, meta };
    },
  };
}

export const UMA_VIGENTE: RutaPaquete = {
  consulta: [["fecha", true, "fecha_uma"]],
  responder: async (c) => {
    const m = await constantes();
    const fecha = valor(c, "fecha");
    const umas = m.umas();
    // La lista nunca está vacía y va en años consecutivos.
    const primera = umas[0] as (typeof umas)[number];
    const ultima = umas[umas.length - 1] as (typeof umas)[number];
    const cobertura = { desde: primera.vigencia_desde, hasta: `${ultima.anio + 1}-01-31` };
    if (fecha < cobertura.desde || fecha > cobertura.hasta) {
      const antes = fecha < cobertura.desde;
      throw falla(
        c,
        antes ? "no-encontrado" : "dato-no-disponible",
        antes
          ? `Los datos empiezan con la UMA de ${primera.anio}, vigente desde el ${cobertura.desde}; no incluyen la UMA vigente el ${fecha}.`
          : `La UMA vigente el ${fecha} todavía no está cargada; la última cargada es la de ${ultima.anio}, vigente hasta el ${cobertura.hasta}.`,
        { fecha, cobertura },
      );
    }
    return { data: m.umaVigente(fecha), meta: conDocs(m.meta.uma, "constantes") };
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
