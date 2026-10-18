import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATASETS } from "../src/registro.js";

const REAL = fileURLToPath(new URL("../../../data", import.meta.url));

interface Manifiesto {
  sources: { url: string; raw: { url: string }[] }[];
}

describe("hosts de los datasets", () => {
  it("cada dataset declara al menos un host, en minúsculas y sin esquema ni ruta", () => {
    for (const def of DATASETS.values()) {
      expect(def.hosts.length, def.id).toBeGreaterThan(0);
      for (const host of def.hosts) {
        expect(new URL(`https://${host}`).host, def.id).toBe(host);
      }
    }
  });

  it("las URL de los crudos de data/ son https y de un host de su dataset", async () => {
    for (const def of DATASETS.values()) {
      const ruta = join(REAL, def.directorio, "manifest.json");
      const manifiesto = JSON.parse(await readFile(ruta, "utf8")) as Manifiesto;
      const urls = manifiesto.sources.flatMap((f) => f.raw.map((c) => c.url));
      expect(urls.length, def.id).toBeGreaterThan(0);
      for (const url of urls) {
        const { protocol, host } = new URL(url);
        expect(protocol, url).toBe("https:");
        expect(def.hosts, url).toContain(host);
      }
    }
  });
});
