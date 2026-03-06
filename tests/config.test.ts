import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";

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

  it("defaults maxOutputTokens to 128000", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.maxOutputTokens).toBe(128000);
  });

  it("loads defaultModel from config", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
      defaultModel: "sonnet",
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.defaultModel).toBe("sonnet");
  });

  it("defaults defaultModel to undefined", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.defaultModel).toBeUndefined();
  });

  it("defaults enableSessionContinuity to true", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.enableSessionContinuity).toBe(true);
  });

  it("respects enableSessionContinuity: false", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
      enableSessionContinuity: false,
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.enableSessionContinuity).toBe(false);
  });

  it("loads promptTemplate from config when file exists", () => {
    const tplPath = join(TEST_CONFIG_DIR, "global.txt");
    writeFileSync(tplPath, "{{prompt}}");
    const config = {
      allowedUsers: ["U123"],
      repos: {},
      promptTemplate: tplPath,
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.promptTemplate).toBe(tplPath);
  });

  it("throws if promptTemplate file does not exist", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {},
      promptTemplate: "/nonexistent/global.txt",
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow("template file not found");
  });

  it("supports object repo config with path and promptTemplate", () => {
    const tplPath = join(TEST_CONFIG_DIR, "frontend.txt");
    writeFileSync(tplPath, "{{prompt}}");
    const config = {
      allowedUsers: ["U123"],
      repos: {
        frontend: {
          path: "/home/user/projects/frontend",
          promptTemplate: tplPath,
        },
      },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.repos.frontend).toEqual({
      path: "/home/user/projects/frontend",
      promptTemplate: tplPath,
    });
  });

  it("throws if repo promptTemplate file does not exist", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {
        frontend: {
          path: "/home/user/projects/frontend",
          promptTemplate: "/nonexistent/frontend.txt",
        },
      },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow("template file not found");
  });

  it("throws if object repo config is missing path", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: {
        broken: { promptTemplate: "/some/template.txt" },
      },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow('"path" is required');
  });

  it("supports string repo config (backward compat)", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: { backend: "/home/user/projects/backend" },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.repos.backend).toBe("/home/user/projects/backend");
  });
});
