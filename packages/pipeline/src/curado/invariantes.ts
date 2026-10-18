import type {
  AutoridadCurada,
  CoberturaCurada,
  DiaInhabilCurado,
  DiaSemana,
  FuenteDof,
  SalarioMinimo,
  TarifaIsr,
  Uma,
} from "@mexicoapi/core";
import { enesimoDiaDeSemana } from "@mexicoapi/core";
import { aCentavos, conMiles, deCentavos, dividirRedondeando } from "./decimal.js";
import type { ExcepcionCuotaFija } from "./esquemas.js";

/**
 * Diferencia aceptada, en centavos, entre la cuota fija publicada y la que resulta de encadenar
 * el tramo anterior. El SAT actualiza cada cantidad de la tarifa por separado (multiplica por el
 * factor de inflación y redondea), así que el encadenamiento puede variar un centavo. Lo que pase
 * de eso se declara en el YAML como excepción, con el valor publicado y el recalculado.
 */
export const TOLERANCIA_CUOTA_FIJA = 1n;

/** `fragmento` contiene `monto` con comas de miles, sin que forme parte de otro número. */
function citaMonto(fuente: FuenteDof, monto: string): boolean {
  const escapado = conMiles(monto).replace(/[.,]/g, "\\$&");
  return new RegExp(`(?<![\\d.,])${escapado}(?!\\d)`).test(fuente.fragmento);
}

function publicadaAntes(fuente: FuenteDof, vigencia: string): string | null {
  return fuente.fecha_publicacion > vigencia
    ? `la fuente se publicó (${fuente.fecha_publicacion}) después de vigencia_desde (${vigencia})`
    : null;
}

export function invariantesUma(registros: readonly Uma[]): string[] {
  const fallas: string[] = [];
  for (const r of registros) {
    const falla = (texto: string) => fallas.push(`${r.anio}: ${texto}`);
    // mensual = diaria × 30.4 y anual = mensual × 12, redondeados a centavos.
    const mensual = deCentavos(dividirRedondeando(aCentavos(r.diaria) * 304n, 10n));
    if (r.mensual !== mensual)
      falla(`mensual es ${r.mensual}, se esperaba ${mensual} (diaria × 30.4)`);
    const anual = deCentavos(aCentavos(r.mensual) * 12n);
    if (r.anual !== anual) falla(`anual es ${r.anual}, se esperaba ${anual} (mensual × 12)`);
    const vigencia = `${r.anio}-02-01`;
    if (r.vigencia_desde !== vigencia) {
      falla(`vigencia_desde es ${r.vigencia_desde}, se esperaba ${vigencia}`);
    }
    const tardia = publicadaAntes(r.fuente, r.vigencia_desde);
    if (tardia !== null) falla(tardia);
    for (const campo of ["diaria", "mensual", "anual"] as const) {
      if (!citaMonto(r.fuente, r[campo])) {
        falla(`el fragmento de la fuente no contiene la ${campo} ${conMiles(r[campo])}`);
      }
    }
  }
  return fallas;
}

export function invariantesSalarioMinimo(registros: readonly SalarioMinimo[]): string[] {
  const fallas: string[] = [];
  const porAnio = new Map<number, Map<SalarioMinimo["zona"], SalarioMinimo>>();
  for (const r of registros) {
    const falla = (texto: string) => fallas.push(`${r.anio} ${r.zona}: ${texto}`);
    const vigencia = `${r.anio}-01-01`;
    if (r.vigencia_desde !== vigencia) {
      falla(`vigencia_desde es ${r.vigencia_desde}, se esperaba ${vigencia}`);
    }
    const tardia = publicadaAntes(r.fuente, r.vigencia_desde);
    if (tardia !== null) falla(tardia);
    if (!citaMonto(r.fuente, r.diario)) {
      falla(`el fragmento de la fuente no contiene el diario ${conMiles(r.diario)}`);
    }
    const zonas = porAnio.get(r.anio) ?? new Map();
    zonas.set(r.zona, r);
    porAnio.set(r.anio, zonas);
  }
  for (const [anio, zonas] of porAnio) {
    const general = zonas.get("general");
    const zlfn = zonas.get("zlfn");
    if (general === undefined || zlfn === undefined) {
      fallas.push(`${anio}: falta la zona ${general === undefined ? "general" : "zlfn"}`);
    } else if (aCentavos(zlfn.diario) <= aCentavos(general.diario)) {
      // Desde 2019 la ZLFN siempre es mayor: atrapa las zonas intercambiadas al capturar.
      fallas.push(
        `${anio}: el salario de la zlfn (${zlfn.diario}) no es mayor que el general (${general.diario})`,
      );
    }
  }
  return fallas;
}

const claveTramo = (anio: number, periodo: string, tramo: number): string =>
  `${anio} ${periodo}, tramo ${tramo}`;

/** Revisa los tramos de una tarifa; usa y marca las excepciones de cuota fija que le tocan. */
function revisarTarifa(
  tarifa: TarifaIsr,
  excepciones: ReadonlyMap<string, ExcepcionCuotaFija>,
  usadas: Set<string>,
): string[] {
  const fallas: string[] = [];
  const { tramos } = tarifa;
  if (!new RegExp(`(?<!\\d)${tarifa.anio}(?!\\d)`).test(tarifa.fuente.fragmento)) {
    // El nombre del Anexo lleva el año de la RMF, no el de la tarifa: solo cuenta el fragmento.
    fallas.push(
      `${tarifa.anio} ${tarifa.periodo}: el fragmento de la fuente no menciona el año ${tarifa.anio}`,
    );
  }
  tramos.forEach((t, i) => {
    const clave = claveTramo(tarifa.anio, tarifa.periodo, i + 1);
    const falla = (texto: string) => fallas.push(`${clave}: ${texto}`);
    const inferior = aCentavos(t.limite_inferior);
    const tasa = aCentavos(t.tasa_excedente);
    const ultimo = i === tramos.length - 1;
    if (t.limite_superior === null && !ultimo) {
      falla("solo el último tramo puede no tener límite superior");
    }
    if (t.limite_superior !== null && ultimo)
      falla("el último tramo no debe tener límite superior");
    if (t.limite_superior !== null && aCentavos(t.limite_superior) <= inferior) {
      falla("limite_superior no es mayor que limite_inferior");
    }
    if (tasa > 10000n) falla(`la tasa ${t.tasa_excedente} pasa de 100`);

    const anterior = tramos[i - 1];
    if (anterior === undefined) {
      if (t.limite_inferior !== "0.01") {
        falla(`limite_inferior es ${t.limite_inferior}, se esperaba 0.01`);
      }
      if (t.cuota_fija !== "0.00") falla(`cuota_fija es ${t.cuota_fija}, se esperaba 0.00`);
      return;
    }
    if (tasa <= aCentavos(anterior.tasa_excedente)) {
      falla(
        `la tasa ${t.tasa_excedente} no es mayor que la del tramo anterior (${anterior.tasa_excedente})`,
      );
    }
    if (anterior.limite_superior === null) return;
    const superiorPrevio = aCentavos(anterior.limite_superior);
    if (inferior !== superiorPrevio + 1n) {
      falla(
        `limite_inferior es ${t.limite_inferior}, se esperaba ${deCentavos(superiorPrevio + 1n)}`,
      );
    }
    // cuota[i] = cuota[i-1] + (superior[i-1] − inferior[i-1]) × tasa[i-1] / 100; la tasa está
    // en centésimas de punto, de ahí el divisor de 10,000.
    const excedente = superiorPrevio - aCentavos(anterior.limite_inferior);
    const esperada =
      aCentavos(anterior.cuota_fija) +
      dividirRedondeando(excedente * aCentavos(anterior.tasa_excedente), 10000n);
    const calculada = deCentavos(esperada);
    const diferencia = aCentavos(t.cuota_fija) - esperada;
    const dentro = diferencia <= TOLERANCIA_CUOTA_FIJA && diferencia >= -TOLERANCIA_CUOTA_FIJA;
    const excepcion = excepciones.get(clave);
    if (excepcion === undefined) {
      if (!dentro) {
        falla(
          `cuota_fija es ${t.cuota_fija}, se esperaba ${calculada} ± ${deCentavos(TOLERANCIA_CUOTA_FIJA)}`,
        );
      }
      return;
    }
    usadas.add(clave);
    if (excepcion.publicada !== t.cuota_fija || excepcion.calculada !== calculada) {
      falla(
        `la excepción dice publicada ${excepcion.publicada} y calculada ${excepcion.calculada}; el YAML trae ${t.cuota_fija} y se calcula ${calculada}`,
      );
    } else if (dentro) {
      falla(`la excepción no hace falta (diferencia de ${deCentavos(diferencia)})`);
    }
  });
  return fallas;
}

/**
 * Las tasas de la LISR no se actualizan por inflación (solo los montos), así que todas las
 * tarifas del dataset comparten la columna de tasas; eso defiende la tasa del último tramo, que
 * no entra en ninguna cuota fija.
 */
function revisarColumnaDeTasas(registros: readonly TarifaIsr[]): string[] {
  const fallas: string[] = [];
  const [referencia, ...resto] = registros;
  if (referencia === undefined) return fallas;
  const nombre = `${referencia.anio} ${referencia.periodo}`;
  for (const tarifa of resto) {
    if (tarifa.tramos.length !== referencia.tramos.length) {
      fallas.push(
        `${tarifa.anio} ${tarifa.periodo}: tiene ${tarifa.tramos.length} tramos y ${nombre} tiene ${referencia.tramos.length}`,
      );
      continue;
    }
    tarifa.tramos.forEach((t, i) => {
      const esperada = referencia.tramos[i]?.tasa_excedente;
      if (t.tasa_excedente !== esperada) {
        fallas.push(
          `${claveTramo(tarifa.anio, tarifa.periodo, i + 1)}: la tasa ${t.tasa_excedente} no coincide con la de ${nombre} (${esperada})`,
        );
      }
    });
  }
  return fallas;
}

export function invariantesIsr(
  registros: readonly TarifaIsr[],
  excepciones: readonly ExcepcionCuotaFija[] = [],
): string[] {
  const fallas: string[] = [];
  const porTramo = new Map<string, ExcepcionCuotaFija>();
  for (const e of excepciones) {
    const clave = claveTramo(e.anio, e.periodo, e.tramo);
    if (porTramo.has(clave)) fallas.push(`${clave}: excepción de cuota_fija repetida`);
    porTramo.set(clave, e);
  }
  const usadas = new Set<string>();
  for (const tarifa of registros) fallas.push(...revisarTarifa(tarifa, porTramo, usadas));
  fallas.push(...revisarColumnaDeTasas(registros));
  for (const clave of porTramo.keys()) {
    if (!usadas.has(clave)) fallas.push(`${clave}: excepción de cuota_fija sin usar`);
  }
  return fallas;
}

const ORDINALES: Record<string, number> = {
  primer: 1,
  primero: 1,
  segundo: 2,
  tercer: 3,
  tercero: 3,
  cuarto: 4,
  quinto: 5,
};
const DIAS: Record<string, DiaSemana> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sábado: 6,
};
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
// Los límites de palabra con lookarounds: \b no reconoce letras acentuadas como "ú".
const REGLA = new RegExp(
  `(?<![\\p{L}\\d])(${Object.keys(ORDINALES).join("|")})\\s+(${Object.keys(DIAS).join("|")})\\s+(?:de|del\\s+mes\\s+de)\\s+(${MESES.join("|")})(?!\\p{L})`,
  "gu",
);
/**
 * Cualquier ordinal (en letra o con número: "3er", "1o.") seguido de un día de la semana. Si no
 * forma parte de una regla reconocida, el día falla en lugar de pasar sin revisar.
 */
const MENCION =
  /(?<![\p{L}\d])(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|pen[uú]ltim[oa]|[uú]ltim[oa]|\d+\s*(?:er|ro|do|to|vo|no|[oº°])\.?)\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?!\p{L})/gu;

/**
 * Fallas de las reglas tipo "tercer lunes de noviembre" que trae el motivo. La regla debe nombrar
 * el mes ("de noviembre" o "del mes de noviembre"); "de dicho mes", "3er lunes" o "(tercer
 * lunes)" no se reconocen y fallan.
 */
function revisarReglas(dia: DiaInhabilCurado): string[] {
  const fallas: string[] = [];
  const anio = Number(dia.fecha.slice(0, 4));
  const motivo = dia.motivo.toLowerCase();
  const reconocidas = new Set([...motivo.matchAll(REGLA)].map((m) => m.index));
  for (const m of motivo.matchAll(MENCION)) {
    if (!reconocidas.has(m.index)) {
      fallas.push(
        `regla no reconocida ("${m[0]}"); nombra el mes y el día de la semana, por ejemplo "tercer lunes de noviembre"`,
      );
    }
  }
  for (const m of motivo.matchAll(REGLA)) {
    const [regla, ordinal = "", nombreDia = "", mes = ""] = m;
    let calculada: string;
    try {
      calculada = enesimoDiaDeSemana(
        anio,
        MESES.indexOf(mes) + 1,
        ORDINALES[ordinal] as number,
        DIAS[nombreDia] as DiaSemana,
      );
    } catch {
      fallas.push(`el motivo dice ${regla}, que no existe en ${anio}`);
      continue;
    }
    if (calculada !== dia.fecha) {
      fallas.push(`el motivo dice ${regla}, que en ${anio} es ${calculada}`);
    }
  }
  return fallas;
}

export function invariantesDias(autoridad: AutoridadCurada) {
  return (registros: readonly DiaInhabilCurado[], cobertura: CoberturaCurada | null): string[] => {
    const fallas: string[] = [];
    for (const dia of registros) {
      const falla = (texto: string) => fallas.push(`${dia.fecha}: ${texto}`);
      if (dia.autoridad !== autoridad) {
        falla(`la autoridad es ${dia.autoridad}, se esperaba ${autoridad}`);
      }
      const rango = cobertura?.[dia.tipo];
      if (rango === undefined) {
        falla(`no hay cobertura para el tipo ${dia.tipo}`);
      } else if (dia.fecha < rango.desde || dia.fecha > rango.hasta) {
        falla(`está fuera de la cobertura de ${dia.tipo} (${rango.desde} a ${rango.hasta})`);
      }
      for (const f of revisarReglas(dia)) falla(f);
    }
    return fallas;
  };
}
