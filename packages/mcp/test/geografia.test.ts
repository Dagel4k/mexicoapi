import { meta } from "mexicoapi/datos";
import { beforeAll, describe, expect, it } from "vitest";
import {
  contenido,
  esError,
  herramientasSinTocarRed,
  type Llamador,
  servidor,
  texto,
} from "./ayudas-herramientas.js";

const INEGI = {
  nombre: meta.municipios.sources[0]?.name,
  url: meta.municipios.sources[0]?.url,
};

let llamar: Llamador;
let urls: string[];

beforeAll(async () => {
  // Con base y un fetch que falla: los datos estables nunca deben pedir nada a la red.
  const conApi = herramientasSinTocarRed();
  urls = conApi.urls;
  llamar = await servidor(conApi.herramientas);
});

describe("buscar_municipio", () => {
  it("busca sin acentos ni mayúsculas, con el estado y la procedencia del paquete", async () => {
    const r = await llamar("buscar_municipio", { texto: "CULIACAN" });
    const c = contenido(r);
    expect(c.datos).toEqual([
      {
        cvegeo: "25006",
        cve_ent: "25",
        cve_mun: "006",
        nombre: "Culiacán",
        cve_cabecera: "0001",
        estado: "Sinaloa",
      },
    ]);
    expect(c).toMatchObject({
      total: 1,
      as_of: meta.municipios.as_of,
      fuente: INEGI,
      origen: "paquete",
      advertencias: [],
    });
    expect(texto(r)).toContain("1 municipio coincide con la búsqueda:");
    expect(texto(r)).toContain("- 25006 Culiacán, Sinaloa");
    expect(texto(r)).toContain(`Fuente: ${INEGI.nombre} (${INEGI.url})`);
    expect(texto(r)).toContain(`as_of: ${meta.municipios.as_of}`);
    expect(texto(r)).toContain("Origen: datos del paquete mexicoapi");
    expect(urls).toEqual([]);
  });

  it("limita a 10 por omisión, dice el total y acepta otro límite", async () => {
    const r = await llamar("buscar_municipio", { texto: "san" });
    const c = contenido(r);
    expect((c.datos as unknown[]).length).toBe(10);
    expect(c.total as number).toBeGreaterThan(10);
    expect(texto(r)).toContain(`${c.total} municipios coinciden con la búsqueda; se muestran 10:`);
    const tres = contenido(await llamar("buscar_municipio", { texto: "san", limite: 3 }));
    expect((tres.datos as unknown[]).length).toBe(3);
    const cincuenta = contenido(await llamar("buscar_municipio", { texto: "san", limite: 50 }));
    expect((cincuenta.datos as unknown[]).length).toBe(50);
  });

  it("filtra por estado", async () => {
    const respuesta = await llamar("buscar_municipio", { texto: "juarez", cve_ent: "13" });
    const r = contenido(respuesta);
    const datos = r.datos as Array<{ cve_ent: string; estado: string }>;
    expect(datos.length).toBeGreaterThan(1);
    expect(r.total).toBe(datos.length);
    expect(texto(respuesta)).toContain(`${datos.length} municipios coinciden con la búsqueda:`);
    expect(datos.every((m) => m.cve_ent === "13" && m.estado === "Hidalgo")).toBe(true);
  });

  it("sin coincidencias no es error", async () => {
    const r = await llamar("buscar_municipio", { texto: "zzzz" });
    expect(contenido(r)).toMatchObject({ datos: [], total: 0 });
    expect(texto(r)).toContain("Ningún municipio coincide con la búsqueda.");
  });

  it("rechaza un texto vacío o sin letras ni números, y un estado que no existe", async () => {
    esError(
      await llamar("buscar_municipio", { texto: "" }),
      'Argumentos inválidos para buscar_municipio: "texto" debe tener al menos 1 carácter',
    );
    esError(
      await llamar("buscar_municipio", { texto: " ¿!- " }),
      "El texto no tiene letras ni números para buscar.",
    );
    esError(
      await llamar("buscar_municipio", { texto: "san", cve_ent: "99" }),
      "No existe el estado 99.",
    );
  });

  it("rechaza argumentos mal formados", async () => {
    for (const args of [
      {},
      { texto: "san", cve_ent: "8" },
      { texto: "san", limite: 0 },
      { texto: "san", limite: 51 },
      { texto: "san", limite: 2.5 },
      { texto: "x".repeat(101) },
      { texto: "san", estado: "08" },
    ]) {
      esError(
        await llamar("buscar_municipio", args),
        /^Argumentos inválidos para buscar_municipio: /,
      );
    }
  });
});

describe("municipio", () => {
  it("devuelve el municipio por su cvegeo con su estado", async () => {
    const r = await llamar("municipio", { cvegeo: "25006" });
    expect(contenido(r)).toMatchObject({
      datos: { cvegeo: "25006", nombre: "Culiacán", estado: "Sinaloa", cve_cabecera: "0001" },
      as_of: meta.municipios.as_of,
      fuente: INEGI,
      origen: "paquete",
      advertencias: [],
    });
    expect(texto(r)).toContain("25006 Culiacán, Sinaloa (municipio 006, cabecera 0001)");
    expect(urls).toEqual([]);
  });

  it("dice cuando la fuente no trae cabecera", async () => {
    const r = await llamar("municipio", { cvegeo: "09002" });
    expect(texto(r)).toContain(
      "09002 Azcapotzalco, Ciudad de México (municipio 002, sin cabecera en la fuente)",
    );
  });

  it("un cvegeo que no existe es error de la herramienta; uno mal formado, de argumentos", async () => {
    esError(await llamar("municipio", { cvegeo: "99999" }), "No existe el municipio 99999.");
    for (const cvegeo of ["2500", "25006a", ""]) {
      esError(await llamar("municipio", { cvegeo }), /^Argumentos inválidos para municipio: /);
    }
  });
});
