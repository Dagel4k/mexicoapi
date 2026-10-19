import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AVISO_SEPOMEX, URL_DESCARGA } from "mexicoapi/sepomex";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResultadoHerramienta } from "../src/herramientas.js";
import { conectar } from "./ayudas.js";
import {
  contenido,
  esError,
  herramientasSinTocarRed,
  type Llamador,
  servidor,
  texto,
} from "./ayudas-herramientas.js";
import { COLONIA_MALICIOSA, directorioTemporal, guardarCatalogo } from "./ayudas-sepomex.js";

let trabajo: Awaited<ReturnType<typeof directorioTemporal>>;

beforeAll(async () => {
  trabajo = await directorioTemporal();
});

afterAll(async () => {
  await trabajo.borrar();
});

/** Un servidor con la caché de SEPOMEX en `dir` y una base cuyo fetch falla si se usa. */
const llamador = async (dir: string): Promise<{ llamar: Llamador; urls: string[] }> => {
  const { herramientas, urls } = herramientasSinTocarRed({ dirSepomex: dir });
  return { llamar: await servidor(herramientas), urls };
};

describe("codigo_postal sin catálogo", () => {
  it("responde error con el comando para descargarlo y el aviso de Correos de México", async () => {
    const { llamar } = await llamador(join(trabajo.trabajo, "vacio"));
    const r = await llamar("codigo_postal", { cp: "80000" });
    esError(r, /npx mexicoapi sepomex sync/);
    expect(texto(r)).toContain(AVISO_SEPOMEX);
    expect(texto(r)).toContain(
      "[dato-no-disponible] No hay catálogo de códigos postales en este equipo.",
    );
    expect(texto(r)).not.toContain(trabajo.trabajo);
  });
});

describe("codigo_postal con catálogo", () => {
  let llamar: Llamador;
  let urls: string[];

  beforeAll(async () => {
    await guardarCatalogo(trabajo.trabajo, trabajo.cache);
    ({ llamar, urls } = await llamador(trabajo.cache));
  });

  it("da estado, municipio y asentamientos, con el aviso y sin rutas del equipo", async () => {
    const r = await llamar("codigo_postal", { cp: "80000" });
    const c = contenido(r);
    expect(c.datos).toEqual({
      cp: "80000",
      estado: { cve_ent: "25", nombre: "Sinaloa" },
      municipio: { cvegeo: "25006", nombre: "Culiacán" },
      asentamientos: [
        { nombre: "Centro de Prueba", tipo: "Colonia", zona: "Urbano", ciudad: "Culiacán Rosales" },
      ],
    });
    expect(c).toMatchObject({
      aviso: AVISO_SEPOMEX,
      as_of: null,
      fuente: {
        nombre: "Correos de México, Catálogo Nacional de Códigos Postales",
        url: URL_DESCARGA,
      },
      origen: "cache_local",
      advertencias: [],
    });
    expect(Date.parse(c.descargado as string)).toBeGreaterThan(Date.now() - 600_000);
    const t = texto(r);
    expect(t).toContain("Código postal 80000: Culiacán (25006), Sinaloa.");
    expect(t).toContain("1 asentamiento:");
    expect(t).toContain("- Centro de Prueba (Colonia, Urbano, Culiacán Rosales)");
    expect(t).toContain(`Aviso de Correos de México: ${AVISO_SEPOMEX}`);
    expect(t).toMatch(
      /as_of \(corte de los datos\): Correos de México no indicó la fecha; se descargó el \d{4}-\d{2}-\d{2}/,
    );
    expect(t).toContain("Origen: catálogo de Correos de México descargado en este equipo");
    expect(JSON.stringify(r)).not.toContain(trabajo.trabajo.replaceAll("\\", "\\\\"));
    expect(urls).toEqual([]);
  });

  it("un nombre que intenta dar órdenes queda como dato, en su propia línea", async () => {
    const r = await llamar("codigo_postal", { cp: "80010" });
    const lineas = texto(r).split("\n");
    expect(lineas).toContain(`- ${COLONIA_MALICIOSA} (Colonia, Urbano, Culiacán Rosales)`);
  });

  it("el texto trae todos los asentamientos: 30 con detalle y el resto con su nombre", async () => {
    const r = await llamar("codigo_postal", { cp: "80100" });
    expect((contenido(r).datos as { asentamientos: unknown[] }).asentamientos).toHaveLength(45);
    const lineas = texto(r).split("\n");
    expect(lineas).toContain("45 asentamientos:");
    expect(lineas).toContain("- Asentamiento numerado 30 (Colonia, Rural, Culiacán Rosales)");
    expect(lineas).toContain("Los otros 15, solo con el nombre:");
    for (let i = 31; i <= 45; i++) expect(lineas).toContain(`- Asentamiento numerado ${i}`);
    expect(texto(r)).not.toContain("Asentamiento numerado 31 (");
    expect(texto(r)).not.toContain("structuredContent");
  });

  // En 2025-03-26 y 2024-11-05 no hay structuredContent: el texto es lo único que llega.
  it.each(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"])(
    "con el protocolo %s el texto nombra los 45 asentamientos",
    async (version) => {
      const { herramientas } = herramientasSinTocarRed({ dirSepomex: trabajo.cache });
      const cliente = conectar({ herramientas });
      await cliente.inicializar(version);
      const { result } = await cliente.pedir("tools/call", {
        name: "codigo_postal",
        arguments: { cp: "80100" },
      });
      const r = result as ResultadoHerramienta;
      const t = texto(r);
      for (let i = 1; i <= 45; i++) expect(t).toContain(`- Asentamiento numerado ${i}`);
      expect(t).not.toContain("structuredContent");
      const conEstructura = version === "2025-11-25" || version === "2025-06-18";
      expect(r.structuredContent === undefined).toBe(!conEstructura);
    },
  );

  it("avisa cuando el municipio no está en INEGI y omite la ciudad vacía", async () => {
    const r = await llamar("codigo_postal", { cp: "80500" });
    const c = contenido(r);
    expect(c.datos).toMatchObject({ municipio: { cvegeo: null, nombre: "Municipio de Prueba" } });
    expect(c.advertencias).toEqual([
      "El municipio de este código postal no está en el catálogo de INEGI del paquete: el nombre es el de Correos de México y no hay cvegeo.",
    ]);
    expect(c.avisos).toEqual([
      { codigo: "municipio-sin-inegi", texto: (c.advertencias as string[])[0] },
    ]);
    const t = texto(r);
    expect(t).toContain("Código postal 80500: Municipio de Prueba, Sinaloa.");
    expect(t).toContain("- Rancho de Prueba (Ranchería, Rural)");
    expect(t).toContain(
      "Advertencia: El municipio de este código postal no está en el catálogo de INEGI",
    );
  });

  it("un código que no existe es error; uno mal formado, de argumentos", async () => {
    esError(
      await llamar("codigo_postal", { cp: "99999" }),
      "[no-encontrado] El código postal 99999 no está en el catálogo de Correos de México descargado en este equipo.",
    );
    for (const cp of ["8000", "800000", "8000a", ""]) {
      esError(
        await llamar("codigo_postal", { cp }),
        /^\[parametro-invalido\] Argumentos inválidos para codigo_postal: /,
      );
    }
  });
});

describe("codigo_postal con un catálogo dañado", () => {
  it("es error con el comando para descargarlo de nuevo, sin rutas", async () => {
    const otro = await directorioTemporal();
    try {
      await guardarCatalogo(otro.trabajo, otro.cache);
      await writeFile(join(otro.cache, "meta.json"), "{ dañado");
      const { llamar } = await llamador(otro.cache);
      const r = await llamar("codigo_postal", { cp: "80000" });
      esError(
        r,
        "[dato-no-disponible] El catálogo de códigos postales guardado en este equipo está dañado. Vuelve a descargarlo con: npx mexicoapi sepomex sync",
      );
    } finally {
      await otro.borrar();
    }
  });
});
