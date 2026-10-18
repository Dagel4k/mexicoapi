// Pruebas de la CLI que corren igual con la lógica (sobre src) y con el binario construido (dist).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { lineasTxt, txt } from "../sepomex/ayudas.js";

export interface Corrida {
  codigo: number;
  salida: string;
  errores: string;
}

export type Correr = (
  argv: readonly string[],
  env?: Record<string, string | undefined>,
) => Promise<Corrida>;

const COMANDOS = [
  "clabe",
  "rfc",
  "curp",
  "nss",
  "dias-habiles",
  "municipio",
  "banco",
  "uma",
  "salario-minimo",
  "isr",
  "sepomex",
];
const json = (c: Corrida): unknown => JSON.parse(c.salida);
const DIAS = ["dias-habiles", "--desde", "2026-03-16", "--dias", "5"];

/**
 * Una API local en 127.0.0.1 que responde cualquier ruta con un resultado de días hábiles que el
 * paquete no daría (2026-03-30), para saber de dónde salió la respuesta. Guarda lo que le piden.
 */
async function apiLocal(
  cambios: Readonly<Record<string, unknown>> = {},
): Promise<{ base: string; pedidos: string[]; cerrar(): Promise<void> }> {
  const pedidos: string[] = [];
  const servidor = createServer((pedido, respuesta) => {
    pedidos.push(pedido.url ?? "");
    respuesta.writeHead(200, { "Content-Type": "application/json" });
    respuesta.end(
      JSON.stringify({
        data: {
          desde: "2026-03-16",
          dias: 5,
          autoridad: "lft",
          resultado: "2026-03-30",
          inhabiles_saltados: [],
          advertencias: [],
          ...cambios,
        },
        meta: { dataset: "calendario.lft", as_of: "2026-03-01", sources: [], docs: "" },
      }),
    );
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  return {
    base: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`,
    pedidos,
    cerrar: () =>
      new Promise((listo) => {
        servidor.closeAllConnections();
        servidor.close(() => listo());
      }),
  };
}

export function probarCli(correr: Correr, version: string): void {
  it("--version imprime la versión y sale con 0", async () => {
    expect(await correr(["--version"])).toEqual({ codigo: 0, salida: `${version}\n`, errores: "" });
    expect((await correr(["-v"])).salida).toBe(`${version}\n`);
  });

  it("--help y -h listan los comandos", async () => {
    for (const bandera of ["--help", "-h"]) {
      const c = await correr([bandera]);
      expect(c.codigo).toBe(0);
      expect(c.errores).toBe("");
      for (const comando of COMANDOS) expect(c.salida).toContain(comando);
    }
  });

  it("cada comando tiene su ayuda", async () => {
    for (const comando of COMANDOS) {
      const c = await correr([comando, "--help"]);
      expect(c.codigo, comando).toBe(0);
      expect(c.salida, comando).toContain(`mexicoapi ${comando}`);
    }
    for (const sub of ["sync", "importar", "cp", "resumen"]) {
      const c = await correr(["sepomex", sub, "--help"]);
      expect(c.codigo, sub).toBe(0);
      expect(c.salida, sub).toContain(`mexicoapi sepomex ${sub}`);
    }
    expect((await correr(["sepomex", "inventado", "--help"])).salida).toContain("Subcomandos");
    expect((await correr(["inventado", "--help"])).salida).toContain("Comandos:");
  });

  it("sin comando, con un comando desconocido o sin valor: uso y código 2", async () => {
    const casos: [string[], RegExp][] = [
      [[], /Falta el comando/],
      [["inventado"], /Comando desconocido: inventado/],
      [["clabe"], /Falta el valor a validar en "clabe"/],
      [["rfc", "a", "b"], /Sobran argumentos en "rfc": b/],
      [["banco"], /Falta el código de 3 dígitos/],
      [["municipio"], /Falta la clave/],
      [["dias-habiles"], /Falta --desde/],
      [["dias-habiles", "--desde", "2026-03-16"], /Falta --dias/],
      [[...DIAS, "x"], /no recibe argumentos/],
      [["dias-habiles", "--desde", "2026-03-16", "--dias", "x"], /--dias debe ser un entero/],
      [["dias-habiles", "--desde", "2026-03-16", "--dias", "-3"], /--dias|-3/],
      [["dias-habiles", "--desde", "2026-13-01", "--dias", "5"], /--desde debe ser una fecha/],
      [["dias-habiles", "--desde", "ayer", "--dias", "5"], /--desde debe ser una fecha/],
      [["clabe", "002", "--desde", "2026-01-01"], /--desde no aplica a "clabe"/],
      [["clabe", "002", "--base", "http://x"], /--base no aplica/],
      [["clabe", "--no-existe"], /no-existe/],
      [["sepomex"], /Falta el subcomando/],
      [["sepomex", "inventado"], /Subcomando de "sepomex" desconocido: inventado/],
      [["sepomex", "sync", "x"], /no recibe argumentos/],
      [["sepomex", "resumen", "x"], /no recibe argumentos/],
      [["sepomex", "importar"], /Falta la ruta/],
      [["sepomex", "cp"], /Falta el código postal/],
      [["uma"], /Falta el año \(o --fecha AAAA-MM-DD\) en "uma"/],
      [["uma", "2026", "2027"], /Sobran argumentos en "uma": 2027/],
      [["uma", "2026", "--fecha", "2026-01-15"], /"uma" con --fecha no recibe argumentos: 2026/],
      [["uma", "--fecha", "ayer"], /--fecha debe ser una fecha válida/],
      [["uma", "--fecha"], /fecha/],
      [["salario-minimo"], /Falta el año en "salario-minimo"/],
      [["salario-minimo", "2026", "x"], /Sobran argumentos/],
      [["isr"], /Falta el periodo \(mensual o anual\) en "isr"/],
      [["isr", "mensual"], /Falta el año en "isr"/],
      [["isr", "mensual", "2026", "x"], /Sobran argumentos en "isr": x/],
      [[...DIAS, "--tipo-plazo"], /tipo-plazo/],
      [["clabe", "002", "--tipo-plazo", "general"], /--tipo-plazo no aplica a "clabe"/],
      [["banco", "002", "--fecha", "2026-01-01"], /--fecha no aplica a "banco"/],
      [["isr", "mensual", "2026", "--fecha", "2026-01-01"], /--fecha no aplica a "isr"/],
      [
        [...DIAS, "--autoridad", "sat"],
        /Con --autoridad sat falta --tipo-plazo: general o declaraciones_pagos\./,
      ],
      [["sepomex", "cp", "8000"], /El código postal debe tener 5 dígitos, como 01000; no "8000"/],
      [["sepomex", "cp", "8"], /5 dígitos/],
    ];
    for (const [argv, mensaje] of casos) {
      const c = await correr(argv);
      expect(c.codigo, argv.join(" ")).toBe(2);
      expect(c.salida, argv.join(" ")).toBe("");
      expect(c.errores, argv.join(" ")).toMatch(mensaje);
      expect(c.errores, argv.join(" ")).toContain("mexicoapi --help");
    }
  });

  it("una CLABE válida: banco del paquete y código 0", async () => {
    const c = await correr(["clabe", "002010077777777771"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("CLABE válida: 002010077777777771");
    expect(c.salida).toContain("BANAMEX");
    expect(c.salida).toContain("Origen: datos del paquete, sin red");
    expect(c.errores).toBe("");
  });

  it("--json de una CLABE imprime el objeto de la librería", async () => {
    const c = await correr(["clabe", "0020 1007-7777 7777 71", "--json"]);
    expect(c.codigo).toBe(0);
    const r = json(c) as {
      valido: boolean;
      valor: string;
      detalle: { banco: { activo: boolean } };
    };
    expect(r.valido).toBe(true);
    expect(r.valor).toBe("002010077777777771");
    expect(r.detalle.banco.activo).toBe(true);
  });

  it("una CLABE inválida sale con 1 y dice por qué", async () => {
    const c = await correr(["clabe", "002010077777777770"]);
    expect(c.codigo).toBe(1);
    expect(c.salida).toContain("no válida");
    expect(c.salida).toContain("el dígito verificador no coincide");
    const corta = await correr(["clabe", "12", "--json"]);
    expect(corta.codigo).toBe(1);
    expect((json(corta) as { errores: string[] }).errores).toEqual(["longitud"]);
  });

  it("rfc, curp y nss válidos e inválidos", async () => {
    const rfc = await correr(["rfc", "XAXX010101000"]);
    expect(rfc.codigo).toBe(0);
    expect(rfc.salida).toContain("RFC válido: XAXX010101000");
    expect(rfc.salida).toContain("tipo: generico");
    const curp = await correr(["curp", "HEGG560427MVZRRL04"]);
    expect(curp.codigo).toBe(0);
    expect(curp.salida).toContain("CURP válida");
    expect(curp.salida).toContain("nombre_entidad: Veracruz");
    const nss = await correr(["nss", "12345678903"]);
    expect(nss.codigo).toBe(0);
    expect(nss.salida).toContain("NSS válido: 12345678903");
    for (const [comando, valor] of [
      ["rfc", "ZZZ"],
      ["curp", ""],
      ["nss", "abc"],
    ] as const) {
      const c = await correr([comando, valor]);
      expect(c.codigo, comando).toBe(1);
      expect(c.salida, comando).toContain("no válid");
    }
  });

  it("dias-habiles sin red usa el paquete y lo dice", async () => {
    const c = await correr(DIAS, { MEXICOAPI_BASE: "" });
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("2026-03-16 + 5 días hábiles (lft): 2026-03-23");
    expect(c.salida).toContain("Origen: datos del paquete, sin red");
  });

  it("dias-habiles --json imprime la respuesta del cliente", async () => {
    const c = await correr([...DIAS, "--autoridad", "lft", "--json"]);
    expect(c.codigo).toBe(0);
    const r = json(c) as { origen: string; data: { resultado: string; autoridad: string } };
    expect(r.origen).toBe("paquete");
    expect(r.data).toMatchObject({ resultado: "2026-03-23", autoridad: "lft" });
  });

  it("dias-habiles lista los inhábiles que salta", async () => {
    const c = await correr(["dias-habiles", "--desde", "2026-03-13", "--dias", "3"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("Inhábiles saltados:");
    expect(c.salida).toContain("2026-03-16");
  });

  it("dias-habiles con entradas inválidas o sin cobertura sale con 1", async () => {
    const rara = await correr([...DIAS, "--autoridad", "xx"]);
    expect(rara.codigo).toBe(1);
    expect(rara.errores).toContain("lft");
    for (const dias of ["0", "3651"]) {
      const fuera = await correr(["dias-habiles", "--desde", "2026-03-16", "--dias", dias]);
      expect(fuera.codigo, dias).toBe(1);
      expect(fuera.salida, dias).toBe("");
    }
    const lejos = await correr(["dias-habiles", "--desde", "2101-01-04", "--dias", "5"]);
    expect(lejos.codigo).toBe(1);
    expect(lejos.salida).toBe("");
    expect(lejos.errores).toMatch(/^mexicoapi: /);
  });

  it("dias-habiles con la CNBV y el SAT, con su tipo de plazo", async () => {
    const cnbv = await correr([
      "dias-habiles",
      "--autoridad",
      "cnbv",
      "--desde",
      "2026-12-23",
      "--dias",
      "3",
    ]);
    expect(cnbv.codigo).toBe(0);
    expect(cnbv.salida).toContain("2026-12-23 + 3 días hábiles (cnbv): 2026-12-29");
    expect(cnbv.salida).toContain("2026-12-25  25 de diciembre");
    const sat = ["dias-habiles", "--autoridad", "sat", "--desde", "2026-07-17", "--dias", "3"];
    const general = await correr([...sat, "--tipo-plazo", "general"]);
    expect(general.codigo).toBe(0);
    expect(general.salida).toContain("2026-07-17 + 3 días hábiles (sat, general): 2026-08-05");
    const pagos = await correr([...sat, "--tipo-plazo", "declaraciones_pagos", "--json"]);
    expect(pagos.codigo).toBe(0);
    const r = json(pagos) as { origen: string; data: { resultado: string; autoridad: string } };
    expect(r.data).toMatchObject({ resultado: "2026-07-22", autoridad: "sat" });
    expect(r.origen).toBe("paquete");
    const sinTipo = await correr(sat);
    expect(sinTipo.codigo).toBe(2);
    expect(sinTipo.errores).toContain(
      "Con --autoridad sat falta --tipo-plazo: general o declaraciones_pagos.",
    );
    const raro = await correr([...sat, "--tipo-plazo", "anual"]);
    expect(raro.codigo).toBe(1);
    expect(raro.errores).toContain("general o declaraciones_pagos");
    // La regla de la API con los nombres de la CLI (revisarTipoPlazo): una opción que no aplica a
    // la autoridad es uso incorrecto, como --fecha en banco. Antes salía con 1 y el texto de la API.
    const sobra = await correr([...DIAS, "--tipo-plazo", "general"]);
    expect(sobra.codigo).toBe(2);
    expect(sobra.errores).toContain("--tipo-plazo solo se acepta con --autoridad sat.");
    // Una autoridad que no existe la rechaza antes la regla de la API, como en la API.
    const otra = await correr([...DIAS, "--autoridad", "imss", "--tipo-plazo", "general"]);
    expect(otra.codigo).toBe(1);
    expect(otra.errores).toContain("Autoridades disponibles: lft, cnbv y sat.");
  });

  it("dias-habiles --permitir-incompleto calcula fuera de la cobertura y lo advierte", async () => {
    const lejos = ["dias-habiles", "--desde", "2101-01-04", "--dias", "5"];
    expect((await correr(lejos)).codigo).toBe(1);
    const c = await correr([...lejos, "--permitir-incompleto"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("2101-01-04 + 5 días hábiles (lft): 2101-01-11");
    expect(c.salida).toContain(
      "Aviso: Calendario incompleto: LFT 2101; solo se descontaron fines de semana.",
    );
    const enJson = json(await correr([...lejos, "--permitir-incompleto", "--json"])) as {
      data: { resultado: string; advertencias: string[] };
    };
    expect(enJson.data.resultado).toBe("2101-01-11");
    const banco = await correr(["banco", "002", "--permitir-incompleto"]);
    expect(banco.codigo).toBe(2);
    expect(banco.errores).toContain('La opción --permitir-incompleto no aplica a "banco".');
  });

  it("no imprime los caracteres de control de un texto de la API", async () => {
    const api = await apiLocal({
      inhabiles_saltados: [
        {
          fecha: "2026-03-16",
          motivo: "\u001b[2JDía\nfalso",
          tipo: "descanso",
          fuente: { nombre: "F", url: "https://f.test" },
        },
      ],
      advertencias: ["\u001b]8;;https://x.test\u0007enlace\r\nOrigen: API"],
    });
    try {
      const c = await correr(DIAS, { MEXICOAPI_BASE: api.base });
      expect(c.codigo).toBe(0);
      expect([...c.salida].filter((x) => x !== "\n" && /\p{Cc}/u.test(x))).toEqual([]);
      expect(c.salida).toContain("  2026-03-16  [2JDía falso\n");
      expect(c.salida).toContain("Aviso: ]8;;https://x.test enlace Origen: API\n");
    } finally {
      await api.cerrar();
    }
  });

  it("uma por año y por fecha, en texto y en JSON", async () => {
    const c = await correr(["uma", "2026"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("UMA 2026 (del 2026-02-01 al 2027-01-31)");
    expect(c.salida).toContain("Diaria: 117.31");
    expect(c.salida).toContain("Fuente: INEGI");
    expect(c.salida).toContain("Origen: datos del paquete, sin red");
    const vigente = await correr(["uma", "--fecha", "2026-01-15"]);
    expect(vigente.codigo).toBe(0);
    expect(vigente.salida).toContain("UMA vigente el 2026-01-15: UMA 2025");
    const enJson = json(await correr(["uma", "2026", "--json"])) as {
      data: { anio: number; diaria: string };
      meta: { dataset: string };
    };
    expect(enJson.data).toMatchObject({ anio: 2026, diaria: "117.31" });
    expect(enJson.meta.dataset).toBe("constantes.uma");
  });

  it("uma, salario-minimo e isr con un año que no está o mal escrito salen con 1", async () => {
    for (const argv of [
      ["uma", "2016"],
      ["uma", "2090"],
      ["uma", "x"],
      ["uma", "26"],
      ["uma", "--fecha", "2000-06-01"],
      ["salario-minimo", "2090"],
      ["salario-minimo", "2026.0"],
      ["isr", "semanal", "2026"],
      ["isr", "mensual", "2025"],
    ]) {
      const c = await correr(argv);
      expect(c.codigo, argv.join(" ")).toBe(1);
      expect(c.salida, argv.join(" ")).toBe("");
      expect(c.errores, argv.join(" ")).toMatch(/^mexicoapi: (404|400) /);
    }
    const enJson = await correr(["uma", "2016", "--json"]);
    expect(JSON.parse(enJson.errores)).toMatchObject({
      error: { status: 404, tipo: "no-encontrado" },
    });
  });

  it("salario-minimo e isr en texto y en JSON", async () => {
    const salario = await correr(["salario-minimo", "2026"]);
    expect(salario.codigo).toBe(0);
    expect(salario.salida).toContain("Salario mínimo 2026, en pesos diarios:");
    expect(salario.salida).toContain("general: 315.04");
    expect(salario.salida).toContain("Zona Libre de la Frontera Norte: 440.87");
    const zonas = json(await correr(["salario-minimo", "2026", "--json"])) as { data: unknown[] };
    expect(zonas.data).toHaveLength(2);
    const isr = await correr(["isr", "mensual", "2026"]);
    expect(isr.codigo).toBe(0);
    expect(isr.salida).toContain("Tarifa mensual de ISR 2026, en pesos:");
    expect(isr.salida).toContain("844.59");
    expect(isr.salida).toContain("En adelante");
    expect(isr.salida).toContain("Fuente: Anexo 8");
    const tarifa = json(await correr(["isr", "anual", "2025", "--json"])) as {
      data: { periodo: string; anio: number; tramos: unknown[] };
    };
    expect(tarifa.data).toMatchObject({ periodo: "anual", anio: 2025 });
    expect(tarifa.data.tramos.length).toBeGreaterThan(5);
  });

  it("con una API que no responde, las constantes caen al paquete y lo avisan", async () => {
    const c = await correr(["salario-minimo", "2026", "--base", "http://127.0.0.1:1"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("315.04");
    expect(c.salida).toContain("Origen: datos del paquete (la API no respondió)");
    const isr = await correr(["isr", "mensual", "2026"], { MEXICOAPI_BASE: "http://127.0.0.1:1" });
    expect(isr.codigo).toBe(0);
    expect(isr.salida).toContain("la API no respondió");
  });

  it("municipio por cvegeo, por texto y sin resultados", async () => {
    const uno = await correr(["municipio", "25006"]);
    expect(uno.codigo).toBe(0);
    expect(uno.salida).toContain("25006  Culiacán, Sinaloa");
    const enJson = json(await correr(["municipio", "25006", "--json"])) as {
      data: { nombre: string };
    };
    expect(enJson.data.nombre).toBe("Culiacán");
    const texto = await correr(["municipio", "culiacan"]);
    expect(texto.codigo).toBe(0);
    expect(texto.salida).toContain("25006  Culiacán, Sinaloa");
    const muchos = await correr(["municipio", "san"]);
    expect(muchos.codigo).toBe(0);
    expect(muchos.salida).toMatch(/\.\.\. y \d+ más/);
    const todos = json(await correr(["municipio", "san", "--json"])) as unknown[];
    expect(todos.length).toBeGreaterThan(20);
    const nada = await correr(["municipio", "zzzzzz"]);
    expect(nada.codigo).toBe(1);
    expect(nada.salida).toContain('Sin municipios que coincidan con "zzzzzz"');
    expect((await correr(["municipio", "zzzzzz", "--json"])).salida.trim()).toBe("[]");
    const noExiste = await correr(["municipio", "99999"]);
    expect(noExiste.codigo).toBe(1);
    expect(noExiste.errores).toMatch(/^mexicoapi: 404/);
  });

  it("banco por código, inexistente y en JSON", async () => {
    const c = await correr(["banco", "002"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("002  BANAMEX");
    expect(c.salida).toContain("Situación: activo");
    const enJson = json(await correr(["banco", "002", "--json"])) as { data: { codigo: string } };
    expect(enJson.data.codigo).toBe("002");
    const no = await correr(["banco", "999"]);
    expect(no.codigo).toBe(1);
    expect(no.salida).toBe("");
    expect(no.errores).toMatch(/^mexicoapi: 404/);
    expect(no.errores).not.toContain("    at ");
  });

  it("con una API que no responde, dias-habiles cae al paquete y lo avisa", async () => {
    // Un puerto local sin nadie escuchando: la conexión se rechaza al instante y no hay red real.
    const c = await correr([...DIAS, "--base", "http://127.0.0.1:1"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("2026-03-23");
    expect(c.salida).toContain("Origen: datos del paquete (la API no respondió)");
    expect(c.salida).toContain("Aviso:");
    const porEntorno = await correr(DIAS, { MEXICOAPI_BASE: "http://127.0.0.1:1" });
    expect(porEntorno.salida).toContain("la API no respondió");
  });

  it("con --base y una API que responde, dias-habiles sale de la API y banco y municipio del paquete", async () => {
    const api = await apiLocal();
    try {
      const dias = await correr([...DIAS, "--base", api.base]);
      expect(dias.codigo).toBe(0);
      expect(dias.salida).toContain("2026-03-16 + 5 días hábiles (lft): 2026-03-30");
      expect(dias.salida).toContain("Origen: API");
      expect(dias.salida).not.toContain("no respondió");
      for (const [argv, env] of [
        [["banco", "002", "--base", api.base], {}],
        [["municipio", "25006", "--base", api.base], {}],
        [["banco", "002"], { MEXICOAPI_BASE: api.base }],
      ] as const) {
        const c = await correr(argv, env);
        expect(c.codigo, argv.join(" ")).toBe(0);
        expect(c.salida, argv.join(" ")).toContain("Origen: datos del paquete, sin red");
        expect(c.salida, argv.join(" ")).not.toContain("no respondió");
      }
      // Solo dias-habiles llegó a la API: banco y municipio nunca la consultan.
      expect(api.pedidos).toEqual(["/v1/dias-habiles?autoridad=lft&desde=2026-03-16&dias=5"]);
    } finally {
      await api.cerrar();
    }
  });

  it("con una API caída, banco no dice que la API falló: nunca la consulta", async () => {
    const c = await correr(["banco", "002", "--base", "http://127.0.0.1:1"]);
    expect(c.codigo).toBe(0);
    expect(c.salida).toContain("Origen: datos del paquete, sin red");
    expect(c.salida).not.toContain("Aviso:");
  });

  it("la ayuda dice que municipio y banco salen siempre del paquete", async () => {
    expect((await correr(["--help"])).salida).toContain(
      "municipio y banco salen siempre del paquete",
    );
    for (const comando of ["municipio", "banco"]) {
      const c = await correr([comando, "--help"]);
      expect(c.salida, comando).toContain("Sale siempre de los datos del paquete");
      expect(c.salida, comando).not.toContain("--base <url>");
    }
  });

  it("sepomex resumen y cp sin catálogo salen con 1 y explican qué hacer", async () => {
    const estado = await correr(["sepomex", "resumen"]);
    expect(estado.codigo).toBe(1);
    expect(estado.salida).toContain("mexicoapi sepomex sync");
    expect((await correr(["sepomex", "resumen", "--json"])).salida.trim()).toBe("null");
    const cp = await correr(["sepomex", "cp", "80000"]);
    expect(cp.codigo).toBe(1);
    expect(cp.errores).toContain(
      "Corre `mexicoapi sepomex sync` (o `mexicoapi sepomex importar <archivo>`).",
    );
    const malo = await correr(["sepomex", "cp", "8"]);
    expect(malo.codigo).toBe(2);
    expect(malo.errores).toContain("5 dígitos");
  });

  it("sepomex importar, resumen y cp con un TXT armado en la prueba", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mexicoapi-cli-"));
    try {
      const ruta = join(dir, "CPdescarga.txt");
      await writeFile(ruta, txt());
      const importado = await correr(["sepomex", "importar", ruta]);
      expect(importado.codigo).toBe(0);
      expect(importado.errores).toContain("Correos de México");
      expect(importado.salida).toContain("Catálogo importado.");
      const estado = await correr(["sepomex", "resumen"]);
      expect(estado.codigo).toBe(0);
      expect(estado.salida).toContain("códigos postales:");
      const enJson = json(await correr(["sepomex", "resumen", "--json"])) as { origen: string };
      expect(enJson.origen).toBe("archivo");
      const cp = await correr(["sepomex", "cp", "80010"]);
      expect(cp.codigo).toBe(0);
      expect(cp.salida).toContain("80010  Culiacán, Sinaloa");
      expect(cp.salida).toContain("Jorge Almada (Colonia, Urbano)");
      const cpJson = json(await correr(["sepomex", "cp", "80010", "--json"])) as { cp: string };
      expect(cpJson.cp).toBe("80010");
      const no = await correr(["sepomex", "cp", "00001"]);
      expect(no.codigo).toBe(1);
      expect(no.salida).toContain("no está en el catálogo");
      expect((await correr(["sepomex", "cp", "00001", "--json"])).salida.trim()).toBe("null");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sepomex cp no imprime los caracteres de control del TXT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mexicoapi-cli-"));
    try {
      const ruta = join(dir, "CPdescarga.txt");
      const fila =
        "80011|Colonia\u001b[2J\u0007 Falsa|Colonia|Culiacán|Sinaloa|Culiacán Rosales|80201|25|80201||09|006|0004|Urbano|01";
      await writeFile(ruta, txt(lineasTxt([fila])));
      expect((await correr(["sepomex", "importar", ruta])).codigo).toBe(0);
      const cp = await correr(["sepomex", "cp", "80011"]);
      expect(cp.codigo).toBe(0);
      expect([...cp.salida].filter((x) => x !== "\n" && /\p{Cc}/u.test(x))).toEqual([]);
      expect(cp.salida).toContain("  Colonia [2J  Falsa (Colonia, Urbano)\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("con --json los errores salen como JSON por stderr y stdout queda vacío", async () => {
    const api = await correr(["banco", "999", "--json"]);
    expect(api.codigo).toBe(1);
    expect(api.salida).toBe("");
    expect(JSON.parse(api.errores)).toEqual({
      error: {
        status: 404,
        tipo: "no-encontrado",
        title: "Recurso no encontrado",
        detail: "No existe el banco 999.",
      },
    });
    const otro = await correr(["sepomex", "importar", "no-existe.txt", "--json"]);
    expect(otro.codigo).toBe(1);
    expect(otro.salida).toBe("");
    const cuerpo = JSON.parse(otro.errores.trimEnd().split("\n").pop() as string) as {
      error: Record<string, unknown>;
    };
    expect(Object.keys(cuerpo.error)).toEqual(["mensaje"]);
    const uso = await correr(["clabe", "--json"]);
    expect(uso.codigo).toBe(2);
    expect(uso.salida).toBe("");
    expect(JSON.parse(uso.errores)).toEqual({
      error: { mensaje: expect.stringContaining("Falta") },
    });
  });

  it("la ayuda general documenta los códigos de salida y alinea sus columnas", async () => {
    const { salida } = await correr(["--help"]);
    expect(salida).toContain("2   uso incorrecto");
    expect(salida).toContain("--dias x");
    const inicios = salida
      .split("\n")
      .map((l) => /^ {2}(?:-\S.*?|[a-z][\w-]*(?: <\w+>)?) {2,}(?=\S)/.exec(l))
      .filter((m) => m !== null)
      .map((m) => (m as RegExpExecArray)[0].length);
    expect(inicios.length).toBeGreaterThanOrEqual(13);
    expect(new Set(inicios).size).toBe(1);
  });

  it("sepomex importar de un archivo que no existe falla con un mensaje y sin traza", async () => {
    const c = await correr(["sepomex", "importar", "no-existe.txt"]);
    expect(c.codigo).toBe(1);
    expect(c.salida).toBe("");
    expect(c.errores).toMatch(/^[\s\S]*mexicoapi: /);
    expect(c.errores).not.toContain("    at ");
  });
}
