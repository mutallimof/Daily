import { describe, expect, it } from "vitest";
import { parseInline, parseRich } from "./rich";

describe("parseInline", () => {
  it("finds bold and italic pieces and keeps the text between them", () => {
    expect(parseInline("**wurde** vs. *würde* now")).toEqual([{ text: "wurde", bold: true }, { text: " vs. " }, { text: "würde", italic: true }, { text: " now" }]);
  });
  it("leaves lone asterisks and citations alone", () => {
    expect(parseInline("2 * 3 and [1] [2]")).toEqual([{ text: "2 * 3 and [1] [2]" }]);
    expect(parseInline("")).toEqual([{ text: "" }]);
  });
  it("never produces markup: tags stay plain text", () => {
    expect(parseInline("<b>x</b> **y**")).toEqual([{ text: "<b>x</b> " }, { text: "y", bold: true }]);
  });
});

describe("parseRich", () => {
  it("makes paragraphs and one list from consecutive bullet lines", () => {
    const blocks = parseRich("**Title:**\n\n* one **a**\n* two\n- three\n\nEnd.");
    expect(blocks.map((b) => b.type)).toEqual(["p", "ul", "p"]);
    const ul = blocks[1];
    expect(ul?.type === "ul" && ul.items.length).toBe(3);
  });
  it("joins the lines of a paragraph and handles empty input", () => {
    expect(parseRich("a\nb")).toEqual([{ type: "p", spans: [{ text: "a b" }] }]);
    expect(parseRich("  \n ")).toEqual([]);
  });
});
