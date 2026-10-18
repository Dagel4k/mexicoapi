import { anios, meta } from "mexicoapi/datos/constantes";
import { beforeAll, describe, expect, it } from "vitest";
import {
  apiOk,
  BASE,
  contenido,
  esError,
  herramientasConApi,
  herramientasSinRed,
  type Llamador,
  servidor,
  texto,
} from "./ayudas-herramientas.js";

let llamar: Llamador;

beforeAll(async () => {
  llamar = await servidor(herramientasSinRed());
});

describe("constantes: UMA", () => {
  it("la UMA de un año, con la publicación del DOF del registro como fuente", async () => {
    const r = await llamar("constantes", { tipo: "uma", anio: 2026 });
    const c = contenido(r);
    const datos = c.datos as { diaria: string; fuente: { nombre: string; url: string } };
    expect(datos).toMatchObject({ anio: 2026, diaria: "117.31", vigencia_desde: "2026-02-01" });
    expect(c).toMatchObject({
      tipo: "uma",
      as_of: meta.uma.as_of,
      fuente: { nombre: datos.fuente.nombre, url: datos.fuente.url },
      fuentes: [{ nombre: datos.fuente.nombre, url: datos.fuente.url }],
      origen: "paquete",
      // Sin API las constantes no avisan: un año que el paquete no trae da error, no un dato viejo.
      advertencias: [],
    });
    expect(datos.fuente.url).toContain("dof.gob.mx");
    expect(texto(r)).toMatch(
      /^UMA de 2026: diaria 117\.31, mensual [\d.]+ y anual [\d.]+ pesos; rige desde el 2026-02-01\.$/m,
    );
  });

  it("la UMA vigente en una fecha: en enero, la del año anterior", async () => {
    const r = await llamar("constantes", { tipo: "uma", fecha: "2026-01-15" });
    expect(contenido(r).datos).toMatchObject({ anio: 2025, diaria: "113.14" });
    expect(texto(r)).toMatch(/^UMA vigente el 2026-01-15: la de 2025, diaria 113\.14/m);
  });

  it("pide exactamente uno de anio o fecha y no acepta periodo", async () => {
    esError(
      await llamar("constantes", { tipo: "uma" }),
      "[parametro-faltante] Con tipo=uma falta anio (la UMA de ese año) o fecha (la vigente ese día).",
    );
    esError(
      await llamar("constantes", { tipo: "uma", anio: 2026, fecha: "2026-03-01" }),
      "[parametro-invalido] Con tipo=uma indica solo uno de anio o fecha.",
    );
    esError(
      await llamar("constantes", { tipo: "uma", anio: 2026, periodo: "mensual" }),
      "[parametro-invalido] El parámetro periodo solo se acepta con tipo=isr.",
    );
  });

  it("los años que no están dan el error de la API", async () => {
    // Los años salen de los datos del paquete: la UMA del año siguiente no rompe la prueba.
    const primero = anios.uma[0] as number;
    const ultimo = anios.uma.at(-1) as number;
    const cargados = `los años cargados van de ${primero} a ${ultimo}`;
    esError(
      await llamar("constantes", { tipo: "uma", anio: primero - 1 }),
      `[no-encontrado] No existe la UMA de ${primero - 1} en los datos; ${cargados}.`,
    );
    esError(
      await llamar("constantes", { tipo: "uma", anio: ultimo + 2 }),
      `[dato-no-disponible] Todavía no se carga la UMA de ${ultimo + 2}; ${cargados}.`,
    );
  });
});

describe("constantes: salario mínimo", () => {
  it("las dos zonas de un año", async () => {
    const r = await llamar("constantes", { tipo: "salario_minimo", anio: 2026 });
    const c = contenido(r);
    expect(c.datos).toMatchObject([
      { zona: "general", diario: "315.04" },
      { zona: "zlfn", diario: "440.87" },
    ]);
    expect((c.fuentes as unknown[]).length).toBe(1);
    expect((c.fuente as { url: string }).url).toBe(
      "https://dof.gob.mx/nota_detalle.php?codigo=5775534&fecha=09/12/2025",
    );
    const t = texto(r);
    expect(t).toContain("Salario mínimo diario de 2026, desde el 2026-01-01:");
    expect(t).toContain("- general: 315.04 pesos");
    expect(t).toContain("- Zona Libre de la Frontera Norte: 440.87 pesos");
  });

  it("pide anio y no acepta fecha ni periodo", async () => {
    esError(
      await llamar("constantes", { tipo: "salario_minimo" }),
      "[parametro-faltante] Con tipo=salario_minimo falta el parámetro anio.",
    );
    esError(
      await llamar("constantes", { tipo: "salario_minimo", anio: 2026, fecha: "2026-01-01" }),
      "[parametro-invalido] El parámetro fecha solo se acepta con tipo=uma.",
    );
    esError(
      await llamar("constantes", { tipo: "salario_minimo", anio: 2026, periodo: "anual" }),
      "[parametro-invalido] El parámetro periodo solo se acepta con tipo=isr.",
    );
  });
});

describe("constantes: ISR", () => {
  it("la tarifa mensual de un año con sus tramos", async () => {
    const r = await llamar("constantes", { tipo: "isr", periodo: "mensual", anio: 2026 });
    const c = contenido(r);
    const datos = c.datos as { tramos: Array<{ limite_superior: string | null }> };
    expect(datos).toMatchObject({ anio: 2026, periodo: "mensual" });
    expect(datos.tramos[0]).toEqual({
      limite_inferior: "0.01",
      limite_superior: "844.59",
      cuota_fija: "0.00",
      tasa_excedente: "1.92",
    });
    expect(datos.tramos.at(-1)?.limite_superior).toBeNull();
    const t = texto(r);
    expect(t).toContain("Tarifa mensual de ISR de 2026, en pesos:");
    expect(t).toContain("- de 0.01 a 844.59: cuota fija 0.00 más 1.92 % del excedente");
    expect(t).toMatch(/- de [\d.]+ en adelante: cuota fija [\d.]+ más [\d.]+ % del excedente/);
  });

  it("pide periodo y anio, y no acepta fecha", async () => {
    esError(
      await llamar("constantes", { tipo: "isr", anio: 2026 }),
      "[parametro-faltante] Con tipo=isr falta el parámetro periodo: mensual o anual.",
    );
    esError(
      await llamar("constantes", { tipo: "isr", periodo: "anual" }),
      "[parametro-faltante] Con tipo=isr falta el parámetro anio.",
    );
    esError(
      await llamar("constantes", {
        tipo: "isr",
        periodo: "anual",
        anio: 2026,
        fecha: "2026-01-01",
      }),
      "[parametro-invalido] El parámetro fecha solo se acepta con tipo=uma.",
    );
    esError(
      await llamar("constantes", { tipo: "isr", periodo: "mensual", anio: 2025 }),
      /^\[no-encontrado\] No existe la tarifa mensual de ISR de 2025/,
    );
  });

  it("rechaza argumentos mal formados", async () => {
    for (const args of [
      {},
      { tipo: "inpc", anio: 2026 },
      { tipo: "uma", anio: 26.5 },
      { tipo: "uma", anio: 999 },
      { tipo: "salario_minimo", anio: 10000 },
      { tipo: "uma", fecha: "2026-13-01" },
      { tipo: "isr", periodo: "semanal", anio: 2026 },
    ]) {
      esError(
        await llamar("constantes", args),
        /^\[parametro-invalido\] Argumentos inválidos para constantes: /,
      );
    }
  });
});

describe("constantes con la API", () => {
  it("pide cada constante a su ruta", async () => {
    const fuente = {
      nombre: "DOF",
      url: "https://dof.prueba",
      fecha_publicacion: "2027-01-09",
      fragmento: "",
    };
    const { herramientas, urls } = herramientasConApi((url) => {
      if (url.pathname.includes("salario")) {
        // Una zona que el servidor no conoce se muestra con su clave.
        return apiOk([
          { anio: 2027, zona: "general", diario: "350.00", vigencia_desde: "2027-01-01", fuente },
          { anio: 2027, zona: "nueva", diario: "400.00", vigencia_desde: "2027-01-01", fuente },
        ]);
      }
      if (url.pathname.includes("isr")) {
        return apiOk({ anio: 2027, periodo: "anual", tramos: [], fuente });
      }
      return apiOk({
        anio: 2027,
        diaria: "120.00",
        mensual: "3648.00",
        anual: "43776.00",
        vigencia_desde: "2027-02-01",
        fuente,
      });
    });
    const llamar = await servidor(herramientas);
    const uma = contenido(await llamar("constantes", { tipo: "uma", anio: 2027 }));
    expect(uma).toMatchObject({
      origen: "api",
      fuente: { nombre: "DOF", url: "https://dof.prueba" },
    });
    await llamar("constantes", { tipo: "uma", fecha: "2027-03-01" });
    const salario = await llamar("constantes", { tipo: "salario_minimo", anio: 2027 });
    expect(texto(salario)).toContain("- nueva: 400.00 pesos");
    expect(contenido(salario).fuentes).toEqual([{ nombre: "DOF", url: "https://dof.prueba" }]);
    const isr = await llamar("constantes", { tipo: "isr", periodo: "anual", anio: 2027 });
    expect(texto(isr)).toContain("Tarifa anual de ISR de 2027, en pesos:");
    expect(urls).toEqual([
      `${BASE}/v1/constantes/uma/2027`,
      `${BASE}/v1/constantes/uma?fecha=2027-03-01`,
      `${BASE}/v1/constantes/salario-minimo/2027`,
      `${BASE}/v1/isr/tarifa/anual/2027`,
    ]);
  });
});

describe("constantes: respuestas vacías", () => {
  it("un salario mínimo sin zonas es error, no un texto a medias", async () => {
    const { herramientas } = herramientasConApi(() => apiOk([]));
    esError(
      await (await servidor(herramientas))("constantes", { tipo: "salario_minimo", anio: 2028 }),
      "[error-interno] La respuesta no trae el salario mínimo de 2028.",
    );
  });
});
