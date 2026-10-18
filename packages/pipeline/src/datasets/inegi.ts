import type { Estado, Municipio } from "@mexicoapi/core";
import { z } from "zod";
import { limpiarTexto } from "../canonico.js";
import { ErrorDatos } from "../errores.js";
import { esquemaEstado, esquemaMunicipio } from "../esquemas.js";
import type {
  Construccion,
  Contexto,
  CrudoCapturado,
  DefinicionDataset,
  FuenteCapturada,
  Revision,
} from "../marco.js";

const BASE = "https://gaia.inegi.org.mx/wscatgeo/v2/";
const HOSTS = [new URL(BASE).host];
const CLAVES_ESTADO = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(2, "0"));
const MINIMO_MUNICIPIOS = 2400;
const UMBRAL_REVISION = 0.005;

const FUENTE = {
  name: "INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades",
  url: BASE,
  license: "Términos de libre uso de la información del INEGI",
  license_url: "https://www.inegi.org.mx/inegi/terminos.html",
  citation:
    "INEGI. Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades, servicio wscatgeo v2.",
  published_at: null,
} as const;

const crudoEstados = z.object({
  datos: z.array(
    z.object({
      cvegeo: z.string(),
      cve_ent: z.string(),
      nomgeo: z.string(),
      nom_abrev: z.string(),
    }),
  ),
});

const crudoMunicipios = z.object({
  datos: z.array(
    z.object({
      cvegeo: z.string(),
      cve_ent: z.string(),
      cve_mun: z.string(),
      nomgeo: z.string(),
      cve_cab: z.string(),
    }),
  ),
});

function leerJson<S extends z.ZodType>(id: string, crudo: CrudoCapturado, esquema: S): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(crudo.bytes));
  } catch {
    throw new ErrorDatos(`${crudo.file} no es JSON válido`, id);
  }
  const r = esquema.safeParse(json);
  if (!r.success) {
    const p = r.error.issues[0];
    const donde = p === undefined ? "" : `: ${p.path.map(String).join(".") || "(raíz)"}`;
    throw new ErrorDatos(`${crudo.file} no tiene la forma esperada${donde}`, id);
  }
  return r.data;
}

async function pedir(ctx: Contexto, file: string, url: string): Promise<CrudoCapturado> {
  const r = await ctx.cliente.obtener(url);
  return { file, url, bytes: r.cuerpo, obtenido_en: r.obtenido_en };
}

const repetidos = (valores: readonly string[]): string[] => [
  ...new Set(valores.filter((v, i) => valores.indexOf(v) !== i)),
];

export const estadosInegi: DefinicionDataset<Estado> = {
  id: "inegi.estados",
  hosts: HOSTS,
  directorio: "inegi-estados",
  archivo: "estados.json",
  esquema: esquemaEstado,
  clave: (e) => e.cve_ent,

  async capturar(ctx): Promise<FuenteCapturada[]> {
    const crudo = await pedir(ctx, "raw/mgee.json", `${BASE}mgee/`);
    return [{ ...FUENTE, crudos: [crudo] }];
  },

  async construir(fuentes): Promise<Construccion<Estado>> {
    const crudo = fuentes.flatMap((f) => f.crudos).find((c) => c.file === "raw/mgee.json");
    if (crudo === undefined) throw new ErrorDatos("Falta raw/mgee.json", estadosInegi.id);
    const { datos } = leerJson(estadosInegi.id, crudo, crudoEstados);
    const registros = datos.map((d) => ({
      cve_ent: d.cve_ent,
      nombre: limpiarTexto(d.nomgeo),
      abreviatura: limpiarTexto(d.nom_abrev),
      cvegeo: d.cvegeo,
    }));
    return { registros, avisos: [] };
  },

  invariantes(registros) {
    const fallas: string[] = [];
    if (registros.length !== 32) fallas.push(`se esperaban 32 estados y hay ${registros.length}`);
    const claves = registros.map((e) => e.cve_ent);
    const dup = repetidos(claves);
    if (dup.length > 0) fallas.push(`cve_ent repetidas: ${dup.join(", ")}`);
    const faltan = CLAVES_ESTADO.filter((c) => !claves.includes(c));
    if (faltan.length > 0) fallas.push(`faltan cve_ent: ${faltan.join(", ")}`);
    const fuera = claves.filter((c) => !CLAVES_ESTADO.includes(c));
    if (fuera.length > 0) fallas.push(`cve_ent fuera de 01 a 32: ${fuera.join(", ")}`);
    const distintas = registros.filter((e) => e.cvegeo !== e.cve_ent).map((e) => e.cve_ent);
    if (distintas.length > 0) fallas.push(`cvegeo distinto de cve_ent en: ${distintas.join(", ")}`);
    return fallas;
  },

  revisar(): Revision {
    return { requiereRevision: true, motivos: ["cambio en el catálogo de estados"] };
  },
};

export const municipiosInegi: DefinicionDataset<Municipio> = {
  id: "inegi.municipios",
  hosts: HOSTS,
  directorio: "inegi-municipios",
  archivo: "municipios.json",
  esquema: esquemaMunicipio,
  clave: (m) => m.cvegeo,

  async capturar(ctx): Promise<FuenteCapturada[]> {
    const crudos: CrudoCapturado[] = [];
    for (const cve of CLAVES_ESTADO) {
      crudos.push(await pedir(ctx, `raw/mgem-${cve}.json`, `${BASE}mgem/${cve}`));
    }
    return [{ ...FUENTE, crudos }];
  },

  async construir(fuentes): Promise<Construccion<Municipio>> {
    const id = municipiosInegi.id;
    const porArchivo = new Map(fuentes.flatMap((f) => f.crudos).map((c) => [c.file, c]));
    const esperados = CLAVES_ESTADO.map((c) => `raw/mgem-${c}.json`);
    const faltan = esperados.filter((f) => !porArchivo.has(f));
    if (faltan.length > 0) throw new ErrorDatos(`Faltan crudos: ${faltan.join(", ")}`, id);
    const sobran = [...porArchivo.keys()].filter((f) => !esperados.includes(f));
    if (sobran.length > 0) throw new ErrorDatos(`Crudos inesperados: ${sobran.join(", ")}`, id);

    const registros: Municipio[] = [];
    for (const cve of CLAVES_ESTADO) {
      const crudo = porArchivo.get(`raw/mgem-${cve}.json`) as CrudoCapturado;
      for (const d of leerJson(id, crudo, crudoMunicipios).datos) {
        if (d.cve_ent !== cve) {
          throw new ErrorDatos(
            `${crudo.file} trae el municipio ${d.cvegeo} con cve_ent ${d.cve_ent}`,
            id,
          );
        }
        // La fuente marca "sin cabecera" (alcaldías de la CDMX) con "----".
        if (d.cve_cab !== "----" && !/^\d{4}$/.test(d.cve_cab)) {
          throw new ErrorDatos(`cve_cab inválida en ${d.cvegeo}: ${d.cve_cab}`, id);
        }
        registros.push({
          cvegeo: d.cvegeo,
          cve_ent: d.cve_ent,
          cve_mun: d.cve_mun,
          nombre: limpiarTexto(d.nomgeo),
          cve_cabecera: d.cve_cab === "----" ? null : d.cve_cab,
        });
      }
    }
    return { registros, avisos: [] };
  },

  invariantes(registros) {
    const fallas: string[] = [];
    if (registros.length < MINIMO_MUNICIPIOS) {
      fallas.push(
        `se esperaban al menos ${MINIMO_MUNICIPIOS} municipios y hay ${registros.length}`,
      );
    }
    const mal = registros.filter((m) => m.cvegeo !== m.cve_ent + m.cve_mun).map((m) => m.cvegeo);
    if (mal.length > 0) fallas.push(`cvegeo distinto de cve_ent + cve_mun en: ${mal.join(", ")}`);
    const estados = new Set(registros.map((m) => m.cve_ent));
    const sin = CLAVES_ESTADO.filter((c) => !estados.has(c));
    if (sin.length > 0) fallas.push(`estados sin municipios: ${sin.join(", ")}`);
    return fallas;
  },

  revisar(diferencias, anterior): Revision {
    const cambios =
      diferencias.altas.length + diferencias.bajas.length + diferencias.cambios.length;
    const proporcion = anterior.length === 0 ? 1 : cambios / anterior.length;
    if (proporcion <= UMBRAL_REVISION) return { requiereRevision: false, motivos: [] };
    const pct = (proporcion * 100).toFixed(2);
    return {
      requiereRevision: true,
      motivos: [
        `cambio de ${pct} % en municipios (${cambios} de ${anterior.length}), sobre el umbral de 0.5 %`,
      ],
    };
  },
};
