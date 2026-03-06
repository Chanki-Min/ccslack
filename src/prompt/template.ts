import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CCSlackConfig } from "../config";

const KNOWN_VARS = ["prompt", "thread", "repo", "global"] as const;

const DEFAULT_TEMPLATE_PATH = resolve(import.meta.dir, "../../templates/default.txt");

export function expandPath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return (process.env.HOME || "") + filePath.slice(1);
  }
  return filePath;
}

export function loadTemplate(filePath: string): string {
  const expanded = expandPath(filePath);

  try {
    return readFileSync(expanded, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Template file not found: ${expanded}`);
    }
    throw err;
  }
}

export function renderTemplate(
  template: string,
  vars: Record<(typeof KNOWN_VARS)[number], string>,
): string {
  let result = template;
  for (const key of KNOWN_VARS) {
    result = result.replaceAll(`{{${key}}}`, vars[key]);
  }
  return result;
}

function getRepoConfig(config: CCSlackConfig, repoName: string): { promptTemplate?: string } {
  const entry = config.repos[repoName];
  if (!entry || typeof entry === "string") return {};
  return entry;
}

export function buildPrompt(opts: {
  config: CCSlackConfig;
  repoName: string;
  prompt: string;
  threadContext: string;
}): string {
  const { config, repoName, prompt, threadContext } = opts;
  const repoConfig = getRepoConfig(config, repoName);

  const globalTemplatePath = config.promptTemplate ?? DEFAULT_TEMPLATE_PATH;
  const globalTemplate = loadTemplate(globalTemplatePath);

  const baseVars = { prompt, thread: threadContext, repo: repoName, global: "" };

  const renderedGlobal = renderTemplate(globalTemplate, baseVars).trimEnd();

  if (repoConfig.promptTemplate) {
    const repoTemplate = loadTemplate(repoConfig.promptTemplate);
    return renderTemplate(repoTemplate, { ...baseVars, global: renderedGlobal }).trimEnd();
  }

  return renderedGlobal;
}
