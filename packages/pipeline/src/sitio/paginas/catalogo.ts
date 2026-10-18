/** Nombre para personas y ruta principal de la API de cada dataset del registro. */
export interface EntradaCatalogo {
  nombre: string;
  ruta: string;
}

export const CATALOGO: Readonly<Record<string, EntradaCatalogo>> = {
  "inegi.estados": { nombre: "Estados", ruta: "/v1/estados" },
  "inegi.municipios": { nombre: "Municipios", ruta: "/v1/municipios" },
  bancos: { nombre: "Bancos y participantes del SPEI", ruta: "/v1/bancos" },
  "tipo-cambio.fix": { nombre: "Tipo de cambio FIX", ruta: "/v1/tipo-cambio/fix" },
  udis: { nombre: "UDIS", ruta: "/v1/udis" },
  "dias-inhabiles.cnbv": {
    nombre: "Días inhábiles de la CNBV",
    ruta: "/v1/dias-inhabiles?autoridad=cnbv",
  },
  "dias-inhabiles.sat": {
    nombre: "Días inhábiles del SAT",
    ruta: "/v1/dias-inhabiles?autoridad=sat",
  },
  "constantes.uma": { nombre: "UMA", ruta: "/v1/constantes/uma" },
  "constantes.salario-minimo": {
    nombre: "Salario mínimo",
    ruta: "/v1/constantes/salario-minimo/{anio}",
  },
  "isr.tarifas": { nombre: "Tarifas de ISR", ruta: "/v1/isr/tarifa/{periodo}/{anio}" },
};

/** Un dataset que todavía no está en el catálogo se muestra con su id y sin ruta. */
export function describir(id: string): { nombre: string; ruta: string | null } {
  const entrada = Object.hasOwn(CATALOGO, id) ? CATALOGO[id] : undefined;
  return entrada === undefined ? { nombre: id, ruta: null } : { ...entrada };
}
