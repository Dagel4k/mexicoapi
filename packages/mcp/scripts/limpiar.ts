// Borra dist antes de compilar, como `empaquetar.ts preparar` en packages/sdk: tsc no quita el .js
// de un archivo que ya no está en src, y un paquete armado desde un clon con un dist viejo lo
// publicaría. Sin dependencias, como publicable.ts.
//
//   node scripts/limpiar.ts   (lo corre el build, antes de tsc)
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Borra `raiz/dist`, si existe. */
export async function limpiar(raiz: string): Promise<void> {
  await rm(join(raiz, "dist"), { recursive: true, force: true });
}

// import.meta.main existe desde Node 24.2; antes el script saldría con 0 sin hacer nada.
const esPrincipal = (import.meta as { main?: boolean }).main;
if (esPrincipal === true) {
  if (process.argv.length > 2) {
    process.stderr.write("uso: node scripts/limpiar.ts\n  borra dist antes de compilar.\n");
    process.exitCode = 2;
  } else {
    await limpiar(fileURLToPath(new URL("..", import.meta.url)));
  }
} else if (
  esPrincipal === undefined &&
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.stderr.write(`limpiar.ts pide Node 24.2 o posterior (hay ${process.version}).\n`);
  process.exitCode = 1;
}
