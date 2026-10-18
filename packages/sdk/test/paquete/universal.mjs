// Prueba de humo de las entradas universales del paquete instalado desde su .tgz, para los entornos
// que no son Node: CI la corre con Bun y con Deno en la carpeta del proyecto que instaló el paquete
// (importa `mexicoapi` por su nombre). Igual que esas entradas, no usa módulos de Node ni `process`,
// así que tampoco usa node:assert. No usa la red: el cliente responde en modo offline. Termina con
// error si algo falla.
const CLABE = "002010077777777771";

function igual(actual, esperado, que) {
  if (actual !== esperado) {
    throw new Error(
      `${que}: dio ${JSON.stringify(actual)}, se esperaba ${JSON.stringify(esperado)}`,
    );
  }
}

async function rechaza(promesa, revisar, que) {
  let error;
  try {
    await promesa;
  } catch (e) {
    error = e;
  }
  if (error === undefined) throw new Error(`${que}: no falló`);
  revisar(error);
}

const { Bun, Deno } = globalThis;
const entorno =
  Deno !== undefined
    ? `Deno ${Deno.version.deno}`
    : Bun !== undefined
      ? `Bun ${Bun.version}`
      : (globalThis.navigator?.userAgent ?? "entorno desconocido");
const paso = (texto) => console.log(`universal: ${texto}`);

// Cada entrada sale del paquete instalado, resuelta por el `exports` de su package.json.
const SUBRUTAS = [
  "",
  "/datos",
  "/datos/fix",
  "/datos/udis",
  "/datos/calendarios",
  "/datos/constantes",
  "/cliente",
];
for (const subruta of SUBRUTAS) {
  const entrada = `mexicoapi${subruta}`;
  const url = import.meta.resolve(entrada);
  if (!url.includes("/node_modules/mexicoapi/dist/")) {
    throw new Error(`${entrada} se resolvió a ${url}, no al paquete instalado`);
  }
}

const mexicoapi = await import("mexicoapi");
const datos = await import("mexicoapi/datos");
const fix = await import("mexicoapi/datos/fix");
const udis = await import("mexicoapi/datos/udis");
const calendarios = await import("mexicoapi/datos/calendarios");
const constantes = await import("mexicoapi/datos/constantes");
const cliente = await import("mexicoapi/cliente");
paso(`${entorno}: importa las entradas universales del paquete instalado`);

const clabe = mexicoapi.validarClabe(CLABE, { bancos: datos.catalogoClabe() });
igual(clabe.valido, true, "CLABE válida");
igual(clabe.detalle.banco.codigo, "002", "banco de la CLABE");
igual(mexicoapi.validarClabe("002010077777777770").valido, false, "CLABE con mal dígito");
igual(mexicoapi.validarRfc("XAXX010101000").valido, true, "RFC genérico");
paso("valida una CLABE y un RFC");

igual(datos.buscarMunicipio("culiacan")[0].cvegeo, "25006", "busca Culiacán");
igual(datos.municipio("25006").nombre, "Culiacán", "municipio 25006");
igual(datos.estados().length, 32, "estados");
paso("busca un municipio");

const sumar = (calendario, desde, dias) =>
  mexicoapi.sumarDiasHabiles({ calendario, desde, dias }).resultado;
igual(sumar(mexicoapi.calendarioLft(), "2026-11-13", 3), "2026-11-19", "LFT");
igual(sumar(calendarios.calendario("cnbv"), "2026-04-01", 1), "2026-04-06", "CNBV");
igual(sumar(calendarios.calendario("sat", "general"), "2026-07-17", 3), "2026-08-05", "SAT");
paso("suma días hábiles con la LFT, la CNBV y el SAT");

igual(constantes.uma(2026).diaria, "117.31", "UMA 2026");
const ultimoFix = mexicoapi.fixPublicado(fix.serie, fix.tramo, fix.cobertura, fix.cobertura.hasta);
igual(ultimoFix.tipo, "encontrado", "último FIX");
const ultimaUdi = mexicoapi.udiDeFecha(
  udis.serie,
  udis.tramo,
  udis.cobertura,
  udis.cobertura.hasta,
);
igual(ultimaUdi.tipo, "encontrado", "última UDI");
paso("consulta constantes, FIX y UDIS");

const api = cliente.crearCliente({ offline: true });
const validada = await api.clabe(CLABE);
igual(validada.origen, "paquete", "origen de la CLABE");
igual(validada.data.valido, true, "CLABE del cliente");
const plazo = await api.diasHabiles({
  autoridad: "sat",
  tipoPlazo: "general",
  desde: "2026-07-17",
  dias: 3,
});
igual(plazo.data.resultado, "2026-08-05", "plazo del cliente");
igual((await api.municipio("25006")).data.nombre, "Culiacán", "municipio del cliente");
await rechaza(
  api.banco("999"),
  (error) => {
    igual(error instanceof cliente.MexicoApiError, true, "error del cliente");
    igual(error.status, 404, "status del error");
    igual(error.origen, "paquete", "origen del error");
  },
  "banco 999",
);
paso("responde con un cliente offline");

paso("OK");
