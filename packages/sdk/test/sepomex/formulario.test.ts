import { describe, expect, it } from "vitest";
import { SepomexError, type TipoErrorSepomex } from "../../src/sepomex/error.js";
import { cuerpoDeDescarga, leerFormulario } from "../../src/sepomex/formulario.js";
import { pagina } from "./ayudas.js";

const URL_PAGINA =
  "https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx";

function falla(accion: () => unknown, tipo: TipoErrorSepomex, mensaje: RegExp): void {
  let error: unknown;
  try {
    accion();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(SepomexError);
  expect((error as SepomexError).tipo).toBe(tipo);
  expect((error as SepomexError).message).toMatch(mensaje);
}

describe("leerFormulario", () => {
  it("toma los campos ocultos en orden, con sus entidades decodificadas", () => {
    const f = leerFormulario(pagina(), URL_PAGINA);
    expect(f.ocultos).toEqual([
      ["__VIEWSTATE", "/wEPDwUINzcwOTQyOTgPZBYCAgEPZBYCAgEPZBYGAgEPDxYCHgRUZXh0+/="],
      ["__VIEWSTATEGENERATOR", "BE1A6D2E"],
      ["__EVENTVALIDATION", "/wEWJwLdqZ3eDwLWk4iCCgLWk4SCCgLW&k4CCCg=="],
    ]);
    expect(f.accion).toBe(URL_PAGINA);
    expect(f.boton).toEqual([
      ["btnDescarga.x", "1"],
      ["btnDescarga.y", "1"],
    ]);
  });

  it("incluye cualquier otro campo oculto que traiga la página", () => {
    const f = leerFormulario(
      pagina({ ocultos: { __EVENTTARGET: "", __LASTFOCUS: "a&#39;b&quot;c&#x41;&lt;&gt;&nbsp;" } }),
      URL_PAGINA,
    );
    expect(f.ocultos.slice(3)).toEqual([
      ["__EVENTTARGET", ""],
      ["__LASTFOCUS", "a'b\"cA<>&nbsp;"],
    ]);
  });

  it("deja como texto una entidad numérica fuera de Unicode", () => {
    const f = leerFormulario(
      pagina({ ocultos: { __VIEWSTATE: "a&#x110000;b&#99999999;c&#x10FFFF;" } }),
      URL_PAGINA,
    );
    expect(f.ocultos[0]).toEqual(["__VIEWSTATE", "a&#x110000;b&#99999999;c\u{10FFFF}"]);
  });

  it("lee atributos con comillas simples o sin comillas", () => {
    const html = pagina({
      sin: "__VIEWSTATE",
      extra: "<INPUT type=hidden name='__VIEWSTATE' value=abc>",
    });
    expect(leerFormulario(html, URL_PAGINA).ocultos.find(([n]) => n === "__VIEWSTATE")).toEqual([
      "__VIEWSTATE",
      "abc",
    ]);
  });

  it("ignora los campos de otro formulario de la página", () => {
    const otro = `<form action="/buscar"><input type="hidden" name="q" value="x"></form>`;
    const f = leerFormulario(
      pagina().replace('<body ms_positioning="GridLayout">', `<body>${otro}`),
      URL_PAGINA,
    );
    expect(f.ocultos.map(([n]) => n)).not.toContain("q");
  });

  it("resuelve el action contra la página y exige el mismo origen", () => {
    expect(leerFormulario(pagina({ accion: "./Otra.aspx?x=1" }), URL_PAGINA).accion).toBe(
      "https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/Otra.aspx?x=1",
    );
    expect(leerFormulario(pagina({ accion: "" }), URL_PAGINA).accion).toBe(URL_PAGINA);
    expect(leerFormulario(pagina().replace(/ action="[^"]*"/, ""), URL_PAGINA).accion).toBe(
      URL_PAGINA,
    );
    falla(
      () => leerFormulario(pagina({ accion: "https://otro.example/x" }), URL_PAGINA),
      "pagina-inesperada",
      /envía el formulario a otro sitio/,
    );
  });

  it("acepta el botón como submit", () => {
    const html = pagina({
      sin: "btnDescarga",
      extra: `<input type="submit" name="btnDescarga" value="Descargar" />`,
    });
    expect(leerFormulario(html, URL_PAGINA).boton).toEqual([["btnDescarga", "Descargar"]]);
    const sinValor = pagina({
      sin: "btnDescarga",
      extra: `<input type="submit" name="btnDescarga">`,
    });
    expect(leerFormulario(sinValor, URL_PAGINA).boton).toEqual([["btnDescarga", ""]]);
  });

  it("envía vacío un campo oculto sin value", () => {
    const html = pagina({ extra: `<input type="hidden" name="__EVENTARGUMENT" />` });
    expect(leerFormulario(html, URL_PAGINA).ocultos.at(-1)).toEqual(["__EVENTARGUMENT", ""]);
  });

  it.each([
    ["cboEdo", /falta el formulario de descarga/],
    ["rblTipo", /falta la opción TXT \(rblTipo\)/],
    ["btnDescarga", /falta el botón de descarga \(btnDescarga\)/],
    ["__VIEWSTATE", /falta el campo oculto __VIEWSTATE/],
  ] as const)("falla si la página no trae %s", (sin, mensaje) => {
    falla(() => leerFormulario(pagina({ sin }), URL_PAGINA), "pagina-inesperada", mensaje);
  });

  it("falla si no está la opción de todo el país", () => {
    const html = pagina().replace('value="00"', 'value="99"');
    falla(() => leerFormulario(html, URL_PAGINA), "pagina-inesperada", /Todos \(cboEdo=00\)/);
  });

  it("falla con una página que pide CAPTCHA, sin intentar resolverlo", () => {
    const html = pagina({ extra: '<div class="g-recaptcha" data-sitekey="x"></div>' });
    falla(() => leerFormulario(html, URL_PAGINA), "bloqueado", /CAPTCHA/);
    falla(() => leerFormulario("<html>Turnstile</html>", URL_PAGINA), "bloqueado", /CAPTCHA/);
  });

  it("lee la fecha de última actualización", () => {
    expect(leerFormulario(pagina(), URL_PAGINA).as_of).toBe("2026-10-17");
    const otra = (texto: string) =>
      leerFormulario(pagina().replace("Octubre 17 de 2026", texto), URL_PAGINA).as_of;
    expect(otra("Septiembre 5 de 2026")).toBe("2026-09-05");
    expect(otra("setiembre 30 de 2025")).toBe("2025-09-30");
    expect(otra("ENERO 1 de 2027")).toBe("2027-01-01");
    expect(otra("Brumario 3 de 2026")).toBeNull();
    expect(otra("Febrero 30 de 2026")).toBeNull();
    expect(
      leerFormulario(pagina().replace(/<span id="lblfec".*<\/span>/, ""), URL_PAGINA).as_of,
    ).toBeNull();
  });
});

describe("cuerpoDeDescarga", () => {
  it("envía los ocultos, todo el país, el TXT y el botón, codificados como formulario", () => {
    const cuerpo = cuerpoDeDescarga(leerFormulario(pagina(), URL_PAGINA));
    expect(cuerpo).toBe(
      [
        "__VIEWSTATE=%2FwEPDwUINzcwOTQyOTgPZBYCAgEPZBYCAgEPZBYGAgEPDxYCHgRUZXh0%2B%2F%3D",
        "__VIEWSTATEGENERATOR=BE1A6D2E",
        "__EVENTVALIDATION=%2FwEWJwLdqZ3eDwLWk4iCCgLWk4SCCgLW%26k4CCCg%3D%3D",
        "cboEdo=00",
        "rblTipo=txt",
        "btnDescarga.x=1",
        "btnDescarga.y=1",
      ].join("&"),
    );
    expect(new URLSearchParams(cuerpo).get("__EVENTVALIDATION")).toBe(
      "/wEWJwLdqZ3eDwLWk4iCCgLWk4SCCgLW&k4CCCg==",
    );
  });
});
