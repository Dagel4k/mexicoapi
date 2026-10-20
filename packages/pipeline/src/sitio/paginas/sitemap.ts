import { esFechaIsoValida } from "@mexicoapi/core";
import { URL_API } from "@mexicoapi/core/problemas";
import { esRutaDePagina } from "./html.js";

/** Una página que se indexa y la fecha de su última modificación. */
export interface PaginaSitemap {
  /** La misma ruta que recibe `documento()`: `/`, `/estado/`. */
  ruta: string;
  /** AAAA-MM-DD. */
  lastmod: string;
}

/**
 * `sitemap.xml`: cada página con su URL canónica, la de la API pública (también en staging). Las
 * rutas solo llevan letras minúsculas, dígitos, `.`, `_`, `-` y `/`, así que no hay nada que
 * escapar en el XML.
 */
export function archivoSitemap(paginas: readonly PaginaSitemap[]): string {
  if (paginas.length === 0) throw new Error("el sitemap no tiene ninguna página");
  const vistas = new Set<string>();
  const urls = paginas.map(({ ruta, lastmod }) => {
    if (!esRutaDePagina(ruta)) throw new Error(`ruta de página inválida en el sitemap: ${ruta}`);
    if (!esFechaIsoValida(lastmod)) throw new Error(`lastmod inválido en ${ruta}: ${lastmod}`);
    if (vistas.has(ruta)) throw new Error(`página repetida en el sitemap: ${ruta}`);
    vistas.add(ruta);
    return `<url><loc>${URL_API}${ruta}</loc><lastmod>${lastmod}</lastmod></url>\n`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("")}</urlset>
`;
}

/** La fecha más reciente de una lista de fechas AAAA-MM-DD. */
export function fechaMasReciente(fechas: readonly string[]): string {
  if (fechas.length === 0) throw new Error("no hay ninguna fecha");
  for (const fecha of fechas) {
    if (!esFechaIsoValida(fecha)) throw new Error(`fecha inválida: ${fecha}`);
  }
  return fechas.reduce((mayor, fecha) => (fecha > mayor ? fecha : mayor));
}
