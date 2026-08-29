import { describe, expect, it } from "vitest";
import { mdToHtml } from "@/src/lib/markdown";

describe("mdToHtml", () => {
  it("wraps rendered markdown in a full HTML document", () => {
    const html = mdToHtml("# Hello\n\nWorld **bold**");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("handles empty input", () => {
    const html = mdToHtml("");
    expect(html).toContain("<!DOCTYPE html>");
  });
});
