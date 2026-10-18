// El cliente desde un proyecto sin los tipos del DOM ni de Node: sus tipos no dependen de ellos.
import {
  type Cliente,
  crearCliente,
  type EstadoDataset,
  type FixOperacion,
  MexicoApiError,
  type Respuesta,
  type RespuestaSinMeta,
  type ResultadoClabe,
} from "mexicoapi/cliente";
import type { Estado } from "mexicoapi/datos";

// Una ruta que el cliente todavía no trae se agrega a RutasApi y se pide con consultar.
declare module "mexicoapi/cliente" {
  interface RutasApi {
    "/v1/isr/subsidio/{anio}": {
      parametros: { anio: number };
      respuesta: Respuesta<{ valor: string }>;
    };
  }
}

const api: Cliente = crearCliente({
  base: "https://api.ejemplo.mx",
  timeoutMs: 5_000,
  reintentos: 1,
  cache: { ttlMs: 60_000, maxEntradas: 50 },
});
const sinRed: Cliente = crearCliente({ offline: true });

export async function usar(): Promise<readonly string[]> {
  const fix: Respuesta<FixOperacion> = await api.fixParaOperacion("2026-10-19");
  const estado: Respuesta<Estado> = await api.consultar("/v1/estados/{cve_ent}", {
    cve_ent: "25",
  });
  const clabe: Respuesta<ResultadoClabe> = await sinRed.clabe("002010077777777771");
  const subsidio: Respuesta<{ valor: string }> = await api.consultar("/v1/isr/subsidio/{anio}", {
    anio: 2026,
  });
  const status: RespuestaSinMeta<readonly EstadoDataset[]> = await api.status();
  const desde = "2026-07-17";
  const sat = await sinRed.diasHabiles({ autoridad: "sat", tipoPlazo: "general", desde, dias: 3 });
  // @ts-expect-error con el SAT el tipo de plazo es obligatorio
  await sinRed.diasHabiles({ autoridad: "sat", desde, dias: 3 });
  // @ts-expect-error el tipo de plazo solo va con el SAT
  await sinRed.diasHabiles({ autoridad: "cnbv", tipoPlazo: "general", desde, dias: 3 });
  try {
    await api.udi("2026-10-20", { fuente: "api" });
  } catch (error) {
    if (error instanceof MexicoApiError) return [error.tipo ?? error.type, error.url];
  }
  return [
    fix.data.valor,
    fix.origen,
    ...fix.advertencias,
    estado.data.nombre,
    estado.meta.as_of,
    String(clabe.data.detalle?.banco?.activo),
    String(status.data.length),
    sat.data.resultado,
    subsidio.data.valor,
  ];
}
