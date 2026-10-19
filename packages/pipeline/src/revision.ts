// La decisión de revisión de `actualizar`, repetida sobre dos versiones de data/: la de main y la
// de un PR del bot. El job revision-datos de ci.yml la corre con el código de main, así que un
// PR del bot sin la etiqueta revisar no se fusiona solo si sus datos piden revisión, diga lo que
// diga el job que procesó las fuentes. No usa la red ni lee los crudos: solo los snapshots.
import type { FechaISO } from "@mexicoapi/core";
import { diferenciar, hayDiferencias } from "./diferencias.js";
import { ErrorDatos } from "./errores.js";
import type { Cliente } from "./http.js";
import {
  type Contexto,
  type DefinicionDataset,
  leerRegistros,
  revisionDe,
  validarRegistros,
} from "./marco.js";

export interface ResultadoRevision {
  dataset: string;
  estado: "sin_cambios" | "actualizado" | "requiere_revision";
  altas: number;
  bajas: number;
  cambios: number;
  motivos: string[];
}

const sinRed: Cliente = {
  obtener: () => Promise.reject(new Error("revisar no pide nada a la red")),
};

/**
 * Compara el snapshot de `def` en `raizAntes` con el de `raizDatos`. Lanza ErrorDatos si el nuevo
 * desapareció, no cumple el esquema, repite claves o rompe un invariante. Los datos que `revisar`
 * del dataset lee aparte (el calendario de la CNBV del FIX) salen de `raizDatos`.
 */
export async function revisarDataset<T extends object>(
  def: DefinicionDataset<T>,
  raizAntes: string,
  raizDatos: string,
  fecha: FechaISO,
): Promise<ResultadoRevision> {
  const anterior = await leerRegistros(def, raizAntes);
  const nuevo = await leerRegistros(def, raizDatos);
  if (nuevo === null) {
    if (anterior === null) {
      return {
        dataset: def.id,
        estado: "sin_cambios",
        altas: 0,
        bajas: 0,
        cambios: 0,
        motivos: [],
      };
    }
    throw new ErrorDatos("desapareció el snapshot", def.id);
  }
  validarRegistros(def, nuevo);
  const diferencias = diferenciar(anterior ?? [], nuevo, def.clave);
  const base = {
    dataset: def.id,
    altas: diferencias.altas.length,
    bajas: diferencias.bajas.length,
    cambios: diferencias.cambios.length,
  };
  if (!hayDiferencias(diferencias)) return { ...base, estado: "sin_cambios", motivos: [] };
  const ctx: Contexto = { cliente: sinRed, fecha, raizDatos };
  const revision = await revisionDe(def, anterior, diferencias, ctx);
  return {
    ...base,
    estado: revision.requiereRevision ? "requiere_revision" : "actualizado",
    motivos: revision.motivos,
  };
}
