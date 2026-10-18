import { describe, expect, it } from "vitest";
import { RUTAS, type Ruta, resolver } from "../../src/rutas.js";

const nada = () => new Response(null);

const TABLA: readonly Ruta[] = [
  {
    patron: /^\/x\/(?<id>[^/]+)$/,
    parametros: { id: { patron: /^\d{2}$/, detalle: "El id debe tener 2 dígitos." } },
    manejar: nada,
  },
  {
    patron: /^\/q$/,
    consulta: {
      a: { patron: /^\d+$/, detalle: "a debe ser un entero.", obligatorio: true },
      b: { patron: /^(?:true|false)$/, detalle: "b debe ser true o false." },
    },
    manejar: nada,
  },
  {
    // Tabla mal armada: la regla nombra un grupo que el patrón no tiene.
    patron: /^\/mal\/(?<otro>[^/]+)$/,
    parametros: { id: { patron: /^.*$/, detalle: "id inválido." } },
    manejar: nada,
  },
  { patron: /^\/libre\/(?<libre>[^/]+)$/, manejar: nada },
  { patron: /^\/libre\/(?<libre>[^/]+)$/, manejar: () => new Response("segunda") },
  {
    // `cumple` agrega lo que el patrón no puede decir (un máximo, una fecha que existe).
    patron: /^\/c\/(?<n>[^/]+)$/,
    parametros: {
      n: { patron: /^\d+$/, cumple: (v) => Number(v) <= 10, detalle: "n va de 0 a 10." },
    },
    consulta: {
      m: { patron: /^\d+$/, cumple: (v) => Number(v) % 2 === 0, detalle: "m debe ser par." },
    },
    manejar: nada,
  },
];

const resolverEn = (ruta: string) => resolver(TABLA, new URL(`https://api.test${ruta}`));

describe("resolver", () => {
  it("devuelve la ruta con los parámetros validados", () => {
    const r = resolverEn("/x/25");
    expect(r).toEqual({ ruta: TABLA[0], parametros: { id: "25" }, consulta: {} });
  });

  it("una ruta desconocida no se encuentra", () => {
    expect(resolverEn("/y")).toEqual({ problema: "no-encontrado", detalle: "No existe la ruta." });
    expect(resolverEn("/x/25/extra")).toMatchObject({ problema: "no-encontrado" });
    expect(resolverEn("/X/25")).toMatchObject({ problema: "no-encontrado" });
  });

  it("cualquier % en la ruta da no encontrado, aunque el patrón coincida", () => {
    expect(resolverEn("/x/%32%35")).toMatchObject({ problema: "no-encontrado" });
    expect(resolverEn("/libre/%41")).toMatchObject({ problema: "no-encontrado" });
  });

  it("un parámetro de ruta que no cumple su patrón es inválido y se nombra", () => {
    for (const valor of ["2a", "250", "2", "25.json", "-1"]) {
      expect(resolverEn(`/x/${valor}`)).toEqual({
        problema: "parametro-invalido",
        detalle: "El id debe tener 2 dígitos.",
        parametro: "id",
      });
    }
  });

  it("si la regla no tiene grupo en el patrón, rechaza en vez de dejar pasar", () => {
    expect(resolverEn("/mal/25")).toMatchObject({
      problema: "parametro-invalido",
      parametro: "id",
    });
  });

  it("una regla con cumple exige el patrón y la comprobación extra", () => {
    expect(resolverEn("/c/10?m=4")).toEqual({
      ruta: TABLA[5],
      parametros: { n: "10" },
      consulta: { m: "4" },
    });
    expect(resolverEn("/c/11")).toEqual({
      problema: "parametro-invalido",
      detalle: "n va de 0 a 10.",
      parametro: "n",
    });
    expect(resolverEn("/c/x")).toMatchObject({ problema: "parametro-invalido", parametro: "n" });
    expect(resolverEn("/c/1?m=3")).toEqual({
      problema: "parametro-invalido",
      detalle: "m debe ser par.",
      parametro: "m",
    });
    expect(resolverEn("/c/1?m=x")).toMatchObject({
      problema: "parametro-invalido",
      parametro: "m",
    });
  });

  it("un grupo sin regla no llega al manejador", () => {
    expect(resolverEn("/libre/cualquier-cosa")).toEqual({
      ruta: TABLA[3],
      parametros: {},
      consulta: {},
    });
  });

  describe("query", () => {
    it("acepta los parámetros declarados", () => {
      expect(resolverEn("/q?a=10&b=true")).toMatchObject({ consulta: { a: "10", b: "true" } });
      expect(resolverEn("/q?a=10")).toMatchObject({ consulta: { a: "10" } });
    });

    it("un parámetro no declarado es desconocido, también en rutas sin parámetros", () => {
      expect(resolverEn("/q?a=1&c=2")).toEqual({
        problema: "parametro-desconocido",
        detalle: "Esta ruta no acepta el parámetro c.",
        parametro: "c",
      });
      expect(resolverEn("/x/25?a=1")).toMatchObject({
        problema: "parametro-desconocido",
        parametro: "a",
      });
    });

    it("los nombres heredados de Object no cuentan como declarados", () => {
      for (const nombre of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
        expect(resolverEn(`/q?a=1&${nombre}=1`)).toMatchObject({
          problema: "parametro-desconocido",
          parametro: nombre,
        });
      }
    });

    it("repetido o vacío es inválido", () => {
      expect(resolverEn("/q?a=1&a=2")).toEqual({
        problema: "parametro-invalido",
        detalle: "El parámetro a aparece más de una vez.",
        parametro: "a",
      });
      expect(resolverEn("/q?a=")).toEqual({
        problema: "parametro-invalido",
        detalle: "El parámetro a está vacío.",
        parametro: "a",
      });
      expect(resolverEn("/q?a=1&b")).toMatchObject({
        problema: "parametro-invalido",
        parametro: "b",
      });
    });

    it("un segmento vacío o sin nombre es inválido y no nombra parámetro", () => {
      for (const ruta of [
        "/q?&",
        "/q?&&",
        "/q?a=1&&b=true",
        "/q?a=1&",
        "/q?&a=1",
        "/q?=1",
        "/q?a=1&=2",
        "/x/25?&",
      ]) {
        expect(resolverEn(ruta), ruta).toEqual({
          problema: "parametro-invalido",
          detalle: "La query tiene un parámetro sin nombre.",
        });
      }
    });

    it("un ? sin parámetros no cuenta", () => {
      expect(resolverEn("/x/25?")).toEqual({
        ruta: TABLA[0],
        parametros: { id: "25" },
        consulta: {},
      });
    });

    it("falta un obligatorio", () => {
      expect(resolverEn("/q?b=true")).toEqual({
        problema: "parametro-faltante",
        detalle: "Falta el parámetro a.",
        parametro: "a",
      });
    });

    it("un valor que no cumple su patrón es inválido con el detalle de la regla", () => {
      expect(resolverEn("/q?a=1&b=si")).toEqual({
        problema: "parametro-invalido",
        detalle: "b debe ser true o false.",
        parametro: "b",
      });
    });

    it("los parámetros de ruta se revisan antes que la query", () => {
      expect(resolverEn("/x/2a?z=1")).toMatchObject({ problema: "parametro-invalido" });
    });
  });
});

describe("RUTAS", () => {
  const grupos = (r: RegExp) => [...r.source.matchAll(/\(\?<(\w+)>/g)].map((m) => m[1]).sort();

  it("cada patrón está anclado, sin banderas, y sus grupos son exactamente sus parámetros", () => {
    for (const ruta of RUTAS) {
      expect(ruta.patron.source).toMatch(/^\^.*\$$/);
      expect(ruta.patron.flags).toBe("");
      expect(grupos(ruta.patron)).toEqual(Object.keys(ruta.parametros ?? {}).sort());
      const reglas = [
        ...Object.values(ruta.parametros ?? {}),
        ...Object.values(ruta.consulta ?? {}),
      ];
      for (const regla of reglas) {
        expect(regla.patron.source).toMatch(/^\^.*\$$/);
        expect(regla.patron.flags).toBe("");
      }
    }
  });

  it("tiene las rutas calculadas", () => {
    const fuentes = RUTAS.map((r) => r.patron.source);
    for (const patron of [
      /^\/v1\/clabe\/(?<clabe>[^/]+)$/,
      /^\/v1\/dias-habiles$/,
      /^\/v1\/dias-inhabiles$/,
    ]) {
      expect(fuentes).toContain(patron.source);
    }
  });
});
