import { validarClabe } from "@mexicoapi/core";
import { describe, expect, it } from "vitest";

describe("resolución del núcleo", () => {
  it("importa @mexicoapi/core desde el código fuente", () => {
    expect(validarClabe("002180012345678906").valido).toBe(true);
  });
});
