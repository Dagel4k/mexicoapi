// Pruebas de mexicoapi/sepomex que corren igual sobre src y sobre dist: importar y sincronizar
// con fixtures armados (sin red) en un directorio temporal, consultar y fallar sin dejar una
// caché a medias.
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type * as Sepomex from "../../src/sepomex/index.js";
import type { SepomexError, TipoErrorSepomex } from "../../src/sepomex/index.js";
import {
  AVISO,
  CABECERA,
  FILAS_A_MANO,
  fetchFalso,
  lineasTxt,
  pagina,
  paginaEnBytes,
  txt,
  zipOficial,
} from "./ayudas.js";

export type ModuloSepomex = typeof Sepomex;

export const EXPORTACIONES_SEPOMEX = [
  "AVISO_SEPOMEX",
  "LIMITES",
  "NOTA_MEXICOAPI",
  "SepomexError",
  "URL_DESCARGA",
  "colonias",
  "cp",
  "directorio",
  "importar",
  "resumen",
  "sepomex",
  "sync",
] as const;

/** Rechazo de la promesa como SepomexError del tipo esperado. */
export async function rechazo(
  promesa: Promise<unknown>,
  tipo: TipoErrorSepomex,
  mensaje: RegExp,
): Promise<SepomexError> {
  const error = (await promesa.then(
    () => undefined,
    (e: unknown) => e,
  )) as SepomexError | undefined;
  expect(error?.name).toBe("SepomexError");
  expect(error?.tipo).toBe(tipo);
  expect(error?.message).toMatch(mensaje);
  return error as SepomexError;
}

export function probarSepomex(cargar: () => Promise<ModuloSepomex>): void {
  let m: ModuloSepomex;
  let dir: string;
  let trabajo: string;
  const avisos: string[] = [];
  const aviso = (texto: string) => avisos.push(texto);

  beforeEach(async () => {
    m = await cargar();
    trabajo = await mkdtemp(join(tmpdir(), "mexicoapi-sepomex-"));
    dir = join(trabajo, "cache");
    avisos.length = 0;
  });

  afterEach(async () => {
    await rm(trabajo, { recursive: true, force: true, maxRetries: 3 });
  });

  const archivo = async (nombre: string, bytes: Uint8Array) => {
    const ruta = join(trabajo, nombre);
    await writeFile(ruta, bytes);
    return ruta;
  };

  it("exporta la API de la entrada, también como objeto sepomex", () => {
    expect(Object.keys(m).sort()).toEqual([...EXPORTACIONES_SEPOMEX]);
    expect(Object.keys(m.sepomex).sort()).toEqual([
      "colonias",
      "cp",
      "directorio",
      "importar",
      "resumen",
      "sync",
    ]);
    expect(m.sepomex.cp).toBe(m.cp);
    expect(Object.isFrozen(m.sepomex)).toBe(true);
    expect(m.URL_DESCARGA).toBe(
      "https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx",
    );
    expect(m.LIMITES).toEqual({ pagina: 1_048_576, zip: 20_971_520, txt: 62_914_560 });
  });

  it("sincroniza con el formulario: GET de la página y POST de todo el país en TXT", async () => {
    const { fetch, llamadas } = fetchFalso();
    const estado = await m.sync({ dir, fetch, aviso });
    expect(llamadas.map((l) => [l.method, l.url])).toEqual([
      ["GET", m.URL_DESCARGA],
      ["POST", m.URL_DESCARGA],
    ]);
    const post = llamadas[1];
    const cuerpo = new URLSearchParams(post?.body);
    expect(cuerpo.get("__VIEWSTATE")).toBe(
      "/wEPDwUINzcwOTQyOTgPZBYCAgEPZBYCAgEPZBYGAgEPDxYCHgRUZXh0+/=",
    );
    expect(cuerpo.get("__EVENTVALIDATION")).toBe("/wEWJwLdqZ3eDwLWk4iCCgLWk4SCCgLW&k4CCCg==");
    expect(cuerpo.get("__VIEWSTATEGENERATOR")).toBe("BE1A6D2E");
    expect([cuerpo.get("cboEdo"), cuerpo.get("rblTipo")]).toEqual(["00", "txt"]);
    expect(cuerpo.has("btnDescarga.x")).toBe(true);
    expect(post?.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    for (const l of llamadas)
      expect(l.headers["User-Agent"]).toMatch(
        /^mexicoapi \(\+https:\/\/github\.com\/Dagel4k\/mexicoapi\)$/,
      );
    expect(estado).toMatchObject({
      dir,
      origen: "descarga",
      fuente: m.URL_DESCARGA,
      as_of: "2026-10-17",
      aviso: AVISO,
      nota: m.NOTA_MEXICOAPI,
      filas: lineasTxt().length - 2,
      sin_municipio_inegi: 0,
      advertencias: [],
    });
    expect(Date.parse(estado.descargado)).toBeGreaterThan(Date.now() - 60_000);
    expect(estado.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await m.resumen({ dir })).toEqual(estado);
  });

  it("muestra el aviso de Correos de México y la nota de MéxicoAPI antes de pedir nada", async () => {
    const { fetch, llamadas } = fetchFalso();
    let llamadasAlAvisar = -1;
    await m.sync({
      dir,
      fetch,
      aviso: (texto) => {
        llamadasAlAvisar = llamadas.length;
        avisos.push(texto);
      },
    });
    expect(llamadasAlAvisar).toBe(0);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain(m.AVISO_SEPOMEX);
    expect(avisos[0]).toContain(m.NOTA_MEXICOAPI);
    expect(avisos[0]).toContain(dir);
    expect(m.NOTA_MEXICOAPI).toMatch(/No vienen de MéxicoAPI/);
  });

  it("importa el ZIP o el TXT bajado a mano y responde por código postal", async () => {
    for (const bytes of [zipOficial(), txt()]) {
      const estado = await m.importar(await archivo("descarga", bytes), { dir, aviso });
      expect(estado).toMatchObject({ origen: "archivo", as_of: null, aviso: AVISO });
      expect(await m.cp("80000", { dir })).toEqual({
        cp: "80000",
        estado: { cve_ent: "25", nombre: "Sinaloa" },
        municipio: { cvegeo: "25006", nombre: "Culiacán" },
        asentamientos: [
          {
            nombre: "Culiacán Centro",
            tipo: "Colonia",
            zona: "Urbano",
            ciudad: "Culiacán Rosales",
          },
        ],
      });
    }
    expect(avisos).toHaveLength(2);
    expect((await m.colonias("15520", { dir })).map((a) => a.nombre)).toEqual([
      "Peñón de los Baños",
    ]);
    expect((await m.colonias("80010", { dir })).map((a) => a.nombre)).toEqual([
      "Jorge Almada",
      "Ciudad Universitaria",
    ]);
    expect(await m.cp("99998", { dir })).toBeNull();
    expect(await m.colonias("99998", { dir })).toEqual([]);
  });

  it("guarda el JSON y, si node:sqlite existe, un SQLite con las columnas oficiales", async () => {
    const estado = await m.sync({ dir, fetch: fetchFalso().fetch, aviso });
    expect(estado.json.startsWith(dir)).toBe(true);
    const json = JSON.parse(await readFile(estado.json, "utf8")) as {
      formato: number;
      codigos: Record<string, unknown>;
    };
    expect(json.formato).toBe(1);
    expect(Object.keys(json.codigos)).toHaveLength(estado.codigos_postales);
    expect(json.codigos["80000"]).toEqual(await m.cp("80000", { dir }));
    const sqlite = await import("node:sqlite").catch(() => null);
    if (sqlite === null) {
      expect(estado.sqlite).toBeNull();
      return;
    }
    expect(estado.sqlite).not.toBeNull();
    const db = new sqlite.DatabaseSync(estado.sqlite as string, { readOnly: true });
    try {
      const filas = db
        .prepare(
          "SELECT d_codigo, d_asenta, D_mnpio, c_estado, c_mnpio, cvegeo FROM asentamientos WHERE d_codigo = ? ORDER BY rowid",
        )
        .all("80010");
      const comun = { d_codigo: "80010", D_mnpio: "Culiacán", c_estado: "25", c_mnpio: "006" };
      expect(filas).toEqual([
        { ...comun, d_asenta: "Jorge Almada", cvegeo: "25006" },
        { ...comun, d_asenta: "Ciudad Universitaria", cvegeo: "25006" },
      ]);
      const total = db.prepare("SELECT count(*) AS n FROM asentamientos").get() as { n: number };
      expect(total.n).toBe(estado.filas);
      const meta = db.prepare("SELECT valor FROM meta WHERE clave = 'aviso'").get() as {
        valor: string;
      };
      expect(JSON.parse(meta.valor)).toBe(AVISO);
    } finally {
      db.close();
    }
    const sinSqlite = await m.sync({ dir, fetch: fetchFalso().fetch, aviso, sqlite: false });
    expect(sinSqlite.sqlite).toBeNull();
  });

  it("cuenta como advertencia un código postal que no cruza con INEGI", async () => {
    const fila =
      "80999|Prueba|Colonia|Municipio Nuevo|Sinaloa||80999|25|80999||09|099|0001|Urbano|";
    const estado = await m.importar(await archivo("cp.txt", txt(lineasTxt([fila]))), {
      dir,
      aviso,
    });
    expect(estado.sin_municipio_inegi).toBe(1);
    expect(estado.advertencias).toEqual([
      expect.stringMatching(/^1 código postal tiene un municipio que no está/),
    ]);
    expect((await m.cp("80999", { dir }))?.municipio).toEqual({
      cvegeo: null,
      nombre: "Municipio Nuevo",
    });
    if (estado.sqlite !== null) {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(estado.sqlite, { readOnly: true });
      try {
        const sql =
          "SELECT d_codigo, cvegeo FROM asentamientos WHERE d_codigo IN (?, ?) ORDER BY d_codigo";
        expect(db.prepare(sql).all("80000", "80999")).toEqual([
          { d_codigo: "80000", cvegeo: "25006" },
          { d_codigo: "80999", cvegeo: null },
        ]);
      } finally {
        db.close();
      }
    }
  });

  it("avisa si el aviso de uso del archivo cambió", async () => {
    const lineas = lineasTxt();
    lineas[0] = "Nuevo aviso de uso de Correos de México.";
    const estado = await m.importar(await archivo("cp.txt", txt(lineas)), { dir, aviso });
    expect(estado.aviso).toBe("Nuevo aviso de uso de Correos de México.");
    expect(estado.advertencias[0]).toMatch(/aviso de uso del archivo es distinto/);
  });

  /** Una caché buena y su contenido, para revisar que un fallo no la toca. */
  async function cacheBuena() {
    await m.importar(await archivo("bueno.zip", zipOficial()), { dir, aviso });
    return { estado: await m.resumen({ dir }), archivos: (await readdir(dir)).sort() };
  }

  async function sinCambios(antes: Awaited<ReturnType<typeof cacheBuena>>) {
    expect((await readdir(dir)).sort()).toEqual(antes.archivos);
    expect(await m.resumen({ dir })).toEqual(antes.estado);
    expect((await m.cp("80000", { dir }))?.cp).toBe("80000");
  }

  it("falla con una página inesperada y no toca la caché", async () => {
    const antes = await cacheBuena();
    await rechazo(
      m.sync({
        dir,
        aviso,
        fetch: fetchFalso({ get: { cuerpo: "<html><body>Mantenimiento</body></html>" } }).fetch,
      }),
      "pagina-inesperada",
      /falta el formulario de descarga.*descarga el archivo a mano desde https:\/\/www\.correosdemexico\.gob\.mx.*sepomex\.importar\(ruta\)/is,
    );
    await rechazo(
      m.sync({ dir, aviso, fetch: fetchFalso({ post: { cuerpo: pagina() } }).fetch }),
      "pagina-inesperada",
      /respondió una página en vez del archivo/,
    );
    await sinCambios(antes);
  });

  it("falla con un ZIP inesperado y no toca la caché", async () => {
    const antes = await cacheBuena();
    const { crearZip } = await import("./ayudas.js");
    const dos = crearZip([
      { nombre: "CPdescarga.txt", datos: txt() },
      { nombre: "otro.txt", datos: txt() },
    ]);
    await rechazo(
      m.sync({ dir, aviso, fetch: fetchFalso({ post: { cuerpo: dos } }).fetch }),
      "archivo-invalido",
      /trae 2 archivos/,
    );
    await rechazo(
      m.importar(
        await archivo("raro.zip", crearZip([{ nombre: "../CPdescarga.txt", datos: txt() }])),
        { dir, aviso },
      ),
      "archivo-invalido",
      /nombre inesperado/,
    );
    await sinCambios(antes);
  });

  it("falla con columnas cambiadas o filas dañadas y no toca la caché", async () => {
    const antes = await cacheBuena();
    const cambiada = txt([AVISO, CABECERA.replace("c_mnpio", "c_municipio"), ...FILAS_A_MANO]);
    await rechazo(
      m.sync({ dir, aviso, fetch: fetchFalso({ post: { cuerpo: zipOficial(cambiada) } }).fetch }),
      "archivo-invalido",
      /columnas del TXT de SEPOMEX cambiaron \(faltan: c_mnpio; sobran: c_municipio\)/,
    );
    await rechazo(
      m.importar(await archivo("roto.txt", txt(lineasTxt(["8000|Roto"]))), { dir, aviso }),
      "archivo-invalido",
      /Línea \d+: trae 2 campos/,
    );
    await rechazo(
      m.importar(await archivo("pagina.html", paginaEnBytes()), { dir, aviso }),
      "archivo-invalido",
      /página HTML/,
    );
    await sinCambios(antes);
  });

  it("dice qué hacer si Correos de México bloquea la descarga, sin evadirlo", async () => {
    for (const status of [403, 429]) {
      const { fetch, llamadas } = fetchFalso({ get: { status, cuerpo: "Forbidden" } });
      await rechazo(
        m.sync({ dir, aviso, fetch }),
        "bloqueado",
        new RegExp(
          `no permitió la descarga automática \\(HTTP ${status}\\).*sepomex\\.importar\\(ruta\\)`,
        ),
      );
      expect(llamadas).toHaveLength(1);
    }
    await rechazo(
      m.sync({
        dir,
        aviso,
        fetch: fetchFalso({ get: { cuerpo: pagina({ extra: '<div class="g-recaptcha"></div>' }) } })
          .fetch,
      }),
      "bloqueado",
      /CAPTCHA/,
    );
    await rechazo(
      m.sync({ dir, aviso, fetch: fetchFalso({ post: { cuerpo: "<html>captcha</html>" } }).fetch }),
      "bloqueado",
      /CAPTCHA/,
    );
    await expect(m.resumen({ dir })).resolves.toBeNull();
  });

  it("dice si el sitio no responde", async () => {
    await rechazo(
      m.sync({ dir, aviso, fetch: fetchFalso({ get: new TypeError("fetch failed") }).fetch }),
      "sin-respuesta",
      /No se pudo conectar con Correos de México \(fetch failed\)/,
    );
    const conCausa = new TypeError("fetch failed", {
      cause: new Error("Client network socket disconnected before secure TLS connection"),
    });
    const error = await rechazo(
      m.sync({ dir, aviso, fetch: fetchFalso({ get: conCausa }).fetch }),
      "sin-respuesta",
      /\(fetch failed: Client network socket disconnected before secure TLS connection\)/,
    );
    expect(error.cause).toBe(conCausa);
    await rechazo(
      m.sync({ dir, aviso, fetch: fetchFalso({ post: { status: 503 } }).fetch }),
      "sin-respuesta",
      /HTTP 503/,
    );
    await rechazo(
      m.sync({ dir, aviso, fetch: fetchFalso({ get: { status: 304 } }).fetch }),
      "pagina-inesperada",
      /respondió HTTP 304\. Descarga el archivo a mano/,
    );
    await rechazo(
      m.sync({
        dir,
        aviso,
        fetch: fetchFalso({ get: { status: 302, headers: { Location: "/error.aspx" } } }).fetch,
      }),
      "pagina-inesperada",
      /HTTP 302 \(redirige a \/error\.aspx\)/,
    );
  });

  it("sin caché: resumen da null y cp dice cómo descargarla", async () => {
    await expect(m.resumen({ dir })).resolves.toBeNull();
    await rechazo(
      m.cp("80000", { dir }),
      "sin-datos",
      /No hay códigos postales guardados.*sepomex\.sync\(\)/,
    );
  });

  it("revisa el código postal que se consulta", async () => {
    await m.importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
    for (const malo of ["8000", "800000", "8000a", " 80000", 80000]) {
      await expect(m.cp(malo as string, { dir })).rejects.toThrow(TypeError);
    }
  });

  it("da resultados congelados", async () => {
    await m.importar(await archivo("cp.zip", zipOficial()), { dir, aviso });
    const r = await m.cp("80010", { dir });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r?.asentamientos)).toBe(true);
    expect(Object.isFrozen(r?.asentamientos[0])).toBe(true);
    expect(Object.isFrozen(r?.municipio)).toBe(true);
    expect(Object.isFrozen(await m.resumen({ dir }))).toBe(true);
    expect(Object.isFrozen(await m.colonias("99998", { dir }))).toBe(true);
  });
}
