// El FIX del paquete después de un feriado bancario, con una serie de ejemplo que termina el
// viernes 13 de noviembre de 2026 (los datos reales no llegan a un feriado) y el calendario real
// de la CNBV, que tiene el lunes 16. Son los casos de las pruebas del Worker con los feriados de
// la CNBV: el paquete debe responder lo mismo que la API.
import { afterEach, describe, expect, it, vi } from "vitest";
import { crearCliente, type MexicoApiError } from "../../src/cliente/index.js";
import { FUENTE_CFF_20 } from "../../src/index.js";
import { PROBLEMAS, rechazo } from "./ayudas.js";

const feriados = vi.hoisted(() => ({ preguntados: [] as string[] }));

vi.mock("../../src/datos/fix.js", async (original) => {
  const real = await original<typeof import("../../src/datos/fix.js")>();
  const cobertura = Object.freeze({ desde: "2026-01-02", hasta: "2026-11-13" });
  return {
    ...real,
    serie: Object.freeze([
      Object.freeze({ fecha_publicacion: "2026-01-02", valor: "18.0012" }),
      Object.freeze({ fecha_publicacion: "2026-11-13", valor: "18.3100" }),
    ]),
    cobertura,
    tramo: cobertura,
  };
});

// El calendario real, anotando por qué días se pregunta: así se ve cuándo se usa.
vi.mock("../../src/datos/calendarios.js", async (original) => {
  const real = await original<typeof import("../../src/datos/calendarios.js")>();
  return {
    ...real,
    feriadoBancario: (fecha: string) => {
      feriados.preguntados.push(fecha);
      return real.feriadoBancario(fecha);
    },
  };
});

const COBERTURA = { desde: "2026-01-02", hasta: "2026-11-13" };
const api = crearCliente({ offline: true });

afterEach(() => {
  feriados.preguntados.length = 0;
});

async function problemaDe(consulta: Promise<unknown>, tipo: string, detalle: string) {
  const error = (await rechazo(consulta)) as MexicoApiError;
  expect(error.origen).toBe("paquete");
  expect(error.type).toBe(PROBLEMAS + tipo);
  expect(error.status).toBe(404);
  expect(error.detail).toBe(detalle);
  return error;
}

describe("FIX del paquete con los feriados bancarios de la CNBV", () => {
  it("martes 17 por la mañana: la operación usa el FIX del viernes 13", async () => {
    const r = await api.fixParaOperacion("2026-11-17");
    expect(r.data).toEqual({
      fecha_operacion: "2026-11-17",
      fecha_publicacion: "2026-11-13",
      valor: "18.3100",
      fundamento: FUENTE_CFF_20,
    });
    expect(r.origen).toBe("paquete");
    expect(feriados.preguntados).toEqual(["2026-11-16"]);
  });

  it("publicado el lunes 16: 404 no-encontrado definitivo, sin el valor del viernes", async () => {
    const error = await problemaDe(
      api.fixPublicado("2026-11-16"),
      "no-encontrado",
      "No hubo publicación del FIX en el DOF el 2026-11-16. Para el FIX que aplica a una operación de ese día, usa operacion=2026-11-16.",
    );
    expect(error.problema).toMatchObject({ fecha: "2026-11-16", cobertura: COBERTURA });
    expect(JSON.stringify(error.problema)).not.toContain("18.3100");
  });

  it("si con los fines de semana basta, no pregunta por los feriados", async () => {
    const r = await api.fixParaOperacion("2026-11-16");
    expect(r.data.fecha_publicacion).toBe("2026-11-13");
    expect(feriados.preguntados).toEqual([]);
  });

  it("el martes 17 no es feriado: dato-no-disponible, nunca un valor viejo", async () => {
    await problemaDe(
      api.fixParaOperacion("2026-11-18"),
      "dato-no-disponible",
      "Los datos del paquete no traen el FIX que aplica a una operación del 2026-11-18; la última publicación que traen es del 2026-11-13.",
    );
    await problemaDe(
      api.fixPublicado("2026-11-17"),
      "dato-no-disponible",
      "El FIX del 2026-11-17 no está en los datos del paquete; la última publicación que traen es del 2026-11-13.",
    );
    expect(feriados.preguntados).toEqual(["2026-11-16", "2026-11-17", "2026-11-16", "2026-11-17"]);
  });
});
