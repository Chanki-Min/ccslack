import { describe, expect, it } from "bun:test";
import { CancelMap } from "../../src/slack/cancelMap";

describe("CancelMap", () => {
  it("register returns an AbortSignal", () => {
    const map = new CancelMap();
    const signal = map.register("ts-001");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("cancel aborts the registered signal", () => {
    const map = new CancelMap();
    const signal = map.register("ts-001");
    const result = map.cancel("ts-001");
    expect(result).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it("cancel returns false for unknown ts", () => {
    const map = new CancelMap();
    const result = map.cancel("unknown");
    expect(result).toBe(false);
  });

  it("unregister removes the entry", () => {
    const map = new CancelMap();
    map.register("ts-001");
    map.unregister("ts-001");
    const result = map.cancel("ts-001");
    expect(result).toBe(false);
  });

  it("unregister does not abort the signal", () => {
    const map = new CancelMap();
    const signal = map.register("ts-001");
    map.unregister("ts-001");
    expect(signal.aborted).toBe(false);
    expect(map.cancel("ts-001")).toBe(false);
  });
});
