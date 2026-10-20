// Los nodos de schema.org de las páginas, en JSON-LD: el sitio en la portada y, en cada página de
// datos, su Dataset (según la guía de Google para conjuntos de datos) y sus migas.
import { URL_API } from "@mexicoapi/core/problemas";

type Nodo = Record<string, unknown>;

export const NOMBRE_SITIO = "MéxicoAPI";
export const NOMBRES_ALTERNOS: readonly string[] = Object.freeze(["mexicoapi", "México API"]);

/** La URL de la portada en la API pública, la misma de su canónica. */
export const URL_SITIO = `${URL_API}/`;

/** La URL canónica de una ruta del sitio (`/`, `/dias-inhabiles-sat/`). */
export const urlDe = (ruta: string): string => `${URL_API}${ruta}`;

/** `WebSite` y `Organization` de la portada. */
export function nodosDelSitio(): Nodo[] {
  const comun = { name: NOMBRE_SITIO, alternateName: [...NOMBRES_ALTERNOS], url: URL_SITIO };
  return [
    { "@type": "WebSite", ...comun },
    { "@type": "Organization", ...comun },
  ];
}

/** Lo que Google admite en la descripción de un Dataset. */
export const DESCRIPCION_DATASET = Object.freeze({ minimo: 50, maximo: 5000 });

const FORMATOS: Readonly<Record<string, string>> = {
  json: "application/json",
  csv: "text/csv",
};

export interface EntradaDataset {
  nombre: string;
  descripcion: string;
  /** La ruta de la página que lo describe. */
  ruta: string;
  /** Las URL de los términos de las fuentes; sin repetir. */
  licencias: readonly string[];
  /** Las publicaciones oficiales de las que sale; sin repetir. */
  fuentes: readonly string[];
  palabrasClave: readonly string[];
  coberturaTemporal: string;
  /** AAAA-MM-DD, el `as_of` de los datos. */
  modificado: string;
  /** Archivos de `/descargas/`, cada uno `.json` o `.csv`. */
  distribucion: readonly string[];
}

const unoOVarios = (valores: readonly string[]): string | string[] =>
  valores.length === 1 ? (valores[0] as string) : [...valores];

/**
 * El `Dataset` de una página. Lanza Error si la descripción no mide de 50 a 5000 caracteres, si no
 * hay distribución o si un archivo no es JSON ni CSV.
 */
export function nodoDataset(d: EntradaDataset): Nodo {
  const largo = [...d.descripcion].length;
  if (largo < DESCRIPCION_DATASET.minimo || largo > DESCRIPCION_DATASET.maximo) {
    throw new Error(
      `la descripción del Dataset ${d.nombre} debe medir de 50 a 5000 caracteres: mide ${largo}`,
    );
  }
  if (d.distribucion.length === 0) throw new Error(`el Dataset ${d.nombre} no tiene distribución`);
  const distribution = d.distribucion.map((archivo) => {
    const formato = FORMATOS[archivo.slice(archivo.lastIndexOf(".") + 1)];
    if (formato === undefined) {
      throw new Error(`la distribución de ${d.nombre} solo lleva JSON y CSV: ${archivo}`);
    }
    return {
      "@type": "DataDownload",
      contentUrl: urlDe(`/descargas/${archivo}`),
      encodingFormat: formato,
    };
  });
  const sitio = { name: NOMBRE_SITIO, url: URL_SITIO };
  return {
    "@type": "Dataset",
    name: d.nombre,
    description: d.descripcion,
    url: urlDe(d.ruta),
    license: unoOVarios(d.licencias),
    isAccessibleForFree: true,
    creator: { "@type": "Organization", ...sitio },
    keywords: [...d.palabrasClave],
    temporalCoverage: d.coberturaTemporal,
    spatialCoverage: { "@type": "Place", name: "México" },
    dateModified: d.modificado,
    isBasedOn: [...d.fuentes],
    includedInDataCatalog: { "@type": "DataCatalog", ...sitio },
    distribution,
  };
}

/** Las migas de una página, de la portada a ella, cada una con su URL canónica. */
export function nodoMigas(migas: readonly { nombre: string; ruta: string }[]): Nodo {
  return {
    "@type": "BreadcrumbList",
    itemListElement: migas.map(({ nombre, ruta }, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: nombre,
      item: urlDe(ruta),
    })),
  };
}
