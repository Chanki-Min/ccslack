import { existsSync, readFileSync } from "node:fs";
import { expandPath } from "./prompt/template";

export interface CCSlackConfig {
  allowedUsers: string[];
  maxConcurrency: number;
  taskTimeout: number;
  defaultRepo?: string;
  claudePath: string;
  repos: Record<string, string | { path: string; promptTemplate?: string }>;
  promptTemplate?: string;
  allowedTools?: string[];
  suggestedPrompts?: Array<{ title: string; message: string }>;
  maxOutputTokens?: number;
  defaultModel?: string;
  enableSessionContinuity?: boolean;
}

const DEFAULTS: Partial<CCSlackConfig> = {
  maxConcurrency: 2,
  taskTimeout: 300000,
  claudePath: "claude",
  allowedTools: [],
  suggestedPrompts: [],
  maxOutputTokens: 128000,
  enableSessionContinuity: true,
};

function validateTemplatePath(filePath: string, label: string): void {
  const expanded = expandPath(filePath);
  if (!existsSync(expanded)) {
    throw new Error(`${label} template file not found: ${expanded}`);
  }
}

function validateRepoEntry(name: string, entry: string | { path: string; promptTemplate?: string }): void {
  if (typeof entry === "object") {
    if (!entry.path) {
      throw new Error(`repos.${name}: "path" is required`);
    }
    if (entry.promptTemplate) {
      validateTemplatePath(entry.promptTemplate, `repos.${name}.promptTemplate`);
    }
  }
}

export function loadConfig(configPath: string): CCSlackConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = JSON.parse(readFileSync(configPath, "utf-8"));

  const config: CCSlackConfig = {
    ...DEFAULTS,
    ...raw,
  } as CCSlackConfig;

  if (!config.allowedUsers || config.allowedUsers.length === 0) {
    throw new Error("allowedUsers must contain at least one Slack User ID");
  }

  if (config.promptTemplate) {
    validateTemplatePath(config.promptTemplate, "promptTemplate");
  }

  for (const [name, entry] of Object.entries(config.repos)) {
    validateRepoEntry(name, entry);
  }

  return config;
}

export const DEFAULT_CONFIG_PATH = `${process.env.HOME}/.ccslack/config.json`;
