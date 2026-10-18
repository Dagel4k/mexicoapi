import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { permitidoPorRobots } from "../src/robots.js";

const AG = "mexicoapi-bot/1 (+https://github.com/Dagel4k/mexicoapi)";
const banxico = readFileSync(new URL("./fixtures/banxico-robots.txt", import.meta.url), "utf8");

describe("permitidoPorRobots", () => {
  it("con el robots.txt real de Banxico permite el CEP y niega /dyn", () => {
    // El original llega con CRLF y el fixture lo conserva.
    expect(banxico).toContain("\r\n");
    expect(permitidoPorRobots(banxico, AG, "/cep/instituciones.do?fecha=17-10-2026")).toBe(true);
    expect(permitidoPorRobots(banxico, AG, "/dyn/x")).toBe(false);
  });

  it("el grupo específico del bot tiene prioridad sobre *", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: MexicoAPI-Bot\nDisallow: /privado\n";
    expect(permitidoPorRobots(txt, AG, "/publico")).toBe(true);
    expect(permitidoPorRobots(txt, AG, "/privado/a")).toBe(false);
  });

  it("sin grupo propio usa *", () => {
    const txt = "User-agent: otro\nDisallow: /\n\nUser-agent: *\nDisallow: /x\n";
    expect(permitidoPorRobots(txt, AG, "/x/y")).toBe(false);
    expect(permitidoPorRobots(txt, AG, "/y")).toBe(true);
  });

  it("sin grupo aplicable permite todo", () => {
    expect(permitidoPorRobots("User-agent: otro\nDisallow: /\n", AG, "/a")).toBe(true);
    expect(permitidoPorRobots("", AG, "/a")).toBe(true);
  });

  it("en el empate Allow/Disallow gana Allow", () => {
    const txt = "User-agent: *\nDisallow: /a\nAllow: /a\n";
    expect(permitidoPorRobots(txt, AG, "/a/b")).toBe(true);
  });

  it("gana el prefijo más largo", () => {
    const txt = "User-agent: *\nDisallow: /a\nAllow: /a/pub\n";
    expect(permitidoPorRobots(txt, AG, "/a/pub/x")).toBe(true);
    expect(permitidoPorRobots(txt, AG, "/a/otro")).toBe(false);
    const inv = "User-agent: *\nAllow: /a\nDisallow: /a/priv\n";
    expect(permitidoPorRobots(inv, AG, "/a/priv/x")).toBe(false);
  });

  it("un Disallow vacío permite todo", () => {
    expect(permitidoPorRobots("User-agent: *\nDisallow:\n", AG, "/a")).toBe(true);
  });

  it("ignora comentarios, líneas inválidas y agentes apilados", () => {
    const txt =
      "# nota\nUser-agent: x\nUser-agent: mexicoapi-bot # yo\nbasura\nDisallow: /z # no\n";
    expect(permitidoPorRobots(txt, AG, "/z")).toBe(false);
  });
});
