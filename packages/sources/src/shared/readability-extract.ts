/**
 * Article extraction using Mozilla Readability.
 *
 * Uses the same algorithm behind Firefox Reader View to extract article
 * content from raw HTML, stripping navigation, ads, sidebars, and other
 * non-content elements. Far more reliable than regex-based extraction.
 *
 * Dependencies: @mozilla/readability, jsdom
 */

import { Readability } from "@mozilla/readability"
import { JSDOM, VirtualConsole } from "jsdom"

/** Result of extracting article content from HTML. */
export interface ArticleExtractionResult {
  text: string
  title: string | null
  author: string | null
  excerpt: string | null
  siteName: string | null
}

/**
 * Extract article content from raw HTML using Mozilla Readability.
 *
 * Parses the HTML into a DOM, runs Mozilla's Readability algorithm to
 * identify the main article body, and returns the plain text content
 * along with metadata (title, author, excerpt, site name).
 *
 * Returns null if Readability cannot identify article content or if
 * the extracted text is shorter than 100 characters.
 *
 * @param html - Raw HTML string to extract from
 * @param url - Optional URL for resolving relative links in the HTML
 * @returns Extracted article content and metadata, or null
 */
export function extractArticleContent(html: string, url?: string): ArticleExtractionResult | null {
  const virtualConsole = new VirtualConsole()
  const handleConsoleError = (error: unknown): void => {
    let message = ""
    if (typeof error === "string") {
      message = error
    } else if (error instanceof Error) {
      message = error.message
    }
    // Suppress CSS parsing warnings from jsdom (expected and harmless)
    if (message.includes("Could not parse CSS stylesheet")) {
      return
    }
    // Forward non-CSS jsdom errors so they are not silently swallowed
    console.error(error)
  }
  virtualConsole.on("jsdomError", handleConsoleError)
  virtualConsole.on("error", handleConsoleError)

  const dom = new JSDOM(html, { url: url || undefined, virtualConsole })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  if (!article || !article.textContent || article.textContent.length < 100) {
    return null
  }

  return {
    text: article.textContent,
    title: article.title || null,
    author: article.byline || null,
    excerpt: article.excerpt || null,
    siteName: article.siteName || null,
  }
}
