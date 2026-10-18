import type { Entorno } from "./entorno.js";

const HEXTETO = /^[0-9a-f]{1,4}$/i;

/** Los 4 primeros grupos de una IPv6 sin `%zona`, puerto ni IPv4 incrustada; null si no lo es. */
function prefijo64(ip: string): string | null {
  const partes = ip.split("::");
  if (partes.length > 2) return null;
  const grupos = (texto: string | undefined): string[] =>
    texto === undefined || texto === "" ? [] : texto.split(":");
  const izquierda = grupos(partes[0]);
  const derecha = grupos(partes[1]);
  let completos: string[];
  if (partes.length === 1) {
    completos = izquierda;
  } else {
    const faltan = 8 - izquierda.length - derecha.length;
    // `::` vale por al menos un grupo.
    if (faltan < 1) return null;
    completos = [...izquierda, ...Array<string>(faltan).fill("0"), ...derecha];
  }
  if (completos.length !== 8 || !completos.every((g) => HEXTETO.test(g))) return null;
  const prefijo = completos.slice(0, 4).map((g) => Number.parseInt(g, 16).toString(16));
  return `${prefijo.join(":")}::/64`;
}

/**
 * Clave del límite de peticiones: una IPv4 completa; una IPv6 por su prefijo /64, porque un
 * mismo cliente suele tener todo el bloque. Lo que no se reconoce se usa tal cual.
 */
export function claveLimite(ip: string): string {
  return `ip:${(ip.includes(":") ? prefijo64(ip) : null) ?? ip}`;
}

/** Con el binding LIMITE, una IP que lo rebasa recibe 429; si el binding falla, se deja pasar. */
export async function dentroDelLimite(peticion: Request, entorno: Entorno): Promise<boolean> {
  if (entorno.LIMITE === undefined) return true;
  const ip = peticion.headers.get("CF-Connecting-IP") ?? "desconocida";
  try {
    const { success } = await entorno.LIMITE.limit({ key: claveLimite(ip) });
    return success !== false;
  } catch {
    return true;
  }
}
