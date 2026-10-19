/** Una ruta de la API con lo que responde, cuando el nombre del dataset no basta para elegirla. */
export interface RutaCatalogo {
  ruta: string;
  nota: string;
}

/**
 * Nombre para personas y ruta principal de la API de cada dataset del registro. La ruta trae
 * todo parámetro obligatorio; lo que hay que llenar va entre llaves (`{fecha}`, `{anio}`).
 */
export interface EntradaCatalogo {
  nombre: string;
  ruta: string;
  /** Qué responde la ruta principal, si hay otras del mismo dataset con las que se confunde. */
  nota?: string;
  /** Las demás rutas del dataset, después de la principal. */
  otras?: readonly RutaCatalogo[];
}

export const CATALOGO: Readonly<Record<string, EntradaCatalogo>> = {
  "inegi.estados": { nombre: "Estados", ruta: "/v1/estados" },
  "inegi.municipios": { nombre: "Municipios", ruta: "/v1/municipios" },
  bancos: { nombre: "Bancos y participantes del SPEI", ruta: "/v1/bancos" },
  // Para un pago la que aplica es `operacion`: `publicado` en un día sin publicación es un 404.
  "tipo-cambio.fix": {
    nombre: "Tipo de cambio FIX",
    ruta: "/v1/tipo-cambio/fix?operacion={fecha}",
    nota: "el que aplica a un pago o una operación de esa fecha",
    otras: [
      { ruta: "/v1/tipo-cambio/fix/ultimo", nota: "la publicación más reciente" },
      { ruta: "/v1/tipo-cambio/fix?publicado={fecha}", nota: "el que publicó el DOF ese día" },
    ],
  },
  udis: { nombre: "UDIS", ruta: "/v1/udis?fecha={fecha}" },
  "dias-inhabiles.cnbv": {
    nombre: "Días inhábiles de la CNBV",
    ruta: "/v1/dias-inhabiles?autoridad=cnbv&anio={anio}",
  },
  "dias-inhabiles.sat": {
    nombre: "Días inhábiles del SAT",
    ruta: "/v1/dias-inhabiles?autoridad=sat&anio={anio}",
  },
  "constantes.uma": { nombre: "UMA", ruta: "/v1/constantes/uma?fecha={fecha}" },
  "constantes.salario-minimo": {
    nombre: "Salario mínimo",
    ruta: "/v1/constantes/salario-minimo/{anio}",
  },
  "isr.tarifas": { nombre: "Tarifas de ISR", ruta: "/v1/isr/tarifa/{periodo}/{anio}" },
};

/** Un dataset que todavía no está en el catálogo se muestra con su id y sin ruta. */
export function describir(id: string): {
  nombre: string;
  ruta: string | null;
  nota?: string;
  otras?: readonly RutaCatalogo[];
} {
  const entrada = Object.hasOwn(CATALOGO, id) ? CATALOGO[id] : undefined;
  return entrada === undefined ? { nombre: id, ruta: null } : { ...entrada };
}

/** Todas las rutas de una entrada, la principal primero. */
export const rutasDe = (entrada: EntradaCatalogo): string[] => [
  entrada.ruta,
  ...(entrada.otras ?? []).map((o) => o.ruta),
];
