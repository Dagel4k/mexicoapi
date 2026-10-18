// Pruebas de la CLI que corren igual con la lógica (sobre src) y con el binario construido (dist).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { txt } from "../sepomex/ayudas.js";

export interface Corrida {
  codigo: number;
  salida: string;
  errores: string;
}

export type Correr = (
  argv: readonly string[],
  env?: Record<string, string | undefined>,
) => Promise<Corrida>;

const COMANDOS = ["clabe", "rfc", "curp", "nss", "dias-habiles", "municipio", "banco", "sepomex"];
const json = (c: Corrida): unknown => JSON.parse(c.salida);
const DIAS = ["dias-habiles", "--desde", "2026-03-16", "--dias", "5"];

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
    for (const sub of ["sync", "importar", "cp", "estado"]) {
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
      [[...DIAS, "--autoridad", "xx"], /Autoridad desconocida/],
      [["clabe", "002", "--desde", "2026-01-01"], /--desde no aplica a "clabe"/],
      [["clabe", "002", "--base", "http://x"], /--base no aplica/],
      [["clabe", "--no-existe"], /no-existe/],
      [["sepomex"], /Falta el subcomando/],
      [["sepomex", "inventado"], /Subcomando de "sepomex" desconocido: inventado/],
      [["sepomex", "sync", "x"], /no recibe argumentos/],
      [["sepomex", "estado", "x"], /no recibe argumentos/],
      [["sepomex", "importar"], /Falta la ruta/],
      [["sepomex", "cp"], /Falta el código postal/],
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
    const malDias = await correr(["dias-habiles", "--desde", "2026-03-16", "--dias", "cinco"]);
    expect(malDias.codigo).toBe(1);
    expect(malDias.errores).toContain("--dias debe ser un entero");
    const malFecha = await correr(["dias-habiles", "--desde", "ayer", "--dias", "5"]);
    expect(malFecha.codigo).toBe(1);
    expect(malFecha.errores).toContain("fecha");
    const sat = await correr([...DIAS, "--autoridad", "sat"]);
    expect(sat.codigo).toBe(1);
    expect(sat.errores).toContain("lft");
    const lejos = await correr(["dias-habiles", "--desde", "2101-01-04", "--dias", "5"]);
    expect(lejos.codigo).toBe(1);
    expect(lejos.salida).toBe("");
    expect(lejos.errores).toMatch(/^mexicoapi: /);
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

  it("sepomex estado y cp sin catálogo salen con 1 y explican qué hacer", async () => {
    const estado = await correr(["sepomex", "estado"]);
    expect(estado.codigo).toBe(1);
    expect(estado.salida).toContain("mexicoapi sepomex sync");
    expect((await correr(["sepomex", "estado", "--json"])).salida.trim()).toBe("null");
    const cp = await correr(["sepomex", "cp", "80000"]);
    expect(cp.codigo).toBe(1);
    expect(cp.errores).toContain("sepomex sync");
    const malo = await correr(["sepomex", "cp", "8"]);
    expect(malo.codigo).toBe(1);
    expect(malo.errores).toContain("5 dígitos");
  });

  it("sepomex importar, estado y cp con un TXT armado en la prueba", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mexicoapi-cli-"));
    try {
      const ruta = join(dir, "CPdescarga.txt");
      await writeFile(ruta, txt());
      const importado = await correr(["sepomex", "importar", ruta]);
      expect(importado.codigo).toBe(0);
      expect(importado.errores).toContain("Correos de México");
      expect(importado.salida).toContain("Catálogo importado.");
      const estado = await correr(["sepomex", "estado"]);
      expect(estado.codigo).toBe(0);
      expect(estado.salida).toContain("códigos postales:");
      const enJson = json(await correr(["sepomex", "estado", "--json"])) as { origen: string };
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

  it("sepomex importar de un archivo que no existe falla con un mensaje y sin traza", async () => {
    const c = await correr(["sepomex", "importar", "no-existe.txt"]);
    expect(c.codigo).toBe(1);
    expect(c.salida).toBe("");
    expect(c.errores).toMatch(/^[\s\S]*mexicoapi: /);
    expect(c.errores).not.toContain("    at ");
  });
}
