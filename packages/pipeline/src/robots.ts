interface Regla {
  permite: boolean;
  prefijo: string;
}

/** Reglas de los grupos cuyos agentes cumplen `coincide`. */
function reglasDe(robotsTxt: string, coincide: (agente: string) => boolean): Regla[] {
  const reglas: Regla[] = [];
  let agentes: string[] = [];
  let enAgentes = false;
  for (const cruda of robotsTxt.split(/\r?\n/)) {
    const linea = cruda.replace(/#.*/, "").trim();
    const i = linea.indexOf(":");
    if (i < 0) continue;
    const campo = linea.slice(0, i).trim().toLowerCase();
    const valor = linea.slice(i + 1).trim();
    if (campo === "user-agent") {
      if (!enAgentes) agentes = [];
      agentes.push(valor.toLowerCase());
      enAgentes = true;
      continue;
    }
    enAgentes = false;
    if ((campo === "allow" || campo === "disallow") && agentes.some(coincide)) {
      reglas.push({ permite: campo === "allow", prefijo: valor });
    }
  }
  return reglas;
}

/** Decide si `agente` puede pedir `ruta` (path + query) según un robots.txt. */
export function permitidoPorRobots(robotsTxt: string, agente: string, ruta: string): boolean {
  const token = (agente.split("/")[0] ?? "").trim().toLowerCase();
  const propias = reglasDe(robotsTxt, (a) => a !== "*" && a !== "" && token.includes(a));
  const aplicables = propias.length > 0 ? propias : reglasDe(robotsTxt, (a) => a === "*");

  let mejor: Regla | null = null;
  for (const r of aplicables) {
    if (r.prefijo === "" || !ruta.startsWith(r.prefijo)) continue;
    if (
      mejor === null ||
      r.prefijo.length > mejor.prefijo.length ||
      (r.prefijo.length === mejor.prefijo.length && r.permite)
    ) {
      mejor = r;
    }
  }
  return mejor === null ? true : mejor.permite;
}
