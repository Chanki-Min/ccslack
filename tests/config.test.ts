import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const TEST_CONFIG_DIR = join(import.meta.dir, ".test-ccslack");
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");

describe("loadConfig", () => {
  beforeEach(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it("loads a valid config file", () => {
    const config = {
      allowedUsers: ["U123"],
      maxConcurrency: 3,
      taskTimeout: 600000,
      defaultRepo: "test-repo",
      claudePath: "/usr/local/bin/claude",
      repos: { "test-repo": "/tmp/test-repo" },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.allowedUsers).toEqual(["U123"]);
    expect(result.maxConcurrency).toBe(3);
    expect(result.repos["test-repo"]).toBe("/tmp/test-repo");
  });

  it("applies defaults for optional fields", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: { "my-repo": "/tmp/my-repo" },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.maxConcurrency).toBe(2);
    expect(result.taskTimeout).toBe(300000);
    expect(result.claudePath).toBe("claude");
  });

  it("throws if config file is missing", () => {
    expect(() => loadConfig("/nonexistent/config.json")).toThrow();
  });

  it("throws if allowedUsers is empty", () => {
    const config = { allowedUsers: [], repos: {} };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow();
  });

  it("loads allowedTools from config", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
      allowedTools: ["Bash", "Read", "Write"],
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.allowedTools).toEqual(["Bash", "Read", "Write"]);
  });

  it("loads suggestedPrompts from config", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
      suggestedPrompts: [
        { title: "Hello", message: "Say hello" },
        { title: "Status", message: "Check git status" },
      ],
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.suggestedPrompts).toEqual([
      { title: "Hello", message: "Say hello" },
      { title: "Status", message: "Check git status" },
    ]);
  });

  it("defaults allowedTools and suggestedPrompts to empty arrays", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.allowedTools).toEqual([]);
    expect(result.suggestedPrompts).toEqual([]);
  });
});
