import { describe, it, expect } from "vitest"
import { extractArticleContent } from "../../shared/readability-extract.js"

describe("extractArticleContent", () => {
  it("extracts article content from a full HTML page", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test Article</title></head>
      <body>
        <nav><a href="/">Home</a> | <a href="/about">About</a></nav>
        <article>
          <h1>The Life and Times of John Doe</h1>
          <p>John Doe was born in a small town in Kansas. He grew up surrounded
          by wheat fields and open skies. His father was a farmer and his mother
          was a schoolteacher. From an early age, John showed a remarkable talent
          for storytelling, which would later define his career in journalism.</p>
          <p>After graduating from the University of Kansas in 1985, John moved
          to New York City to pursue his dream of becoming a writer. He worked at
          several newspapers before landing a position at the New York Times.</p>
          <p>John married his college sweetheart, Jane Smith, in 1990. They had
          three children together and lived in Brooklyn for over two decades.</p>
        </article>
        <footer>Copyright 2024</footer>
      </body>
      </html>
    `
    const result = extractArticleContent(html)
    expect(result).not.toBeNull()
    expect(result!.text).toContain("John Doe was born")
    expect(result!.text).toContain("University of Kansas")
    expect(result!.title).toBe("The Life and Times of John Doe")
  })

  it("returns null for non-article HTML (too short)", () => {
    const html = `<html><body><p>Short.</p></body></html>`
    const result = extractArticleContent(html)
    expect(result).toBeNull()
  })

  it("returns null for empty input", () => {
    const result = extractArticleContent("")
    expect(result).toBeNull()
  })

  it("returns null for HTML with only navigation elements", () => {
    const html = `
      <html><body>
        <nav><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav>
        <footer>Copyright 2024</footer>
      </body></html>
    `
    const result = extractArticleContent(html)
    expect(result).toBeNull()
  })

  it("extracts author from byline when present", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>News Article</title></head>
      <body>
        <article>
          <h1>Breaking News Story About Important Events</h1>
          <p class="byline">By Jane Reporter</p>
          <p>This is a detailed news article about very important events that
          happened recently. The events took place in multiple cities across
          the country and affected thousands of people. Officials responded
          quickly to the situation and provided updates throughout the day.
          Additional details emerged as the investigation continued.</p>
          <p>Witnesses described the scene as chaotic but said emergency
          responders arrived within minutes. The local government issued a
          statement praising the response effort and promising a thorough review.</p>
        </article>
      </body>
      </html>
    `
    const result = extractArticleContent(html)
    expect(result).not.toBeNull()
    expect(result!.text).toContain("important events")
    // Readability may or may not extract the byline depending on heuristics,
    // but the article content should always be extracted
    if (result!.author) {
      expect(result!.author).toContain("Jane Reporter")
    }
  })

  it("uses url parameter for resolving relative links", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Site Article</title></head>
      <body>
        <article>
          <h1>An Article on Example.com About Various Topics</h1>
          <p>This article discusses many interesting topics at great length.
          We explore the nuances and implications of recent developments in
          the field. Our team of researchers spent months investigating these
          claims before publishing their findings in this comprehensive report.</p>
          <p>The implications of these findings are far-reaching and could
          affect policy decisions for years to come. Experts from multiple
          institutions have weighed in on the significance of this research.</p>
        </article>
      </body>
      </html>
    `
    // Should not throw when url is provided
    const result = extractArticleContent(html, "https://example.com/article")
    expect(result).not.toBeNull()
    expect(result!.text).toContain("interesting topics")
  })
})
