import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  enlacePdfParticipantes,
  interpretarParticipantesPdf,
} from "../../../src/datasets/bancos/participantes-pdf.js";
import { ErrorDatos } from "../../../src/errores.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/bancos");
const leer = (n: string) => new Uint8Array(readFileSync(join(dir, n)));
const pdf = () => leer("participantes-spei-2026-09-23.pdf");

describe("interpretarParticipantesPdf", () => {
  it("lee fecha y total", async () => {
    const l = await interpretarParticipantesPdf(pdf());
    expect(l.actualizado_al).toBe("2026-09-23");
    expect(l.total).toBe(94);
    expect(l.filas).toHaveLength(94);
    expect(l.filas.map((f) => f.numero)).toEqual(Array.from({ length: 94 }, (_, i) => i + 1));
  });

  it("agrupa las 11 secciones con sus conteos", async () => {
    const l = await interpretarParticipantesPdf(pdf());
    const conteo = new Map<string, number>();
    for (const f of l.filas) conteo.set(f.sector, (conteo.get(f.sector) ?? 0) + 1);
    expect([...conteo]).toEqual([
      ["BANCA MÚLTIPLE", 46],
      ["BANCA DE DESARROLLO", 6],
      ["INSTITUCIONES DE FONDOS DE PAGO ELECTRÓNICO (IFPE)", 13],
      ["CASAS DE BOLSA", 9],
      ["SOCIEDADES FINANCIERAS POPULARES (SOFIPO)", 8],
      ["TRANSMISORES DE DINERO", 4],
      ["SOCIEDADES COOPERATIVAS DE AHORRO Y PRÉSTAMO (SOCAP)", 4],
      ["CÁMARA DE COMPENSACIÓN", 1],
      ["ADMINISTRADORA DE FONDOS PARA EL RETIRO (AFORE)", 1],
      ["FONDO Y FIDEICOMISO", 1],
      ["DEPÓSITO DE VALORES", 1],
    ]);
  });

  it.each([
    [
      1,
      "ACTINVER",
      "Banco Actinver, S.A., Institución de Banca Múltiple, Grupo Financiero Actinver",
    ],
    [
      13,
      "BANORTE",
      "Banco Mercantil del Norte, S.A., Institución de Banca Múltiple, Grupo Financiero Banorte",
    ],
    [
      16,
      "BARCLAYS",
      "Barclays Bank México, S.A., Institución de Banca Multiple, Grupo Financiero Barclays México",
    ],
    [24, "HEY BANCO", "Hey Banco, S.A. Institución de Banca Múltiple, Banregio Grupo Financiero"],
    [
      32,
      "KAPITAL",
      "KPTL México Bank, S.A., Institución de Banca Múltiple, Kapital México Grupo Financiero",
    ],
  ])("fila %i: %s", async (n, corto, razon) => {
    const l = await interpretarParticipantesPdf(pdf());
    const f = l.filas[n - 1];
    expect(f?.numero).toBe(n);
    expect(f?.nombre_corto).toBe(corto);
    expect(f?.razon_social).toBe(razon);
  });

  it("ignora el encabezado de tabla repetido en cada sección", async () => {
    const l = await interpretarParticipantesPdf(pdf());
    expect(l.filas.filter((f) => /NOMBRE CORTO|RAZÓN SOCIAL/u.test(f.nombre_corto))).toEqual([]);
    expect(l.filas[46]).toEqual({
      numero: 47,
      nombre_corto: "BABIEN",
      razon_social:
        "Banco del Bienestar, Sociedad Nacional de Crédito, Institución de Banca de Desarrollo",
      sector: "BANCA DE DESARROLLO",
    });
    expect(l.filas[52]?.nombre_corto).toBe("ALBO");
    expect(l.filas[93]).toEqual({
      numero: 94,
      nombre_corto: "INDEVAL",
      razon_social: "S.D. Indeval, S.A. de C.V. Institución para el Depósito de Valores",
      sector: "DEPÓSITO DE VALORES",
    });
  });

  it("rechaza bytes que no son un PDF", async () => {
    await expect(interpretarParticipantesPdf(new TextEncoder().encode("hola"))).rejects.toThrow(
      ErrorDatos,
    );
  });

  it("rechaza un PDF sin el encabezado", async () => {
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      "<< /Length 38 >>\nstream\nBT /F1 12 Tf 20 100 Td (Hola) Tj ET\nendstream",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let s = "%PDF-1.4\n";
    objs.forEach((o, i) => {
      s += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    s += "trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n";
    await expect(interpretarParticipantesPdf(new TextEncoder().encode(s))).rejects.toThrow(
      ErrorDatos,
    );
  });
});

describe("enlacePdfParticipantes", () => {
  const base = "https://www.banxico.org.mx/servicios/spei_-informacion-banco-mex.html";

  it("encuentra el enlace de la página real", () => {
    const html = new TextDecoder().decode(leer("spei-informacion.html"));
    expect(enlacePdfParticipantes(html, base)).toBe(
      "https://www.banxico.org.mx/servicios/d/{C24C7DBC-9ABF-6F41-DA38-561CEB1401B3}.pdf",
    );
  });

  it("acepta cualquier orden de atributos y &amp;", () => {
    const html = `<a href="/x?a=1&amp;b=2" class="c" title="Participantes">p</a>`;
    expect(enlacePdfParticipantes(html, base)).toBe("https://www.banxico.org.mx/x?a=1&b=2");
  });

  it("falla sin el enlace", () => {
    expect(() => enlacePdfParticipantes(`<a title="Otro" href="/a.pdf">x</a>`, base)).toThrow(
      ErrorDatos,
    );
  });
});
