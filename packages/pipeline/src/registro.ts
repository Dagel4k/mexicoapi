import { bancos } from "./datasets/bancos/bancos.js";
import { estadosInegi, municipiosInegi } from "./datasets/inegi.js";
import type { DefinicionDataset } from "./marco.js";

// biome-ignore lint/suspicious/noExplicitAny: el mapa mezcla datasets de distintos tipos
export const DATASETS: ReadonlyMap<string, DefinicionDataset<any>> = new Map(
  [estadosInegi, municipiosInegi, bancos].map((d) => [d.id, d] as const),
);
