import { describe, it, expect } from "vitest"
import {
  htmlToText,
  decodeHtmlEntities,
  removeScriptTags,
  removeStyleTags,
  stripHtmlTags,
  cleanHtmlEntities,
  looksLikeCode,
  stripCodeFromText,
  htmlToTextClean,
} from "../../shared/html-utils.js"

describe("decodeHtmlEntities", () => {
  it("decodes named entities", () => {
    expect(decodeHtmlEntities("&amp; &lt; &gt; &quot;")).toBe('& < > "')
  })

  it("decodes decimal numeric entities", () => {
    expect(decodeHtmlEntities("&#38; &#60;")).toBe("& <")
  })

  it("decodes hexadecimal numeric entities", () => {
    expect(decodeHtmlEntities("&#x26; &#x3C;")).toBe("& <")
  })

  it("passes through plain text unchanged", () => {
    expect(decodeHtmlEntities("Hello world")).toBe("Hello world")
  })

  it("handles mixed entities and text", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry &mdash; a classic")).toBe(
      "Tom & Jerry \u2014 a classic"
    )
  })
})

describe("removeScriptTags", () => {
  it("removes script tags and their content", () => {
    const html = '<p>Hello</p><script>alert("evil")</script><p>World</p>'
    expect(removeScriptTags(html)).toBe("<p>Hello</p><p>World</p>")
  })

  it("handles multiple script tags", () => {
    const html = "<p>A</p><script>x()</script><p>B</p><script>y()</script><p>C</p>"
    expect(removeScriptTags(html)).toBe("<p>A</p><p>B</p><p>C</p>")
  })

  it("handles case-insensitive script tags", () => {
    const html = "<p>Text</p><SCRIPT>code()</SCRIPT><p>More</p>"
    expect(removeScriptTags(html)).toBe("<p>Text</p><p>More</p>")
  })

  it("handles script tags with attributes", () => {
    const html = '<p>Text</p><script type="text/javascript">code()</script><p>More</p>'
    expect(removeScriptTags(html)).toBe("<p>Text</p><p>More</p>")
  })

  it("returns text unchanged when no script tags present", () => {
    const html = "<p>No scripts here</p>"
    expect(removeScriptTags(html)).toBe("<p>No scripts here</p>")
  })

  it("handles malformed script tag without closing bracket", () => {
    const html = "<p>Before</p><script malformed"
    expect(removeScriptTags(html)).toBe("<p>Before</p>")
  })
})

describe("removeStyleTags", () => {
  it("removes style tags and their content", () => {
    const html = "<p>Hello</p><style>body { color: red; }</style><p>World</p>"
    expect(removeStyleTags(html)).toBe("<p>Hello</p><p>World</p>")
  })

  it("handles multiple style tags", () => {
    const html = "<style>.a{}</style><p>Text</p><style>.b{}</style><p>More</p>"
    expect(removeStyleTags(html)).toBe("<p>Text</p><p>More</p>")
  })

  it("returns text unchanged when no style tags present", () => {
    const html = "<p>No styles here</p>"
    expect(removeStyleTags(html)).toBe("<p>No styles here</p>")
  })
})

describe("stripHtmlTags", () => {
  it("strips all HTML tags, replacing with spaces", () => {
    expect(stripHtmlTags("<p>Hello</p> <b>World</b>")).toBe(" Hello   World ")
  })

  it("handles self-closing tags", () => {
    expect(stripHtmlTags("Line 1<br/>Line 2")).toBe("Line 1 Line 2")
  })

  it("handles tags with attributes", () => {
    expect(stripHtmlTags('<a href="http://example.com">Link</a>')).toBe(" Link ")
  })

  it("returns plain text unchanged", () => {
    expect(stripHtmlTags("No tags here")).toBe("No tags here")
  })
})

describe("htmlToText", () => {
  it("converts HTML to clean plain text", () => {
    const html = "<p>Hello</p><p>World</p>"
    const result = htmlToText(html)
    expect(result).toBe("Hello World")
  })

  it("strips script tags before processing", () => {
    const html = '<p>Text</p><script>alert("xss")</script><p>More text</p>'
    const result = htmlToText(html)
    expect(result).toBe("Text More text")
  })

  it("strips style tags before processing", () => {
    const html = "<style>.red { color: red; }</style><p>Visible text</p>"
    const result = htmlToText(html)
    expect(result).toBe("Visible text")
  })

  it("decodes HTML entities", () => {
    const html = "<p>Tom &amp; Jerry &mdash; a classic</p>"
    const result = htmlToText(html)
    expect(result).toContain("Tom & Jerry")
    expect(result).toContain("\u2014")
  })

  it("normalizes whitespace", () => {
    const html = "<p>  Too   many    spaces  </p>"
    const result = htmlToText(html)
    expect(result).toBe("Too many spaces")
  })

  it("handles nested tags", () => {
    const html = "<div><p><strong>Bold</strong> and <em>italic</em></p></div>"
    const result = htmlToText(html)
    expect(result).toBe("Bold and italic")
  })

  it("handles malformed HTML gracefully", () => {
    const html = "<p>Unclosed paragraph<div>Another<p>Third"
    const result = htmlToText(html)
    expect(result).toContain("Unclosed paragraph")
    expect(result).toContain("Another")
    expect(result).toContain("Third")
  })

  it("handles empty input", () => {
    expect(htmlToText("")).toBe("")
  })

  it("handles input with only whitespace", () => {
    expect(htmlToText("   \n\t  ")).toBe("")
  })
})

describe("cleanHtmlEntities", () => {
  it("decodes entities without removing tags", () => {
    const html = "<p>Tom &amp; Jerry</p>"
    const result = cleanHtmlEntities(html)
    expect(result).toBe("<p>Tom & Jerry</p>")
  })

  it("normalizes whitespace", () => {
    const html = "<p>  spaced   out  </p>"
    expect(cleanHtmlEntities(html)).toBe("<p> spaced out </p>")
  })
})

describe("looksLikeCode", () => {
  it("returns true for JavaScript-like code", () => {
    const code = 'const x = 5; if (x > 3) { console.log("hello"); }'
    expect(looksLikeCode(code)).toBe(true)
  })

  it("returns false for normal text", () => {
    const text = "John was born in Kansas and grew up on a farm with his family."
    expect(looksLikeCode(text)).toBe(false)
  })

  it("returns false for empty text", () => {
    expect(looksLikeCode("")).toBe(false)
  })

  it("returns false for very short text", () => {
    expect(looksLikeCode("short")).toBe(false)
  })
})

describe("stripCodeFromText", () => {
  it("returns empty string for full code block", () => {
    const code = "function hello() { const x = 5; return x; } console.log(hello());"
    expect(stripCodeFromText(code)).toBe("")
  })

  it("returns empty string for empty input", () => {
    expect(stripCodeFromText("")).toBe("")
  })

  it("preserves natural language text", () => {
    const text =
      "John was born in a small town. He went to university in 1985. He married Jane in 1990."
    const result = stripCodeFromText(text)
    expect(result).toContain("John was born")
    expect(result).toContain("university in 1985")
  })
})

describe("htmlToTextClean", () => {
  it("combines HTML cleaning with code stripping", () => {
    const html = "<p>John was born in Kansas and grew up on a farm with his family and friends.</p>"
    const result = htmlToTextClean(html)
    expect(result).toContain("John was born in Kansas")
  })
})
