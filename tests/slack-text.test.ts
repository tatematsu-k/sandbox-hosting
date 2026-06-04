import { describe, expect, it } from "vitest";
import { parseSlackText } from "@/src/lib/slack-text";

describe("parseSlackText", () => {
  it("returns empty payload for empty text", () => {
    expect(parseSlackText("")).toEqual({ payload: "", asFileUrl: null });
  });

  it("detects single-token custom path", () => {
    expect(parseSlackText("demo-foo")).toEqual({
      customPath: "demo-foo",
      payload: "",
      asFileUrl: null,
    });
  });

  it("splits custom path + inline html", () => {
    const result = parseSlackText("demo-foo <html>hi</html>");
    expect(result.customPath).toBe("demo-foo");
    expect(result.payload).toBe("<html>hi</html>");
    expect(result.asFileUrl).toBeNull();
  });

  it("does not extract URL embedded inside HTML payload", () => {
    const html = `<p>see https://example.com here</p>`;
    expect(parseSlackText(html)).toEqual({
      payload: html,
      asFileUrl: null,
    });
  });

  it("recognises a payload that is itself a URL", () => {
    const url = "https://files.slack.com/x/site.zip";
    expect(parseSlackText(url)).toEqual({
      payload: url,
      asFileUrl: url,
    });
  });

  it("recognises custom-path + URL", () => {
    const result = parseSlackText("demo-foo https://files.example.com/site.zip");
    expect(result.customPath).toBe("demo-foo");
    expect(result.asFileUrl).toBe("https://files.example.com/site.zip");
  });

  it("rejects upper-case as custom path", () => {
    expect(parseSlackText("DEMO foo")).toEqual({
      payload: "DEMO foo",
      asFileUrl: null,
    });
  });
});
