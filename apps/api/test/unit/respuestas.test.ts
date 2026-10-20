import { describe, expect, it } from "vitest";
import {
  CACHE_DATOS,
  CACHE_STATUS,
  CACHE_ULTIMO,
  encabezados,
  respuestaJson,
  respuestaProblema,
  respuestaVacia,
  sinCuerpo,
} from "../../src/respuestas.js";
import { SEGURIDAD_ESPERADA, seguridadDe } from "./ayudas.js";

describe("constantes de caché", () => {
  it("datos sin s-maxage, status de un minuto y el último FIX de cinco minutos sin stale", () => {
    expect(CACHE_DATOS).toBe(
      "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800",
    );
    expect(CACHE_STATUS).toBe("public, max-age=60");
    expect(CACHE_ULTIMO).toBe("public, max-age=300");
  });
});

describe("encabezados", () => {
  it("HSTS de un año, sin includeSubDomains ni preload, y no se puede pisar", () => {
    expect(encabezados().get("strict-transport-security")).toBe("max-age=31536000");
    const pisado = encabezados({ "Strict-Transport-Security": "max-age=0" });
    expect(pisado.get("strict-transport-security")).toBe("max-age=31536000");
  });

  // La plataforma comprime según Accept-Encoding: un caché compartido debe guardar cada versión
  // por separado (RFC 9110, 12.5.5).
  it("Vary: Accept-Encoding, junto al Vary que ya traiga y sin repetirlo", () => {
    expect(encabezados().get("vary")).toBe("Accept-Encoding");
    expect(encabezados({ Vary: "Origin" }).get("vary")).toBe("Origin, Accept-Encoding");
    for (const vary of [
      "accept-encoding",
      "Origin, Accept-Encoding",
      "Origin,accept-encoding",
      "*",
    ]) {
      expect(encabezados({ Vary: vary }).get("vary"), vary).toBe(vary);
    }
  });
});

describe("respuestaJson", () => {
  it("serializa con los encabezados de seguridad y sin caché por omisión", async () => {
    const r = respuestaJson({ a: "é" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(seguridadDe(r)).toEqual(SEGURIDAD_ESPERADA);
    expect(await r.text()).toBe('{"a":"é"}');
  });

  it("acepta status, caché y encabezados extra sin que pisen los de seguridad", () => {
    const r = respuestaJson([], {
      status: 201,
      cache: CACHE_DATOS,
      encabezados: { ETag: '"x"', "X-Content-Type-Options": "otro", "Content-Type": "text/html" },
    });
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe(CACHE_DATOS);
    expect(r.headers.get("etag")).toBe('"x"');
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(seguridadDe(r)).toEqual(SEGURIDAD_ESPERADA);
  });
});

describe("respuestaVacia", () => {
  it("no tiene cuerpo y lleva los encabezados de seguridad", async () => {
    const r = respuestaVacia(204, { "Access-Control-Max-Age": "86400" });
    expect(r.status).toBe(204);
    expect(r.body).toBeNull();
    expect(r.headers.get("access-control-max-age")).toBe("86400");
    expect(seguridadDe(r)).toEqual(SEGURIDAD_ESPERADA);
  });
});

describe("respuestaProblema", () => {
  it("arma problem+json sin caché con el type de la documentación", async () => {
    const r = respuestaProblema("no-encontrado", "No existe el estado 33.");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(seguridadDe(r)).toEqual(SEGURIDAD_ESPERADA);
    expect(await r.json()).toEqual({
      type: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#no-encontrado",
      title: "Recurso no encontrado",
      status: 404,
      detail: "No existe el estado 33.",
    });
  });

  it("agrega la instancia y las extensiones después de los campos fijos", async () => {
    const r = respuestaProblema(
      "parametro-invalido",
      "El parámetro cve_ent debe tener 2 dígitos.",
      { parametro: "cve_ent" },
      "/v1/estados/2a",
    );
    expect(r.status).toBe(400);
    const texto = await r.text();
    expect(Object.keys(JSON.parse(texto))).toEqual([
      "type",
      "title",
      "status",
      "detail",
      "instance",
      "parametro",
    ]);
    expect(JSON.parse(texto)).toMatchObject({ instance: "/v1/estados/2a", parametro: "cve_ent" });
  });

  it("las extensiones no pisan los campos fijos", async () => {
    const r = respuestaProblema("error-interno", "Ocurrió un error interno.", {
      type: "x",
      title: "x",
      status: 200,
      detail: "x",
      instance: "x",
    });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({
      type: "https://github.com/Dagel4k/mexicoapi/blob/main/docs/api/problemas.md#error-interno",
      title: "Error interno",
      status: 500,
      detail: "Ocurrió un error interno.",
    });
  });
});

describe("sinCuerpo", () => {
  it("cancela el cuerpo que reemplaza y conserva status y encabezados", async () => {
    let cancelado = false;
    const cuerpo = new ReadableStream<Uint8Array>({
      pull(controlador) {
        controlador.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelado = true;
      },
    });
    const original = new Response(cuerpo, { status: 201, headers: { ETag: '"x"' } });
    const r = await sinCuerpo(original);
    expect(cancelado).toBe(true);
    expect(r.status).toBe(201);
    expect(r.body).toBeNull();
    expect([...r.headers]).toEqual([...original.headers]);
  });

  it("acepta una respuesta que ya no tiene cuerpo", async () => {
    const r = await sinCuerpo(respuestaVacia(204));
    expect(r.status).toBe(204);
    expect(r.body).toBeNull();
  });
});
