// Prueba de humo del paquete instalado desde su .tgz, en JavaScript sin Vitest para que corra igual
// en cada Node que soporta el paquete (22.13 o posterior). Va en la carpeta del proyecto que
// instaló el paquete (importa `mexicoapi` por su nombre) y se corre con `node humo.mjs`; termina
// con código distinto de 0 si algo falla.
// No usa la red: los datos salen del paquete y SEPOMEX se importa de un archivo armado aquí.
import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const CLABE = "002010077777777771";

const paso = (texto) => process.stdout.write(`humo: ${texto}\n`);

const mexicoapi = await import("mexicoapi");
const datos = await import("mexicoapi/datos");
const fix = await import("mexicoapi/datos/fix");
const udis = await import("mexicoapi/datos/udis");
const calendarios = await import("mexicoapi/datos/calendarios");
const constantes = await import("mexicoapi/datos/constantes");
const cliente = await import("mexicoapi/cliente");
paso(`Node ${process.versions.node}: importa las entradas universales`);

// require() de un módulo ESM, sin bandera desde Node 22.12: entra por la condición `default` de
// exports.
const require = createRequire(import.meta.url);
equal(require("mexicoapi").validarClabe(CLABE).valido, true);
equal(require("mexicoapi/datos").municipio("25006").nombre, "Culiacán");
equal(typeof require("mexicoapi/cliente").crearCliente, "function");
equal(typeof require("mexicoapi/sepomex").sepomex.cp, "function");
paso("carga con require()");

const clabe = mexicoapi.validarClabe(CLABE, { bancos: datos.catalogoClabe() });
equal(clabe.valido, true);
equal(clabe.detalle.banco.codigo, "002");
equal(mexicoapi.validarClabe("002010077777777770").valido, false);
equal(mexicoapi.validarRfc("XAXX010101000").valido, true);
paso("valida una CLABE y un RFC");

equal(datos.buscarMunicipio("culiacan")[0].cvegeo, "25006");
equal(datos.municipio("25006").nombre, "Culiacán");
equal(datos.estados().length, 32);
paso("busca un municipio");

const sumar = (calendario, desde, dias) =>
  mexicoapi.sumarDiasHabiles({ calendario, desde, dias }).resultado;
equal(sumar(mexicoapi.calendarioLft(), "2026-11-13", 3), "2026-11-19");
// Jueves y viernes santos de 2026: hábiles en la LFT, inhábiles en la CNBV.
equal(sumar(mexicoapi.calendarioLft(), "2026-04-01", 1), "2026-04-02");
equal(sumar(calendarios.calendario("cnbv"), "2026-04-01", 1), "2026-04-06");
// Vacaciones del SAT de julio de 2026: inhábiles en general, hábiles en declaraciones y pagos.
equal(sumar(calendarios.calendario("sat", "general"), "2026-07-17", 3), "2026-08-05");
equal(sumar(calendarios.calendario("sat", "declaraciones_pagos"), "2026-07-17", 3), "2026-07-22");
throws(() => calendarios.calendario("sat"), TypeError);
ok(calendarios.calendarioCurado("sat").plazos.get("general"));
paso("suma días hábiles con la LFT, la CNBV y el SAT");

equal(constantes.uma(2026).diaria, "117.31");
equal(constantes.umaVigente("2026-03-01").anio, 2026);
const ultimoFix = mexicoapi.fixPublicado(fix.serie, fix.tramo, fix.cobertura, fix.cobertura.hasta);
equal(ultimoFix.tipo, "encontrado");
const ultimaUdi = mexicoapi.udiDeFecha(
  udis.serie,
  udis.tramo,
  udis.cobertura,
  udis.cobertura.hasta,
);
equal(ultimaUdi.tipo, "encontrado");
paso("consulta constantes, FIX y UDIS");

const api = cliente.crearCliente({ offline: true });
const validada = await api.clabe(CLABE);
equal(validada.origen, "paquete");
equal(validada.data.valido, true);
const plazo = await api.diasHabiles({
  autoridad: "sat",
  tipoPlazo: "general",
  desde: "2026-07-17",
  dias: 3,
});
equal(plazo.data.resultado, "2026-08-05");
equal((await api.municipio("25006")).data.nombre, "Culiacán");
await rejects(api.banco("999"), (error) => {
  ok(error instanceof cliente.MexicoApiError);
  equal(error.status, 404);
  equal(error.origen, "paquete");
  return true;
});
// Sin base, el cliente pide los datos que caducan a la API pública (URL_API). Aquí con un fetch
// que falla sin salir del equipo: responde el paquete de respaldo.
const pedidas = [];
const publica = cliente.crearCliente({
  reintentos: 0,
  fetch: async (url) => {
    pedidas.push(url);
    throw new TypeError("sin red en la prueba");
  },
});
equal((await publica.fixUltimo()).origen, "paquete");
deepEqual(pedidas, [`${cliente.URL_API}/v1/tipo-cambio/fix/ultimo`]);
throws(() => cliente.crearCliente({ base: "ftp://x" }), TypeError);
paso("responde con un cliente offline y, sin base, pide a URL_API");

const { sepomex, AVISO_SEPOMEX } = await import("mexicoapi/sepomex");
const temporal = await mkdtemp(join(tmpdir(), "mexicoapi-humo-"));
try {
  const cabecera =
    "d_codigo|d_asenta|d_tipo_asenta|D_mnpio|d_estado|d_ciudad|d_CP|c_estado|c_oficina|c_CP|c_tipo_asenta|c_mnpio|id_asenta_cpcons|d_zona|c_cve_ciudad";
  // Una fila por entidad con su primer municipio de INEGI: no es el catálogo de Correos de México.
  const filas = datos.estados().map((e) => {
    const m = datos.municipios(e.cve_ent)[0];
    const cp = `${e.cve_ent}999`;
    return `${cp}|Asentamiento de prueba|Colonia|${m.nombre}|${e.nombre}||${cp}|${e.cve_ent}|${cp}||09|${m.cve_mun}|0001|Urbano|`;
  });
  filas.push(
    "80000|Culiacán Centro|Colonia|Culiacán|Sinaloa|Culiacán Rosales|80001|25|80001||09|006|0001|Urbano|01",
  );
  const archivo = join(temporal, "CPdescarga.txt");
  await writeFile(
    archivo,
    Buffer.from(`${[AVISO_SEPOMEX, cabecera, ...filas].join("\r\n")}\r\n`, "latin1"),
  );
  const avisos = [];
  const dir = join(temporal, "cache");
  await sepomex.importar(archivo, { dir, aviso: (texto) => avisos.push(texto) });
  ok(avisos.join("").includes("Correos de México"));
  const estado = await sepomex.resumen({ dir });
  equal(estado.codigos_postales, 33);
  deepEqual(estado.advertencias, []);
  // node:sqlite viene sin bandera desde Node 22.13, el piso del paquete.
  ok(estado.sqlite);
  equal(estado.sin_sqlite, null);
  const culiacan = await sepomex.cp("80000", { dir });
  equal(culiacan.municipio.cvegeo, "25006");
  equal(culiacan.asentamientos[0].nombre, "Culiacán Centro");
  paso("importa SEPOMEX de un archivo (JSON y SQLite)");
} finally {
  await rm(temporal, { recursive: true, force: true });
}

// El binario que instaló npm, con este mismo Node primero en el PATH. En Windows es un .cmd, que
// solo corre con shell: el comando va entero (los argumentos de aquí no llevan espacios).
const windows = process.platform === "win32";
const binario = join(AQUI, "node_modules", ".bin", windows ? "mexicoapi.cmd" : "mexicoapi");
const clavePath = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
const opciones = {
  encoding: "utf8",
  // Un binario colgado no deja la prueba esperando para siempre.
  timeout: 60_000,
  env: {
    ...process.env,
    [clavePath]: `${dirname(process.execPath)}${delimiter}${process.env[clavePath] ?? ""}`,
  },
};
const cli = (...argumentos) =>
  windows
    ? spawnSync([`"${binario}"`, ...argumentos].join(" "), { ...opciones, shell: true })
    : spawnSync(binario, argumentos, opciones);
const { version } = JSON.parse(
  await readFile(join(AQUI, "node_modules", "mexicoapi", "package.json"), "utf8"),
);
const conVersion = cli("--version");
equal(conVersion.status, 0, conVersion.stderr);
equal(conVersion.stdout.trim(), version);
const conClabe = cli("clabe", CLABE);
equal(conClabe.status, 0, conClabe.stderr);
equal(cli("clabe").status, 2);
paso(`corre el binario mexicoapi ${version}`);

paso("OK");
