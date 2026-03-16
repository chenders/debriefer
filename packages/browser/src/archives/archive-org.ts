/**
 * Archive.org (Wayback Machine) fallback for paywalled or bot-protected sites.
 */

import type { ArchiveAvailability, ArchiveFetchResult } from "../types.js"
import { htmlToText } from "../html-utils.js"

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
}

let lastArchiveOrgRequestTime = 0
const ARCHIVE_ORG_RATE_LIMIT_MS = 1000

async function waitForRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastArchiveOrgRequestTime
  const waitTime = Math.max(0, ARCHIVE_ORG_RATE_LIMIT_MS - elapsed)
  if (waitTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitTime))
  }
  lastArchiveOrgRequestTime = Date.now()
}

/**
 * Check if a URL is available on archive.org.
 */
export async function checkArchiveAvailability(url: string): Promise<ArchiveAvailability> {
  try {
    await waitForRateLimit()

    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`
    const response = await fetch(apiUrl, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      return { available: false, url: null, timestamp: null, status: response.status }
    }

    const data = (await response.json()) as {
      archived_snapshots?: {
        closest?: { available: boolean; url: string; timestamp: string; status: string }
      }
    }

    const snapshot = data.archived_snapshots?.closest
    if (snapshot?.available) {
      return {
        available: true,
        url: snapshot.url,
        timestamp: snapshot.timestamp,
        status: parseInt(snapshot.status, 10),
      }
    }

    return { available: false, url: null, timestamp: null, status: null }
  } catch {
    return { available: false, url: null, timestamp: null, status: null }
  }
}

/**
 * Convert a URL to its archive.org equivalent.
 */
export function getArchiveUrl(url: string, timestamp?: string): string {
  const ts = timestamp || ""
  return `https://web.archive.org/web/${ts}/${url}`
}

/**
 * Fetch content from archive.org for a given URL.
 */
export async function fetchFromArchiveOrg(url: string): Promise<ArchiveFetchResult> {
  const availability = await checkArchiveAvailability(url)

  if (!availability.available || !availability.url) {
    return {
      success: false,
      url,
      archiveUrl: null,
      title: "",
      content: "",
      contentLength: 0,
      timestamp: null,
      error: "URL not available on archive.org",
    }
  }

  try {
    await waitForRateLimit()

    const response = await fetch(availability.url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      return {
        success: false,
        url,
        archiveUrl: availability.url,
        title: "",
        content: "",
        contentLength: 0,
        timestamp: availability.timestamp,
        error: `Archive fetch failed with status ${response.status}`,
      }
    }

    const html = await response.text()
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : ""

    // Remove archive.org toolbar
    const cleaned = html.replace(
      /<!--\s*BEGIN WAYBACK TOOLBAR INSERT\s*-->[\s\S]*?<!--\s*END WAYBACK TOOLBAR INSERT\s*-->/gi,
      ""
    )

    const content = extractArticleContent(cleaned)

    return {
      success: true,
      url,
      archiveUrl: availability.url,
      title,
      content,
      contentLength: content.length,
      timestamp: availability.timestamp,
    }
  } catch (error) {
    return {
      success: false,
      url,
      archiveUrl: availability.url,
      title: "",
      content: "",
      contentLength: 0,
      timestamp: availability.timestamp,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

function extractArticleContent(html: string): string {
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
