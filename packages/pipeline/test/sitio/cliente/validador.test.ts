// El validador de /validar-clabe/: corre en el navegador con el catálogo de /descargas/bancos.json
// y debe dar lo mismo que `validarClabe` del núcleo con ese catálogo.
import { readFileSync } from "node:fs";
import { type BancoClabe, validarClabe } from "@mexicoapi/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  catalogoDeBancos,
  instalarValidador,
  mensajeClabe,
  RUTA_CATALOGO_BANCOS,
  validarClabeLocal,
} from "../../../src/sitio/cliente/sitio.js";

const BANCOS_JSON = readFileSync(
  new URL("../../../../../data/bancos/bancos.json", import.meta.url),
  "utf8",
);
const catalogo = catalogoDeBancos(JSON.parse(BANCOS_JSON));
const nucleo = new Map<string, BancoClabe>(
  [...catalogo].map(([codigo, { nombre_corto, activo }]) => [
    codigo,
    { codigo, nombre_corto, activo } as BancoClabe,
  ]),
);

/** La CLABE de 18 dígitos con su dígito verificador, para armar casos válidos. */
function conDigito(primeros17: string): string {
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += Number(primeros17[i]) * ([3, 7, 1][i % 3] as number);
  return `${primeros17}${(10 - (suma % 10)) % 10}`;
}

describe("validarClabeLocal", () => {
  it("valida la CLABE de los ejemplos con el catálogo", () => {
    const r = validarClabeLocal("002010077777777771", catalogo);
    expect(r).toMatchObject({ valido: true, errores: [], banco: { codigo: "002" } });
    expect(r.banco?.nombre_corto).toBe("BANAMEX");
  });

  it.each([
    ["", ["vacio"]],
    ["00201007777777777A", ["caracteres"]],
    ["0020100777777777", ["longitud"]],
    ["999010077777777774", ["banco"]],
    ["002010077777777772", ["digito_verificador"]],
  ])("%j da %j", (clabe, errores) => {
    const r = validarClabeLocal(clabe, catalogo);
    expect(r.valido).toBe(false);
    expect(r.errores).toEqual(errores);
  });

  it("ignora espacios y guiones como el núcleo", () => {
    expect(validarClabeLocal(" 002-0100 7777-7777 771 ", catalogo).valido).toBe(true);
  });

  it("sin catálogo no revisa el banco y lo dice", () => {
    const r = validarClabeLocal("999010077777777774", null);
    expect(r).toMatchObject({ valido: true, banco: null, bancoRevisado: false });
  });

  it("coincide con validarClabe del núcleo con el mismo catálogo", () => {
    const codigos = [...catalogo.keys(), "000", "999", "12A"];
    const clabe = fc
      .tuple(fc.constantFrom(...codigos), fc.stringMatching(/^[0-9]{14}$/))
      .map(([banco, resto]) => conDigito(`${banco}${resto}`.slice(0, 17)));
    const casos = fc.oneof(
      clabe,
      clabe.map((c) => `${c.slice(0, 17)}${(Number(c[17]) + 1) % 10}`),
      fc.string({ maxLength: 24 }),
      fc.stringMatching(/^[0-9  \t-]{0,24}$/),
      fc.stringMatching(/^[0-9]{15,20}$/),
    );
    fc.assert(
      fc.property(casos, (texto) => {
        const local = validarClabeLocal(texto, catalogo);
        const base = validarClabe(texto, { bancos: nucleo });
        expect(local.valido).toBe(base.valido);
        expect(local.errores).toEqual(base.errores);
        expect(local.banco?.codigo ?? null).toBe(base.detalle?.banco?.codigo ?? null);
        expect(local.banco?.nombre_corto ?? null).toBe(base.detalle?.banco?.nombre_corto ?? null);
        expect(local.banco?.activo ?? null).toBe(base.detalle?.banco?.activo ?? null);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("catalogoDeBancos", () => {
  it("toma código, nombre y estado de cada banco", () => {
    const m = catalogoDeBancos([
      { codigo: "012", nombre_corto: "BBVA MEXICO", activo: true, otro: 1 },
      { codigo: "044", nombre_corto: "X", activo: false },
    ]);
    expect([...m]).toEqual([
      ["012", { codigo: "012", nombre_corto: "BBVA MEXICO", activo: true }],
      ["044", { codigo: "044", nombre_corto: "X", activo: false }],
    ]);
  });

  it.each([
    [{}],
    [[null]],
    [[{ codigo: "12", nombre_corto: "X", activo: true }]],
    [[{ codigo: "012", nombre_corto: 3, activo: true }]],
    [[{ codigo: "012", nombre_corto: "X", activo: "si" }]],
  ])("rechaza %j", (cuerpo) => {
    expect(() => catalogoDeBancos(cuerpo)).toThrow(/catálogo/);
  });
});

describe("mensajeClabe", () => {
  it("explica cada falla y avisa que la cuenta no se confirma", () => {
    const ver = (c: string, cat: typeof catalogo | null = catalogo) =>
      mensajeClabe(validarClabeLocal(c, cat));
    expect(ver("")).toMatchObject({ ok: false, texto: "Escribe una CLABE." });
    expect(ver("12x").texto).toMatch(/solo lleva dígitos/);
    expect(ver("123").texto).toMatch(/18 dígitos.*3/);
    expect(ver("999010077777777774").texto).toMatch(/999.*no está en el catálogo/);
    expect(ver("002010077777777772").texto).toMatch(/dígito verificador.*1/);
    const bien = ver("002010077777777771");
    expect(bien.ok).toBe(true);
    expect(bien.texto).toMatch(/BANAMEX/);
    expect(bien.texto).toMatch(/no confirma que la cuenta exista/);
    expect(ver("999010077777777774", null).texto).toMatch(/banco no se revisó/);
  });

  it("marca un banco inactivo", () => {
    const inactivo = [...catalogo.values()].find((b) => !b.activo);
    expect(inactivo).toBeDefined();
    const c = conDigito(`${inactivo?.codigo}01007777777777`.slice(0, 17));
    expect(mensajeClabe(validarClabeLocal(c, catalogo)).texto).toMatch(/ya no aparece/);
  });
});

type Oyente = (e: { preventDefault(): void }) => void;

class Campo {
  value = "";
  hidden = true;
  textContent: string | null = "";
  className = "";
  oyentes = new Map<string, Oyente>();
  addEventListener(tipo: string, oyente: Oyente) {
    this.oyentes.set(tipo, oyente);
  }
}

function pagina() {
  return {
    formulario: new Campo(),
    entrada: new Campo(),
    resultado: new Campo(),
    estado: new Campo(),
  };
}

describe("instalarValidador", () => {
  it("pide solo el catálogo, sin la CLABE, y valida sin más red", async () => {
    const p = pagina();
    const pedidas: string[] = [];
    const pedir = async (url: string) => {
      pedidas.push(url);
      return new Response(BANCOS_JSON, { status: 200 });
    };
    await instalarValidador(p, pedir);
    expect(pedidas).toEqual([RUTA_CATALOGO_BANCOS]);
    expect(RUTA_CATALOGO_BANCOS).toBe("/descargas/bancos.json");
    expect(p.formulario.hidden).toBe(false);
    p.entrada.value = "002010077777777771";
    let evitado = false;
    p.formulario.oyentes.get("submit")?.({ preventDefault: () => (evitado = true) });
    expect(evitado).toBe(true);
    expect(p.resultado.textContent).toMatch(/BANAMEX/);
    expect(p.resultado.className).toBe("ok");
    expect(pedidas).toEqual([RUTA_CATALOGO_BANCOS]);
    p.entrada.value = "002010077777777772";
    p.formulario.oyentes.get("submit")?.({ preventDefault() {} });
    expect(p.resultado.className).toBe("mal");
  });

  it.each([
    ["responde con error", async () => new Response("no", { status: 500 })],
    ["falla la red", async () => Promise.reject(new TypeError("red"))],
    ["no es JSON", async () => new Response("<html>", { status: 200 })],
    ["no es un catálogo", async () => new Response("{}", { status: 200 })],
  ])("si el catálogo %s, valida sin revisar el banco", async (_, pedir) => {
    const p = pagina();
    await instalarValidador(p, pedir);
    expect(p.estado.textContent).toMatch(/No se pudo cargar el catálogo de bancos/);
    p.entrada.value = "999010077777777774";
    p.formulario.oyentes.get("submit")?.({ preventDefault() {} });
    expect(p.resultado.textContent).toMatch(/banco no se revisó/);
  });
});
