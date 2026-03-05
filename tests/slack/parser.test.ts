import { describe, it, expect } from "bun:test";
import { parseMessage } from "../../src/slack/parser";

describe("parseMessage", () => {
  it("extracts repo and prompt from message", () => {
    const result = parseMessage("repo:my-project fix this bug");
    expect(result.repo).toBe("my-project");
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
});
