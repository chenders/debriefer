/**
 * archive.is / archive.today fallback for paywalled or bot-protected sites.
 *
 * Provides both HTTP-based fetching and browser-based fetching with CAPTCHA
 * solving for cases where archive.is itself requires a CAPTCHA.
 */

import { createRequire } from "node:module"

import type { ArchiveAvailability, ArchiveFetchResult, CaptchaSolverConfig } from "../types.js"
import { htmlToText } from "../html-utils.js"

const require = createRequire(import.meta.url)

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
}

let lastArchiveIsRequestTime = 0
let archiveIsRateLimitMs = 5000

async function waitForRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastArchiveIsRequestTime
  const waitTime = Math.max(0, archiveIsRateLimitMs - elapsed)
  if (waitTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitTime))
  }
  lastArchiveIsRequestTime = Date.now()
}

/**
 * Check if a URL is available on archive.is.
 */
export async function checkArchiveIsAvailability(url: string): Promise<ArchiveAvailability> {
  try {
    await waitForRateLimit()

    const checkUrl = `https://archive.is/newest/${url}`
    const response = await fetch(checkUrl, {
      method: "HEAD",
      headers: BROWSER_HEADERS,
      redirect: "manual",
    })

    if (response.status === 302) {
      const archiveUrl = response.headers.get("location")
      return { available: true, url: archiveUrl, timestamp: null, status: 200 }
    }

    if (response.status === 429) {
      console.warn("Archive.is rate limited, increasing delay...")
      archiveIsRateLimitMs = Math.min(archiveIsRateLimitMs * 2, 30000)
      return { available: false, url: null, timestamp: null, status: 429 }
    }

    return { available: false, url: null, timestamp: null, status: response.status }
  } catch {
    return { available: false, url: null, timestamp: null, status: null }
  }
}

/**
 * Fetch content from archive.is via HTTP.
 */
export async function fetchFromArchiveIs(url: string): Promise<ArchiveFetchResult> {
  const availability = await checkArchiveIsAvailability(url)

  if (!availability.available || !availability.url) {
    return {
      success: false,
      url,
      archiveUrl: null,
      title: "",
      content: "",
      contentLength: 0,
      timestamp: null,
      error:
        availability.status === 429
          ? "Rate limited by archive.is"
          : "URL not available on archive.is",
    }
  }

  try {
    await waitForRateLimit()

    const response = await fetch(availability.url, { headers: BROWSER_HEADERS })

    if (response.status === 429) {
      archiveIsRateLimitMs = Math.min(archiveIsRateLimitMs * 2, 30000)
      return {
        success: false,
        url,
        archiveUrl: availability.url,
        title: "",
        content: "",
        contentLength: 0,
        timestamp: null,
        error: "Rate limited by archive.is",
      }
    }

    if (!response.ok) {
      return {
        success: false,
        url,
        archiveUrl: availability.url,
        title: "",
        content: "",
        contentLength: 0,
        timestamp: null,
        error: `Archive.is fetch failed with status ${response.status}`,
      }
    }

    const html = await response.text()
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : ""
    const content = extractArchiveIsContent(html)

    return {
      success: true,
      url,
      archiveUrl: availability.url,
      title,
      content,
      contentLength: content.length,
      timestamp: null,
    }
  } catch (error) {
    return {
      success: false,
      url,
      archiveUrl: availability.url,
      title: "",
      content: "",
      contentLength: 0,
      timestamp: null,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Search archive.is using a browser with CAPTCHA solving.
 *
 * Requires `playwright-extra` and `@extra/recaptcha` to be installed:
 *   npm install playwright-extra @extra/recaptcha
 */
export async function searchArchiveIsWithBrowser(
  url: string,
  captchaSolver: CaptchaSolverConfig
): Promise<ArchiveFetchResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require("playwright-extra")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RecaptchaPlugin } = require("@extra/recaptcha")

  const plugin = new RecaptchaPlugin({
    visualFeedback: true,
    provider: { id: "2captcha", token: captchaSolver.apiKey },
  })

  Object.defineProperty(plugin, "_isPuppeteerExtraPlugin", { value: true, writable: false })
  chromium.use(plugin)

  const searchUrl = `https://archive.is/search/?q=${encodeURIComponent(url)}`

  let browser: { close(): Promise<void> } | undefined
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    })

    const page = await (
      browser as unknown as { newPage(): Promise<import("playwright-core").Page> }
    ).newPage()
    await page.setViewportSize({ width: 1920, height: 1080 })

    await page.goto("https://archive.is/", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2000)

    await page.goto(searchUrl, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2000)

    const hasRecaptcha = await page.locator("#g-recaptcha, .g-recaptcha").count()
    if (hasRecaptcha > 0) {
      // @ts-expect-error - solveRecaptchas added by playwright-extra plugin
      const result = await page.solveRecaptchas()
      if (result.error) {
        return {
          success: false,
          url,
          archiveUrl: null,
          title: "",
          content: "",
          contentLength: 0,
          timestamp: null,
          error: `CAPTCHA solve failed: ${result.error}`,
        }
      }
      await page.waitForTimeout(5000)
    }

    const linkSelector = "#row0 .TEXT-BLOCK a"
    const linkCount = await page.locator(linkSelector).count()

    if (linkCount === 0) {
      const stillCaptcha = await page.locator("#g-recaptcha").count()
      return {
        success: false,
        url,
        archiveUrl: null,
        title: "",
        content: "",
        contentLength: 0,
        timestamp: null,
        error:
          stillCaptcha > 0
            ? "CAPTCHA not solved - still showing challenge"
            : "No archived version found on archive.is",
      }
    }

    const archiveUrl = await page.locator(linkSelector).first().getAttribute("href")
    if (!archiveUrl) {
      return {
        success: false,
        url,
        archiveUrl: null,
        title: "",
        content: "",
        contentLength: 0,
        timestamp: null,
        error: "Could not extract archive link",
      }
    }

    await page.goto(archiveUrl, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2000)

    const title = await page.title()
    const articleHtml = await page
      .locator("article")
      .first()
      .innerHTML()
      .catch(() => null)

    let content = ""
    if (articleHtml) {
      content = htmlToText(articleHtml)
    } else {
      const bodyHtml = await page
        .locator("body")
        .innerHTML()
        .catch(() => "")
      content = htmlToText(bodyHtml)
    }

    return {
      success: true,
      url,
      archiveUrl,
      title,
      content,
      contentLength: content.length,
      timestamp: null,
    }
  } catch (error) {
    return {
      success: false,
      url,
      archiveUrl: null,
      title: "",
      content: "",
      contentLength: 0,
      timestamp: null,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

function extractArchiveIsContent(html: string): string {
  const articlePatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*story-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ]

  for (const pattern of articlePatterns) {
    const match = html.match(pattern)
    if (match && match[1]) {
      const text = htmlToText(match[1])
      if (text.length > 500) {
        return text
      }
    }
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) {
    return htmlToText(bodyMatch[1])
  }

  return htmlToText(html)
}
