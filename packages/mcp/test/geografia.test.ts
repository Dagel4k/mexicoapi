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
    expect(texto(r)).toContain(`as_of (corte de los datos): ${meta.municipios.as_of}`);
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
      '[parametro-invalido] Argumentos inválidos para buscar_municipio: "texto" debe tener al menos 1 carácter',
    );
    esError(
      await llamar("buscar_municipio", { texto: " ¿!- " }),
      "[parametro-invalido] El texto no tiene letras ni números para buscar.",
    );
    esError(
      await llamar("buscar_municipio", { texto: "san", cve_ent: "99" }),
      "[no-encontrado] No existe el estado 99.",
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
        /^\[parametro-invalido\] Argumentos inválidos para buscar_municipio: /,
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
    esError(
      await llamar("municipio", { cvegeo: "99999" }),
      "[no-encontrado] No existe el municipio 99999.",
    );
    for (const cvegeo of ["2500", "25006a", ""]) {
      esError(
        await llamar("municipio", { cvegeo }),
        /^\[parametro-invalido\] Argumentos inválidos para municipio: /,
      );
    }
  });
});

const INEGI_ESTADOS = {
  nombre: meta.estados.sources[0]?.name,
  url: meta.estados.sources[0]?.url,
};

describe("estados", () => {
  it("lista las 32 entidades con su clave, nombre y abreviatura, del paquete", async () => {
    const r = await llamar("estados");
    const c = contenido(r);
    const datos = c.datos as Array<Record<string, string>>;
    expect(datos).toHaveLength(32);
    expect(datos[24]).toEqual({
      cve_ent: "25",
      nombre: "Sinaloa",
      abreviatura: "Sin.",
      cvegeo: "25",
    });
    expect(c).toMatchObject({
      as_of: meta.estados.as_of,
      fuente: INEGI_ESTADOS,
      origen: "paquete",
      advertencias: [],
      avisos: [],
    });
    const t = texto(r);
    expect(t).toContain("32 entidades federativas (clave, nombre y abreviatura):");
    expect(t).toContain("- 25 Sinaloa (Sin.)");
    expect(t).toContain("- 09 Ciudad de México (CDMX)");
    expect(t).toContain(`as_of (corte de los datos): ${meta.estados.as_of}`);
    expect(urls).toEqual([]);
  });

  it("no recibe argumentos", async () => {
    esError(
      await llamar("estados", { cve_ent: "25" }),
      /^\[parametro-invalido\] Argumentos inválidos para estados: /,
    );
  });
});

describe("municipios_de_estado", () => {
  it("con cve_ent da todos los municipios del estado, el total y el estado", async () => {
    const r = await llamar("municipios_de_estado", { cve_ent: "25" });
    const c = contenido(r);
    const datos = c.datos as Array<Record<string, unknown>>;
    expect(c.total).toBe(20);
    expect(datos).toHaveLength(20);
    // Solo la clave y el nombre: cve_ent va en estado y municipio da el registro completo. Así el
    // estado con más municipios cabe en el tope de resultado de los clientes.
    expect(datos[0]).toEqual({ cvegeo: "25001", nombre: "Ahome" });
    expect(datos.find((m) => m.cvegeo === "25006")).toEqual({
      cvegeo: "25006",
      nombre: "Culiacán",
    });
    expect(c.estado).toEqual({
      cve_ent: "25",
      nombre: "Sinaloa",
      abreviatura: "Sin.",
      cvegeo: "25",
    });
    expect(c).toMatchObject({
      as_of: meta.municipios.as_of,
      fuente: INEGI,
      origen: "paquete",
      advertencias: [],
      avisos: [],
    });
    const t = texto(r);
    expect(t).toContain("Sinaloa (cve_ent 25) tiene 20 municipios:");
    expect(t).toContain("- 25001 Ahome");
    expect(t.split("\n").filter((l) => l.startsWith("- 25"))).toHaveLength(20);
    expect(urls).toEqual([]);
  });

  it("no corta la lista: el estado con más municipios trae todos, en menos de 50 000 caracteres", async () => {
    const r = await llamar("municipios_de_estado", { cve_ent: "20" });
    const c = contenido(r);
    expect(c.total).toBe(570);
    expect(c.datos as unknown[]).toHaveLength(570);
    expect(JSON.stringify(c).length).toBeLessThan(50_000);
    expect(texto(r).length).toBeLessThan(50_000);
  });

  it("en la Ciudad de México dice alcaldías", async () => {
    const r = await llamar("municipios_de_estado", { cve_ent: "09" });
    expect(contenido(r).total).toBe(16);
    expect(texto(r)).toContain("Ciudad de México (cve_ent 09) tiene 16 alcaldías:");
  });

  it("con estado acepta el nombre o la abreviatura sin distinguir mayúsculas ni acentos", async () => {
    const claveDe = async (estado: string) =>
      (contenido(await llamar("municipios_de_estado", { estado })).estado as { cve_ent: string })
        .cve_ent;
    for (const [nombre, cve] of [
      ["Sinaloa", "25"],
      ["SINALOA", "25"],
      ["  sinaloa ", "25"],
      ["Sin.", "25"],
      ["Yucatan", "31"],
      ["nuevo leon", "19"],
      ["CDMX", "09"],
      ["ciudad de mexico", "09"],
      ["Distrito Federal", "09"],
      ["DF", "09"],
      ["D.F.", "09"],
      ["Estado de México", "15"],
      ["Edomex", "15"],
      ["Edo. Méx.", "15"],
      ["Mex.", "15"],
      ["Baja California", "02"],
      ["baja california sur", "03"],
      // Los nombres oficiales largos, tal como están en el catálogo, y el anterior de Querétaro.
      ["Coahuila de Zaragoza", "05"],
      ["Michoacán de Ocampo", "16"],
      ["Veracruz de Ignacio de la Llave", "30"],
      ["Querétaro de Arteaga", "22"],
      ["Queretaro", "22"],
      // El comienzo del nombre de uno solo, como se dice a diario.
      ["Coahuila", "05"],
      ["Michoacán", "16"],
      ["Veracruz", "30"],
    ] as const) {
      expect(await claveDe(nombre), nombre).toBe(cve);
    }
  });

  // "México" puede ser el Estado de México o la Ciudad de México, y el país no es un estado: antes
  // daba el 15 sin avisar.
  it("México sin más es ambiguo y pide cve_ent", async () => {
    for (const estado of ["México", "mexico", "MÉXICO"]) {
      esError(
        await llamar("municipios_de_estado", { estado }),
        `[parametro-invalido] "${estado}" puede ser 15 México (Estado de México) o 09 Ciudad de México; el país no es un estado. Indica cve_ent.`,
      );
    }
  });

  it("el texto del 15 dice que es el Estado de México", async () => {
    const r = await llamar("municipios_de_estado", { cve_ent: "15" });
    expect(texto(r)).toContain("México (Estado de México) (cve_ent 15) tiene 125 municipios:");
    // El dato no cambia: es el nombre del catálogo.
    expect((contenido(r).estado as { nombre: string }).nombre).toBe("México");
  });

  it("un nombre que no es de un solo estado, o que no existe, es error claro", async () => {
    esError(
      await llamar("municipios_de_estado", { estado: "Baja" }),
      '[parametro-invalido] "Baja" corresponde a más de un estado: 02 Baja California, 03 Baja California Sur. Indica cve_ent.',
    );
    esError(
      await llamar("municipios_de_estado", { estado: "Atlántida" }),
      '[no-encontrado] Ningún estado se llama "Atlántida". La herramienta estados da los nombres y las claves.',
    );
    esError(
      await llamar("municipios_de_estado", { estado: " ¿!- " }),
      "[parametro-invalido] El nombre del estado no tiene letras ni números.",
    );
    esError(
      await llamar("municipios_de_estado", { cve_ent: "99" }),
      "[no-encontrado] No existe el estado 99. La herramienta estados da las claves.",
    );
  });

  it("pide uno solo de cve_ent o estado", async () => {
    esError(
      await llamar("municipios_de_estado", {}),
      "[parametro-faltante] Indica cve_ent (la clave de 2 dígitos) o estado (el nombre).",
    );
    esError(
      await llamar("municipios_de_estado", { cve_ent: "25", estado: "Sinaloa" }),
      "[parametro-invalido] Indica solo uno de cve_ent o estado.",
    );
    for (const args of [
      { cve_ent: "8" },
      { estado: "" },
      { estado: "x".repeat(61) },
      { texto: "a" },
    ]) {
      esError(
        await llamar("municipios_de_estado", args),
        /^\[parametro-invalido\] Argumentos inválidos para municipios_de_estado: /,
      );
    }
  });
});
