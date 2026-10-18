import { describe, expect, it } from "vitest";
import { claveLimite } from "../../src/limite.js";

describe("claveLimite", () => {
  it("una IPv4 va completa", () => {
    expect(claveLimite("203.0.113.7")).toBe("ip:203.0.113.7");
    expect(claveLimite("203.0.113.8")).toBe("ip:203.0.113.8");
  });

  it("una IPv6 se agrupa por su prefijo /64, completa o comprimida", () => {
    for (const ip of [
      "2001:0db8:0001:0002:0003:0004:0005:0006",
      "2001:db8:1:2:3:4:5:6",
      "2001:db8:1:2::5",
      "2001:DB8:1:2:AAAA:bbbb:cccc:dddd",
      "2001:db8:1:2::",
    ]) {
      expect(claveLimite(ip), ip).toBe("ip:2001:db8:1:2::/64");
    }
    expect(claveLimite("2001:db8:1:3::5")).toBe("ip:2001:db8:1:3::/64");
  });

  it("expande :: al principio, en medio y al final", () => {
    expect(claveLimite("::1")).toBe("ip:0:0:0:0::/64");
    expect(claveLimite("::")).toBe("ip:0:0:0:0::/64");
    expect(claveLimite("2001:db8::1")).toBe("ip:2001:db8:0:0::/64");
    expect(claveLimite("1:2:3:4:5:6:7::")).toBe("ip:1:2:3:4::/64");
    expect(claveLimite("1::8")).toBe("ip:1:0:0:0::/64");
  });

  it("lo que no es una IPv6 de 8 grupos hexadecimales se usa tal cual", () => {
    for (const ip of [
      "fe80::1%eth0",
      "[2001:db8::1]:443",
      "2001:db8::1::2",
      "2001:db8:1:2:3:4:5:6:7",
      "2001:db8:1:2:3:4:5",
      "1:2:3:4:5:6:7:8::",
      "::ffff:203.0.113.7",
      "12345::",
      ":1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:",
      "g::1",
      ":",
      "desconocida",
    ]) {
      expect(claveLimite(ip), ip).toBe(`ip:${ip}`);
    }
  });
});
