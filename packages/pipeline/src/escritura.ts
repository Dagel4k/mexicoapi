import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

function validarRuta(ruta: string): void {
  const segmentos = ruta.split(/[\\/]/);
  const absoluta = /^([a-zA-Z]:|[\\/])/.test(ruta);
  if (ruta === "" || absoluta || segmentos.includes("..")) {
    throw new RangeError(`Ruta no permitida: ${ruta}`);
  }
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reemplaza `directorio` por completo con `archivos` (rutas relativas): escribe
 * en un hermano temporal y lo intercambia; si algo falla restaura el original.
 */
export async function escribirDirectorioAtomico(
  directorio: string,
  archivos: ReadonlyMap<string, Uint8Array | string>,
): Promise<void> {
  for (const ruta of archivos.keys()) validarRuta(ruta);

  const destino = resolve(directorio);
  const sufijo = randomBytes(6).toString("hex");
  const temporal = `${destino}.tmp-${sufijo}`;
  const respaldo = `${destino}.bak-${sufijo}`;

  await mkdir(dirname(destino), { recursive: true });
  let respaldado = false;
  try {
    await mkdir(temporal);
    for (const [ruta, contenido] of archivos) {
      const completa = join(temporal, ruta);
      await mkdir(dirname(completa), { recursive: true });
      await writeFile(completa, contenido);
    }
    if (await existe(destino)) {
      await rename(destino, respaldo);
      respaldado = true;
    }
    await rename(temporal, destino);
  } catch (error) {
    await rm(temporal, { recursive: true, force: true });
    if (respaldado) {
      await rm(destino, { recursive: true, force: true });
      await rename(respaldo, destino);
    }
    throw error;
  }
  if (respaldado) await rm(respaldo, { recursive: true, force: true });
}
