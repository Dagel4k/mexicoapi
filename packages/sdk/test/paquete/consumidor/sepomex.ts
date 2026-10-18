// La entrada de SEPOMEX desde un proyecto sin los tipos de Node: aunque solo corre en Node, sus
// tipos no dependen de @types/node.
import {
  type Asentamiento,
  AVISO_SEPOMEX,
  type CodigoPostal,
  colonias,
  type EstadoSepomex,
  type FetchSepomex,
  LIMITES,
  SepomexError,
  sepomex,
} from "mexicoapi/sepomex";

const propio: FetchSepomex = async (_url, init) => ({
  status: init.method === "GET" ? 200 : 403,
  headers: { get: () => null },
  arrayBuffer: async () => new ArrayBuffer(0),
});

export async function usar(): Promise<string | null> {
  try {
    const estado: EstadoSepomex = await sepomex.sync({
      dir: "cache",
      fetch: propio,
      sqlite: false,
    });
    const codigo: CodigoPostal | null = await sepomex.cp("80000", { dir: estado.dir });
    const lista: readonly Asentamiento[] = await colonias("80000");
    return codigo?.municipio.cvegeo ?? lista[0]?.nombre ?? estado.aviso;
  } catch (error) {
    if (error instanceof SepomexError && error.tipo === "bloqueado") {
      await sepomex.importar("CPdescarga.zip", { aviso: (texto: string) => texto.length });
      return AVISO_SEPOMEX;
    }
    return String(LIMITES.zip);
  }
}
