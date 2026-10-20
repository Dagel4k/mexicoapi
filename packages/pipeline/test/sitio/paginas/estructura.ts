import { URL_API } from "@mexicoapi/core/problemas";
import { expect } from "vitest";

/** Las etiquetas de HTML que no se cierran. */
const VACIAS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

/** El inverso de escaparHtml, escrito aparte para no probar la función contra sí misma. */
export const desescapar = (texto: string): string =>
  texto.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ENTIDADES[e] as string);

/** Cada etiqueta de apertura con sus atributos, en orden. */
const etiquetas = (html: string): string[] =>
  [...html.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]);

/** Verificador mínimo de pila: cada etiqueta no vacía se cierra, y en orden. */
export function problemasDeEtiquetas(html: string): string[] {
  const pila: string[] = [];
  const problemas: string[] = [];
  for (const [, cierre, nombre] of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)) {
    const etiqueta = (nombre as string).toLowerCase();
    if (VACIAS.has(etiqueta)) {
      if (cierre === "/") problemas.push(`</${etiqueta}> cierra una etiqueta vacía`);
      continue;
    }
    if (cierre === "") {
      pila.push(etiqueta);
      continue;
    }
    const abierta = pila.pop();
    if (abierta !== etiqueta) problemas.push(`</${etiqueta}> cierra <${abierta ?? "nada"}>`);
  }
  for (const etiqueta of pila) problemas.push(`<${etiqueta}> sin cerrar`);
  return problemas;
}

/** Los valores de un atributo en todo el documento, ya desescapados. */
export const atributos = (html: string, nombre: string): string[] =>
  [...html.matchAll(new RegExp(`\\s${nombre}="([^"]*)"`, "g"))].map((m) =>
    desescapar(m[1] as string),
  );

const APERTURA_JSON_LD = '<script type="application/ld+json">';

/** Los nodos del JSON-LD de la página (`@graph`), o una lista vacía si no tiene. */
export function datosEstructurados(html: string): Record<string, unknown>[] {
  const inicio = html.indexOf(APERTURA_JSON_LD);
  if (inicio === -1) return [];
  const cuerpo = html.slice(inicio + APERTURA_JSON_LD.length, html.indexOf("</script>", inicio));
  const documento = JSON.parse(cuerpo) as { "@context"?: unknown; "@graph"?: unknown };
  expect(documento["@context"]).toBe("https://schema.org");
  expect(Array.isArray(documento["@graph"])).toBe(true);
  return documento["@graph"] as Record<string, unknown>[];
}

/** Lo que toda página del sitio cumple: estructura, accesibilidad básica y la CSP. */
export function esperarDocumentoValido(html: string): void {
  expect(html.startsWith('<!doctype html>\n<html lang="es-MX">\n<head>\n')).toBe(true);
  expect(html).toMatch(/<head>\s*<meta charset="utf-8">/);
  expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  expect(html).toMatch(/<title>[^<]+<\/title>/);
  expect(html).toMatch(/<meta name="description" content="[^"]+">/);
  expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  expect(problemasDeEtiquetas(html)).toEqual([]);

  // La CSP no permite estilos ni scripts en línea.
  expect(html).not.toMatch(/<style/i);
  for (const etiqueta of etiquetas(html)) {
    expect(etiqueta).not.toMatch(/\sstyle\s*=/i);
    expect(etiqueta).not.toMatch(/\son[a-z]+\s*=/i);
  }
  // Cada `<script` abre un módulo del mismo origen sin cuerpo, o el bloque de datos JSON-LD, que
  // no se ejecuta y no trae `<` ni `>` con los que se cierre o abra otra etiqueta. Se revisa desde
  // cada aparición, sin depender de cómo venga escrita la etiqueta de cierre.
  const minusculas = html.toLowerCase();
  for (let i = minusculas.indexOf("<script"); i !== -1; i = minusculas.indexOf("<script", i + 1)) {
    const resto = html.slice(i);
    if (resto.startsWith(APERTURA_JSON_LD)) {
      const cuerpo = resto.slice(APERTURA_JSON_LD.length, resto.indexOf("</script>"));
      expect(cuerpo).not.toMatch(/[<>]/);
      expect(() => JSON.parse(cuerpo)).not.toThrow();
      continue;
    }
    expect(resto).toMatch(/^<script type="module" src="\/[^/"][^"]*"><\/script>/);
  }
  expect(html.split(APERTURA_JSON_LD).length).toBeLessThanOrEqual(2);
  // Ningún recurso externo: lo que carga la página es del mismo origen. La canónica no carga nada
  // y apunta a la API pública, la misma desde cualquier despliegue.
  for (const src of atributos(html, "src")) expect(src).toMatch(/^\/(?!\/)/);
  const canonicas = [...html.matchAll(/<link rel="canonical" href="([^"]*)">/g)];
  expect(canonicas.length).toBeLessThanOrEqual(1);
  for (const [, href] of canonicas) expect(href?.startsWith(`${URL_API}/`), href).toBe(true);
  for (const [link] of html.matchAll(/<link\b[^>]*>/g)) {
    if (!link.startsWith('<link rel="canonical"')) expect(link).toMatch(/\shref="\/(?!\/)/);
  }

  // Los id son únicos y cada referencia interna apunta a uno que existe.
  const ids = atributos(html, "id");
  expect(new Set(ids).size).toBe(ids.length);
  for (const href of atributos(html, "href").filter((h) => h.startsWith("#"))) {
    expect(ids, href).toContain(href.slice(1));
  }
  for (const id of atributos(html, "aria-labelledby")) expect(ids, id).toContain(id);
}
