import { describe, it, expect } from "bun:test";
import { parseMessage } from "../../src/slack/parser";

describe("parseMessage", () => {
  it("extracts repo and prompt from message", () => {
    const result = parseMessage("repo:my-project fix this bug");
    expect(result.repo).toBe("my-project");
    expect(result.model).toBeNull();
    expect(result.prompt).toBe("fix this bug");
  });

  it("handles repo with path", () => {
    const result = parseMessage("repo:~/projects/app add tests");
    expect(result.repo).toBe("~/projects/app");
    expect(result.prompt).toBe("add tests");
  });

  it("returns null repo when not specified", () => {
    const result = parseMessage("fix the typo in README");
    expect(result.repo).toBeNull();
    expect(result.model).toBeNull();
    expect(result.prompt).toBe("fix the typo in README");
  });

  it("strips bot mention from message", () => {
    const result = parseMessage("<@U12345> repo:my-project fix bug");
    expect(result.repo).toBe("my-project");
    expect(result.prompt).toBe("fix bug");
  });

  it("handles extra whitespace", () => {
    const result = parseMessage("  repo:test   do something  ");
    expect(result.repo).toBe("test");
    expect(result.prompt).toBe("do something");
  });

  it("extracts model prefix", () => {
    const result = parseMessage("model:sonnet fix this bug");
    expect(result.repo).toBeNull();
    expect(result.model).toBe("sonnet");
    expect(result.prompt).toBe("fix this bug");
  });

  it("handles both repo and model", () => {
    const result = parseMessage("repo:my-project model:opus add tests");
    expect(result.repo).toBe("my-project");
    expect(result.model).toBe("opus");
    expect(result.prompt).toBe("add tests");
  });

  it("handles model with full name", () => {
    const result = parseMessage("model:claude-sonnet-4-6 explain this code");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.prompt).toBe("explain this code");
  });
});
