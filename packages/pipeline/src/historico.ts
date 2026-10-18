import type { FechaISO } from "@mexicoapi/core";
import { interpretarCep, urlCep } from "./datasets/bancos/cep.js";
import type { Observacion } from "./datasets/bancos/historial.js";
import { ErrorDatos } from "./errores.js";
import type { Cliente } from "./http.js";

const DIAS_POR_MES = 5;

/** Una respuesta que no es JSON (HTML, bytes inválidos) es un bloqueo, no un día sin datos. */
function esJson(bytes: Uint8Array): boolean {
  try {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return true;
  } catch {
    return false;
  }
}

/**
 * Una observación del CEP por mes, desde `desde` (AAAA-MM) hasta el mes de `hasta`.
 * Prueba los días 1 a 5 y se queda con el primero cuyo JSON trae instituciones;
 * un mes sin ninguno se salta (quien llama detecta el hueco). Un fallo de red aborta, y
 * una respuesta que no es JSON se toma por bloqueo y detiene la captura.
 */
export async function capturarHistoricoCep(
  cliente: Cliente,
  desde: string,
  hasta: FechaISO,
  avisar: (texto: string) => void = () => {},
): Promise<Observacion[]> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(desde)) {
    throw new RangeError(`Mes inválido: ${desde} (se espera AAAA-MM)`);
  }
  let anio = Number(desde.slice(0, 4));
  let mes = Number(desde.slice(5, 7));
  const anioFin = Number(hasta.slice(0, 4));
  const mesFin = Number(hasta.slice(5, 7));
  const observaciones: Observacion[] = [];
  let meses = 0;

  while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
    const prefijo = `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}`;
    let encontrada = false;
    for (let dia = 1; dia <= DIAS_POR_MES && !encontrada; dia++) {
      const fecha = `${prefijo}-${String(dia).padStart(2, "0")}`;
      if (fecha > hasta) break;
      const url = urlCep(fecha);
      const respuesta = await cliente.obtener(url);
      if (!esJson(respuesta.cuerpo)) {
        throw new ErrorDatos(
          `Banxico respondió algo que no es JSON en ${url}: posible bloqueo; se detuvo la captura`,
          "bancos",
        );
      }
      try {
        observaciones.push({ fecha, entradas: interpretarCep(respuesta.cuerpo) });
        encontrada = true;
      } catch (error) {
        if (!(error instanceof ErrorDatos)) throw error;
      }
    }
    meses++;
    if (meses % 12 === 0) avisar(`Histórico: ${meses} meses revisados (hasta ${prefijo}).\n`);
    if (mes === 12) {
      anio++;
      mes = 1;
    } else {
      mes++;
    }
  }
  return observaciones;
}
