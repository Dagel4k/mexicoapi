// Respuestas del cliente sin red, que corren igual sobre src (con los módulos que sirve
// pluginDatos) y sobre dist (con los import() del build): cada ruta da lo mismo que los datos y
// el núcleo del paquete, con la forma de la API.
import { beforeAll, expect, it } from "vitest";
import type * as ClienteMod from "../../src/cliente/index.js";
import type { Cliente, MexicoApiError } from "../../src/cliente/index.js";
import type { FechaISO } from "../../src/index.js";
import type { Modulo } from "../comun.js";
import type { ModuloDatos, ModuloFix, ModuloUdis } from "../datos/comun.js";
import { esperarCongelado } from "../datos/comun.js";
import { PROBLEMAS, rechazo } from "./ayudas.js";

export type ModuloCliente = typeof ClienteMod;

export interface Modulos {
  cliente: ModuloCliente;
  datos: ModuloDatos;
  fix: ModuloFix;
  udis: ModuloUdis;
  mexicoapi: Modulo;
}

const DOCS_API = "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/README.md#";

const CLABE_VALIDA = "002010077777777771";

/** El aviso fijo de toda respuesta lft, el mismo que da la API. */
export const AVISO_LFT =
  "Solo descuenta sábados, domingos y los días de descanso obligatorio del art. 74 de la LFT; no incluye los festivos del calendario oficial ni los días en que las autoridades laborales suspenden labores (art. 715), como la Semana Santa o sus vacaciones. Revisa el calendario del tribunal o del centro de conciliación.";

/** Fecha ISO `dias` después (o antes) de `fecha`. */
export const mover = (fecha: FechaISO, dias: number): FechaISO =>
  new Date(Date.parse(fecha) + dias * 86_400_000).toISOString().slice(0, 10);

const diaDeLaSemana = (fecha: FechaISO): number => new Date(Date.parse(fecha)).getUTCDay();

/** El primer día después de `fecha` que cumple `cumple`. */
function siguiente(fecha: FechaISO, cumple: (f: FechaISO) => boolean): FechaISO {
  let f = mover(fecha, 1);
  while (!cumple(f)) f = mover(f, 1);
  return f;
}

/** El error de la consulta, revisado como MexicoApiError del paquete con el tipo dado. */
async function problemaDe(
  m: Modulos,
  consulta: Promise<unknown>,
  tipo: string,
  status: number,
): Promise<MexicoApiError> {
  const error = (await rechazo(consulta)) as MexicoApiError;
  expect(error).toBeInstanceOf(m.cliente.MexicoApiError);
  expect(error.origen).toBe("paquete");
  expect(error.tipo).toBe(tipo);
  expect(error.type).toBe(PROBLEMAS + tipo);
  expect(error.status).toBe(status);
  expect(error.problema.status).toBe(status);
  return error;
}

export function probarClienteSinRed(cargar: () => Promise<Modulos>): void {
  let m: Modulos;
  let api: Cliente;

  beforeAll(async () => {
    m = await cargar();
    api = m.cliente.crearCliente({ offline: true });
  });

  // Además de crearCliente y MexicoApiError, el catálogo de problemas de la API y las direcciones
  // de su documentación, los del núcleo (el MCP los toma de aquí).
  it("exporta exactamente crearCliente, MexicoApiError y el catálogo de problemas", () => {
    expect(Object.keys(m.cliente).sort()).toEqual([
      "DIAS_DATOS_RECIENTES",
      "MexicoApiError",
      "PROBLEMAS",
      "URL_API",
      "URL_DOCS",
      "URL_PROBLEMAS",
      "URL_REPOSITORIO",
      "crearCliente",
    ]);
    expect(m.cliente.URL_PROBLEMAS).toBe(PROBLEMAS.slice(0, -1));
    expect(m.cliente.URL_DOCS).toBe(DOCS_API.replace("/api/README.md#", ""));
    expect(m.cliente.URL_REPOSITORIO).toBe("https://github.com/Dagel4k/mexicoapi");
    // La base por omisión del cliente y del MCP: la API pública.
    expect(m.cliente.URL_API).toBe("https://mexicoapi.dagel4k.workers.dev");
    expect(m.cliente.PROBLEMAS["no-encontrado"]).toEqual({
      title: "Recurso no encontrado",
      status: 404,
    });
    expect(Object.isFrozen(m.cliente.PROBLEMAS)).toBe(true);
    // El único umbral de datos viejos, que también usa el MCP.
    expect(m.cliente.DIAS_DATOS_RECIENTES).toBe(7);
  });

  it("responde estados, municipios y bancos con los datos y la meta del paquete", async () => {
    const estados = await api.estados();
    expect(estados).toEqual({
      data: m.datos.estados(),
      meta: m.datos.meta.estados,
      origen: "paquete",
      advertencias: [],
      avisos: [],
    });
    expect(estados.data).toBe(m.datos.estados());
    esperarCongelado(estados, "respuesta");

    expect((await api.estado("25")).data).toBe(m.datos.estado("25"));
    const deSinaloa = await api.municipios("25");
    expect(deSinaloa.data).toEqual(m.datos.municipios("25"));
    expect(deSinaloa.meta).toEqual(m.datos.meta.municipios);
    expect((await api.municipios()).data).toBe(m.datos.municipios());
    expect((await api.municipio("25006")).data).toBe(m.datos.municipio("25006"));
    const bancos = await api.bancos();
    expect(bancos.data).toBe(m.datos.bancos());
    expect(bancos.meta).toEqual(m.datos.meta.bancos);
    expect((await api.banco("002")).data).toBe(m.datos.banco("002"));
  });

  it("da no-encontrado con el texto de la API y con la clave pedida, como la API", async () => {
    const estado = await problemaDe(m, api.estado("33"), "no-encontrado", 404);
    expect(estado.detail).toBe("No existe el estado 33.");
    expect(estado.problema.instance).toBe("/v1/estados/33");
    expect(estado.url).toBe("/v1/estados/33");
    expect(estado.message).toContain("33");
    const municipios = await problemaDe(m, api.municipios("33"), "no-encontrado", 404);
    expect(municipios.detail).toBe("No existe el estado 33.");
    expect(municipios.problema.instance).toBe("/v1/estados/33/municipios");
    const municipio = await problemaDe(m, api.municipio("99999"), "no-encontrado", 404);
    expect(municipio.detail).toBe("No existe el municipio 99999.");
    const banco = await problemaDe(m, api.banco("999"), "no-encontrado", 404);
    expect(banco.detail).toBe("No existe el banco 999.");
  });

  it("revisa los valores de la ruta con las reglas de la API, sin tocar su texto", async () => {
    const estado = "La clave de estado (cve_ent) debe tener 2 dígitos.";
    const municipio = "La clave de municipio (cvegeo) debe tener 5 dígitos.";
    const banco = "El código de banco debe tener 3 dígitos.";
    const clabe = "La CLABE debe tener 18 dígitos.";
    // Valores que aparecen dentro del texto de la regla: el texto no se oculta.
    const casos: [Promise<unknown>, string, string][] = [
      [api.estado("1"), "cve_ent", estado],
      [api.estado("2"), "cve_ent", estado],
      [api.estado("e"), "cve_ent", estado],
      [api.municipios("251"), "cve_ent", estado],
      [api.municipio("5"), "cvegeo", municipio],
      [api.municipio("2500"), "cvegeo", municipio],
      [api.banco("3"), "codigo", banco],
      [api.banco("02"), "codigo", banco],
      [api.clabe("1"), "clabe", clabe],
      [api.clabe("8"), "clabe", clabe],
      [api.clabe("a"), "clabe", clabe],
      [api.clabe("0020100777777777"), "clabe", clabe],
    ];
    for (const [consulta, parametro, detalle] of casos) {
      const error = await problemaDe(m, consulta, "parametro-invalido", 400);
      expect(error.detail).toBe(detalle);
      expect(error.message).toBe(`400 Parámetro inválido: ${detalle}`);
      expect(error.problema.parametro).toBe(parametro);
    }
  });

  it("valida la CLABE con el catálogo de bancos del paquete, como la API", async () => {
    const r = await api.clabe(CLABE_VALIDA);
    expect(r.data).toEqual(
      m.mexicoapi.validarClabe(CLABE_VALIDA, { bancos: m.datos.catalogoClabe() }),
    );
    expect(r.data.valido).toBe(true);
    expect(r.data.detalle?.banco).toEqual({ codigo: "002", nombre_corto: "BANAMEX", activo: true });
    expect(r.meta).toEqual({ ...m.datos.meta.bancos, docs: `${DOCS_API}clabe` });
    const digito = await api.clabe("002010077777777772");
    expect(digito.data.valido).toBe(false);
    expect(digito.data.errores).toEqual(["digito_verificador"]);
    const inactivo = m.datos.bancos({ activos: false })[0];
    if (inactivo !== undefined) {
      const primeros = `${inactivo.codigo}${"0".repeat(14)}`;
      const r2 = await api.clabe(primeros + m.mexicoapi.digitoControlClabe(primeros));
      expect(r2.data.valido).toBe(true);
      expect(r2.data.detalle?.banco?.activo).toBe(false);
    }
  });

  it("suma días hábiles y lista los inhábiles de la LFT con el núcleo", async () => {
    const r = await api.diasHabiles({ desde: "2026-11-13", dias: 3 });
    expect(r.data).toEqual(
      m.mexicoapi.sumarDiasHabiles({
        calendario: m.mexicoapi.calendarioLft(),
        desde: "2026-11-13",
        dias: 3,
      }),
    );
    expect(r.data.resultado).toBe("2026-11-19");
    // Toda respuesta lft avisa que no tiene las suspensiones de labores del art. 715.
    expect(r.data.advertencias).toEqual([AVISO_LFT]);
    // Nuevo: también en las de primer nivel, como en la API.
    expect(r.advertencias).toEqual([AVISO_LFT]);
    expect(r.meta).toEqual({
      dataset: "dias-inhabiles.lft",
      as_of: m.mexicoapi.VIGENCIA_LFT,
      sources: [
        {
          // Dice qué se aplica de cada artículo: del 715, solo los sábados y domingos.
          name: "Ley Federal del Trabajo, artículos 74 (descanso obligatorio) y 715 (sábados y domingos)",
          url: m.mexicoapi.FUENTE_LFT_74.url,
          license:
            "Texto legislativo, no es objeto de derecho de autor (Ley Federal del Derecho de Autor, art. 14, fracción VIII)",
          license_url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFDA.pdf",
          citation:
            "Ley Federal del Trabajo: del artículo 74, los días de descanso obligatorio; del artículo 715, solo los sábados y domingos. Texto vigente con última reforma publicada en el DOF el 14 de mayo de 2026.",
        },
      ],
      docs: `${DOCS_API}dias-habiles`,
    });
    esperarCongelado(r, "respuesta");
    const inhabiles = await api.diasInhabiles({ anio: 2026 });
    expect(inhabiles.data).toEqual(m.mexicoapi.diasDescansoLft(2026));
    expect(inhabiles.advertencias).toEqual([AVISO_LFT]);
    expect(inhabiles.meta.docs).toBe(`${DOCS_API}dias-inhabiles`);
    const incompleto = await api.diasHabiles({
      desde: "2100-12-30",
      dias: 2,
      permitirIncompleto: true,
    });
    // El aviso del año sin calendario y, al final, el fijo de la LFT.
    expect(incompleto.data.advertencias).toEqual([
      "Calendario incompleto: LFT 2101; solo se descontaron fines de semana.",
      AVISO_LFT,
    ]);
    expect(incompleto.advertencias).toEqual(incompleto.data.advertencias);
  });

  it("da en cada ruta avisos con los textos de advertencias y un código conocido", async () => {
    const registro = m.fix.serie[Math.floor(m.fix.serie.length / 2)];
    const dia = m.udis.serie[Math.floor(m.udis.serie.length / 2)];
    if (registro === undefined || dia === undefined) throw new Error("Series vacías");
    const respuestas = [
      await api.estados(),
      await api.estado("25"),
      await api.municipios("25"),
      await api.municipios(),
      await api.municipio("25006"),
      await api.bancos(),
      await api.banco("002"),
      await api.clabe(CLABE_VALIDA),
      await api.diasHabiles({ desde: "2026-12-22", dias: 5 }),
      await api.diasHabiles({ desde: "2100-12-30", dias: 2, permitirIncompleto: true }),
      await api.diasHabiles({ autoridad: "cnbv", desde: "2026-10-30", dias: 1 }),
      await api.diasHabiles({
        autoridad: "sat",
        tipoPlazo: "general",
        desde: "2026-11-27",
        dias: 5,
        permitirIncompleto: true,
      }),
      await api.diasHabiles({
        autoridad: "sat",
        tipoPlazo: "declaraciones_pagos",
        desde: "2030-09-27",
        dias: 3,
      }),
      // Vence el 22 de julio, de vacaciones del SAT: la prórroga del art. 12.
      await api.diasHabiles({
        autoridad: "sat",
        tipoPlazo: "declaraciones_pagos",
        desde: "2026-07-17",
        dias: 3,
      }),
      await api.diasInhabiles({ anio: 2026 }),
      await api.diasInhabiles({ autoridad: "sat", anio: 2030 }),
      await api.diasInhabiles({ autoridad: "cnbv", anio: 2026 }),
      await api.fixPublicado(registro.fecha_publicacion),
      await api.fixParaOperacion(mover(registro.fecha_publicacion, 1)),
      await api.fixUltimo(),
      await api.udi(dia.fecha),
      await api.uma(2026),
      await api.umaVigente("2026-10-16"),
      await api.salarioMinimo(2026),
      await api.tarifaIsr("mensual", 2026),
    ];
    const vistos = new Set<string>();
    for (const r of respuestas) {
      const conCodigo = (textos: readonly string[]) =>
        textos.map((texto) => ({ codigo: m.mexicoapi.codigoAviso(texto), texto }));
      expect(r.avisos).toEqual(conCodigo(r.advertencias));
      const data = r.data as { advertencias?: string[]; avisos?: unknown };
      if (Array.isArray(data.advertencias))
        expect(data.avisos).toEqual(conCodigo(data.advertencias));
      for (const aviso of r.avisos) {
        expect(aviso.codigo, aviso.texto).not.toBe("otro");
        vistos.add(aviso.codigo);
      }
      esperarCongelado(r, "respuesta");
    }
    // datos-viejos depende de la fecha de hoy y se prueba aparte.
    vistos.delete("datos-viejos");
    expect([...vistos].sort()).toEqual(
      [
        "calendario-incompleto",
        "datos-del-paquete",
        "lft-art-715",
        "lista-incompleta",
        "prorroga-art-12",
        "tipo-plazo-incompleto",
        "transmision-poder-ejecutivo",
        "vacaciones-sin-publicar",
      ].sort(),
    );
  });

  it("da los problemas de días hábiles e inhábiles con su forma de la API", async () => {
    const fuera = await problemaDe(
      m,
      api.diasHabiles({ desde: "2100-12-30", dias: 2 }),
      "calendario-incompleto",
      422,
    );
    expect(fuera.detail).toBe(
      "El calendario de la LFT no cubre 2101-01-01; cubre del 2007-01-01 al 2100-12-31.",
    );
    expect(fuera.problema).toMatchObject({
      instance: "/v1/dias-habiles",
      autoridad: "lft",
      fecha: "2101-01-01",
      cobertura: { desde: "2007-01-01", hasta: "2100-12-31" },
    });
    const anio = await problemaDe(
      m,
      api.diasInhabiles({ anio: 2200 }),
      "calendario-incompleto",
      422,
    );
    expect(anio.detail).toBe(
      "El calendario de la LFT no cubre el año 2200; cubre del 2007-01-01 al 2100-12-31.",
    );
    expect(anio.problema.fecha).toBe("2200-01-01");

    const invalidos: [Promise<unknown>, string, string][] = [
      [
        api.diasHabiles({ desde: "2026-02-30", dias: 3 }),
        "desde",
        "La fecha de partida (desde) debe ser una fecha válida con formato AAAA-MM-DD.",
      ],
      [
        api.diasHabiles({ desde: "2026-11-13", dias: 0 }),
        "dias",
        "Los días hábiles (dias) deben ser un entero de 1 a 3650, sin ceros a la izquierda.",
      ],
      [
        api.diasHabiles({ desde: "2026-11-13", dias: 3651 }),
        "dias",
        "Los días hábiles (dias) deben ser un entero de 1 a 3650, sin ceros a la izquierda.",
      ],
      [
        api.diasHabiles({ desde: "2026-11-13", dias: 3, autoridad: "imss" as "lft" }),
        "autoridad",
        "Autoridades disponibles: lft, cnbv y sat.",
      ],
      [
        api.diasHabiles({ desde: "9999-12-30", dias: 5, permitirIncompleto: true }),
        "desde",
        "Con estos días, el resultado pasaría del año 9999.",
      ],
      [
        api.diasInhabiles({ anio: 0 }),
        "anio",
        "El año (anio) debe tener 4 dígitos, de 0001 a 9999.",
      ],
      [
        api.consultar("/v1/dias-habiles", {
          autoridad: "lft",
          desde: "2026-11-13",
          dias: 3,
          permitir_incompleto: "si" as unknown as boolean,
        }),
        "permitir_incompleto",
        "El parámetro permitir_incompleto debe ser true o false.",
      ],
      [api.udi(""), "fecha", "El parámetro fecha está vacío."],
    ];
    for (const [consulta, parametro, detalle] of invalidos) {
      const error = await problemaDe(m, consulta, "parametro-invalido", 400);
      expect(error.detail).toBe(detalle);
      expect(error.problema.parametro).toBe(parametro);
    }
    const falta = await problemaDe(
      m,
      api.consultar("/v1/dias-habiles", { autoridad: "lft", desde: "2026-11-13" } as never),
      "parametro-faltante",
      400,
    );
    expect(falta.detail).toBe("Falta el parámetro dias.");
    expect(falta.problema.parametro).toBe("dias");
  });

  it("consulta el FIX y las UDIS en las series del paquete", async () => {
    const { serie, cobertura } = m.fix;
    const registro = serie[Math.floor(serie.length / 2)];
    if (registro === undefined) throw new Error("Serie del FIX vacía");
    const publicado = await api.fixPublicado(registro.fecha_publicacion);
    expect(publicado.data).toBe(registro);
    expect(publicado.origen).toBe("paquete");
    expect(publicado.meta).toEqual({ ...m.fix.meta, docs: `${DOCS_API}tipo-de-cambio-fix` });

    const operacion = await api.fixParaOperacion(mover(registro.fecha_publicacion, 1));
    expect(operacion.data).toEqual({
      fecha_operacion: mover(registro.fecha_publicacion, 1),
      fecha_publicacion: registro.fecha_publicacion,
      valor: registro.valor,
      fundamento: m.mexicoapi.FUENTE_CFF_20,
    });
    esperarCongelado(operacion, "respuesta");

    const ultimo = await api.fixUltimo();
    expect(ultimo.data).toBe(serie.at(-1));
    expect(ultimo.data.fecha_publicacion).toBe(cobertura.hasta);

    const dia = m.udis.serie[Math.floor(m.udis.serie.length / 2)];
    if (dia === undefined) throw new Error("Serie de UDIS vacía");
    const udi = await api.udi(dia.fecha);
    expect(udi.data).toBe(dia);
    expect(udi.meta).toEqual({ ...m.udis.meta, docs: `${DOCS_API}udis` });
  });

  it("dice no-encontrado o dato-no-disponible como la API, nunca un valor viejo", async () => {
    const { cobertura } = m.fix;
    const antes = mover(cobertura.desde, -1);
    const sinSerie = await problemaDe(m, api.fixPublicado(antes), "no-encontrado", 404);
    expect(sinSerie.detail).toBe(
      `La serie del paquete empieza el ${cobertura.desde}; no incluye el ${antes}.`,
    );
    expect(sinSerie.problema).toMatchObject({
      fecha: antes,
      cobertura: { desde: cobertura.desde, hasta: cobertura.hasta },
    });
    const sabado = siguiente(cobertura.desde, (f) => diaDeLaSemana(f) === 6);
    const fds = await problemaDe(m, api.fixPublicado(sabado), "no-encontrado", 404);
    expect(fds.detail).toBe(
      `No hubo publicación del FIX en el DOF el ${sabado}. Para el FIX que aplica a una operación de ese día, usa operacion=${sabado}.`,
    );

    const futuro = await problemaDe(m, api.fixPublicado("2100-01-04"), "dato-no-disponible", 404);
    expect(futuro.detail).toBe(
      `El FIX del 2100-01-04 no está en los datos del paquete; la última publicación que traen es del ${cobertura.hasta}.`,
    );
    expect(futuro.problema).toMatchObject({
      instance: "/v1/tipo-cambio/fix",
      fecha: "2100-01-04",
      cobertura: { desde: cobertura.desde, hasta: cobertura.hasta },
    });
    const operacion = await problemaDe(
      m,
      api.fixParaOperacion("2100-01-04"),
      "dato-no-disponible",
      404,
    );
    expect(operacion.detail).toBe(
      `Los datos del paquete no traen el FIX que aplica a una operación del 2100-01-04; la última publicación que traen es del ${cobertura.hasta}.`,
    );
    const primera = await problemaDe(
      m,
      api.fixParaOperacion(cobertura.desde),
      "no-encontrado",
      404,
    );
    expect(primera.detail).toBe(
      `La serie del paquete empieza el ${cobertura.desde}; no incluye la publicación que aplica a una operación del ${cobertura.desde}.`,
    );

    const udis = m.udis.cobertura;
    const udiFutura = await problemaDe(m, api.udi("2100-01-04"), "dato-no-disponible", 404);
    expect(udiFutura.detail).toBe(
      `El valor de la UDI del 2100-01-04 no está en los datos del paquete; el último que traen es del ${udis.hasta}.`,
    );
    const udiAntes = mover(udis.desde, -1);
    const udiPasada = await problemaDe(m, api.udi(udiAntes), "no-encontrado", 404);
    expect(udiPasada.detail).toBe(
      `La serie del paquete empieza el ${udis.desde}; no incluye el ${udiAntes}.`,
    );
  });

  it("pide exactamente publicado u operacion en el FIX", async () => {
    const ambos = await problemaDe(
      m,
      api.consultar("/v1/tipo-cambio/fix", {
        publicado: "2026-10-16",
        operacion: "2026-10-16",
      } as never),
      "parametro-invalido",
      400,
    );
    expect(ambos.detail).toBe("Indica solo uno de publicado u operacion.");
    expect(ambos.problema.parametro).toBeUndefined();
    const ninguno = await problemaDe(
      m,
      api.consultar("/v1/tipo-cambio/fix", {} as never),
      "parametro-faltante",
      400,
    );
    expect(ninguno.detail).toBe("Indica publicado u operacion.");
    const invalida = await problemaDe(m, api.fixPublicado("2026-13-01"), "parametro-invalido", 400);
    expect(invalida.detail).toBe(
      "La fecha de publicación (publicado) debe ser una fecha válida con formato AAAA-MM-DD.",
    );
    const operacion = await problemaDe(m, api.fixParaOperacion("ayer"), "parametro-invalido", 400);
    expect(operacion.problema.parametro).toBe("operacion");
  });

  it("rechaza los parámetros que la ruta no acepta, como la API", async () => {
    const consultar = api.consultar as unknown as (
      ruta: string,
      parametros: Record<string, unknown>,
    ) => Promise<unknown>;
    const casos: [Promise<unknown>, string][] = [
      [consultar("/v1/estados", { orden: "nombre" }), "orden"],
      [consultar("/v1/estados/{cve_ent}", { cve_ent: "25", x: 1 }), "x"],
      [consultar("/v1/clabe/{clabe}", { clabe: CLABE_VALIDA, banco: "002" }), "banco"],
      // El desconocido se revisa antes que las reglas de los demás, como en la API.
      [consultar("/v1/udis", { fecha: "ayer", hora: "12" }), "hora"],
      [
        consultar("/v1/dias-habiles", { autoridad: "lft", desde: "2026-11-13", dias: 3, tipo: 1 }),
        "tipo",
      ],
    ];
    for (const [consulta, parametro] of casos) {
      const error = await problemaDe(m, consulta, "parametro-desconocido", 400);
      expect(error.title).toBe("Parámetro desconocido");
      expect(error.detail).toBe(`Esta ruta no acepta el parámetro ${parametro}.`);
      expect(error.problema.parametro).toBe(parametro);
    }
    const sinNombre = await problemaDe(
      m,
      consultar("/v1/udis", { fecha: "2026-10-20", "": "1" }),
      "parametro-invalido",
      400,
    );
    expect(sinNombre.detail).toBe("La query tiene un parámetro sin nombre.");
    expect(sinNombre.problema.parametro).toBeUndefined();
  });

  it("sin red, /v1/status no tiene respuesta del paquete", async () => {
    await expect(api.status()).rejects.toThrow("El paquete no trae /v1/status");
  });
}
