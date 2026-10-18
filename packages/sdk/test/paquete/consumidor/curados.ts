// Los datos curados desde un proyecto que usa el paquete publicado: calendarios de la CNBV y el
// SAT con sus plazos, y las constantes, con los tipos del núcleo que exporta la entrada principal.
import {
  type DiaInhabilCurado,
  type ResultadoDiasHabiles,
  type SalarioMinimo,
  sumarDiasHabiles,
  type TarifaIsr,
  type TipoPlazo,
  type Uma,
} from "mexicoapi";
import { type CalendarioCurado, calendario, calendarioCurado } from "mexicoapi/datos/calendarios";
import { anios, salarioMinimo, tarifaIsr, umaVigente } from "mexicoapi/datos/constantes";

const tipo: TipoPlazo = "declaraciones_pagos";
const plazo: ResultadoDiasHabiles = sumarDiasHabiles({
  calendario: calendario("sat", tipo),
  desde: "2026-07-17",
  dias: 3,
});
const sat: CalendarioCurado = calendarioCurado("sat");
const hastaGeneral: string = sat.general.cobertura.hasta;
const respaldo: boolean = sat.plazos.general?.respaldo !== undefined;
const dia: DiaInhabilCurado | undefined = undefined;
const uma: Uma | undefined = umaVigente("2026-01-15");
const salarios: readonly SalarioMinimo[] = salarioMinimo(2026);
const isr: TarifaIsr | undefined = tarifaIsr("mensual", anios.isr.mensual[0] ?? 2026);

export const curados = [
  plazo.resultado,
  hastaGeneral,
  respaldo,
  dia,
  uma?.diaria,
  salarios.length,
  isr?.tramos[0]?.limite_superior,
];
