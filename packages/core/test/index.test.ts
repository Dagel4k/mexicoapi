import { expect, test } from "vitest";
import { VERSION } from "../src/index.js";

test("expone la versión inicial", () => {
  expect(VERSION).toBe("0.0.0");
});
