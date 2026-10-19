// Worker mínimo que usa mexicoapi como un proyecto de Cloudflare: lo importa por su nombre desde el
// paquete instalado y wrangler lo empaqueta, sin `nodejs_compat`. El cliente responde sin red, con
// los datos del paquete, y en /cliente/api con la red de workerd contra la API falsa de la prueba.
import {
  calendarioLft,
  fixPublicado,
  hoyEnMexico,
  sumarDiasHabiles,
  udiDeFecha,
  validarClabe,
} from "mexicoapi";
import { crearCliente, MexicoApiError } from "mexicoapi/cliente";
import { buscarMunicipio, catalogoClabe, estados } from "mexicoapi/datos";
import { calendario } from "mexicoapi/datos/calendarios";
import { umaVigente } from "mexicoapi/datos/constantes";
import * as fix from "mexicoapi/datos/fix";
import * as udis from "mexicoapi/datos/udis";

const api = crearCliente({ offline: true });

function calendarioDe(autoridad, tipoPlazo) {
  if (autoridad === "lft") return calendarioLft();
  return tipoPlazo === null ? calendario(autoridad) : calendario(autoridad, tipoPlazo);
}

async function responder(url) {
  const q = (nombre) => url.searchParams.get(nombre);
  switch (url.pathname) {
    case "/clabe":
      return validarClabe(q("valor") ?? "", { bancos: catalogoClabe() });
    case "/hoy":
      // La zona de la Ciudad de México con el Intl de workerd.
      return { hoy: hoyEnMexico(Date.parse(q("ahora") ?? "")) };
    case "/municipios":
      return { estados: estados().length, encontrados: buscarMunicipio(q("texto") ?? "") };
    case "/dias-habiles":
      return sumarDiasHabiles({
        calendario: calendarioDe(q("autoridad"), q("tipo_plazo")),
        desde: q("desde"),
        dias: Number(q("dias")),
      });
    case "/indicadores":
      return {
        fix: fixPublicado(fix.serie, fix.tramo, fix.cobertura, fix.cobertura.hasta),
        udi: udiDeFecha(udis.serie, udis.tramo, udis.cobertura, udis.cobertura.hasta),
        uma: umaVigente(q("fecha")),
      };
    case "/cliente/dias-habiles": {
      const { data, origen } = await api.diasHabiles({
        autoridad: "sat",
        tipoPlazo: "general",
        desde: q("desde"),
        dias: Number(q("dias")),
      });
      return { origen, resultado: data.resultado };
    }
    case "/cliente/banco":
      try {
        const { data, origen } = await api.banco(q("codigo") ?? "");
        return { origen, nombre_corto: data.nombre_corto };
      } catch (error) {
        if (!(error instanceof MexicoApiError)) throw error;
        return { error: { status: error.status, tipo: error.tipo, origen: error.origen } };
      }
    case "/cliente/api": {
      // Con red: workerd rechaza algunas opciones de fetch que Node acepta (redirect: "error").
      const conRed = crearCliente({ base: q("base") ?? "", reintentos: 0, esperaMaximaMs: 0 });
      try {
        const { data, origen } = await conRed.estados({ fuente: "api" });
        return { origen, estados: data.length };
      } catch (error) {
        if (!(error instanceof MexicoApiError)) throw error;
        return { error: { status: error.status, title: error.title, detail: error.detail } };
      }
    }
    default:
      return undefined;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      const respuesta = await responder(url);
      if (respuesta === undefined)
        return Response.json({ error: "ruta desconocida" }, { status: 404 });
      return Response.json(respuesta);
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
