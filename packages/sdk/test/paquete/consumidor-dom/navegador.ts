// El cliente en un proyecto de navegador (tipos del DOM, bundler): acepta el fetch, la URL y el
// AbortSignal del entorno sin conversiones.
import { crearCliente, type FetchCompatible } from "mexicoapi/cliente";

const control = new AbortController();

const conGlobal = crearCliente({
  base: new URL("https://api.ejemplo.mx"),
  fetch: globalThis.fetch,
});
const propio: FetchCompatible = (url, init) => fetch(url, { ...init, cache: "no-store" });
const conPropio = crearCliente({ base: "https://api.ejemplo.mx", fetch: propio });

export const consultas = [
  conGlobal.estados({ signal: control.signal }),
  conPropio.clabe("002010077777777771", { fuente: "api", signal: AbortSignal.timeout(1_000) }),
  conPropio.diasHabiles({ desde: "2026-11-13", dias: 3, permitirIncompleto: undefined }),
];
