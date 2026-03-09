/**
 * Factory functions for 19 news and reference site-search sources.
 *
 * Each factory creates a SiteSearchSource configured for a specific
 * news or reference site, with appropriate reliability tier, path
 * preferences, and query terms.
 */

import { ReliabilityTier, type BaseSourceOptions } from "debriefer"
import { SiteSearchSource } from "./site-search-source.js"

// ============================================================================
// TIER_1_NEWS (0.95)
// ============================================================================

/** AP News — general-interest wire service. */
export function apNews(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "AP News",
      type: "ap-news",
      domain: "apnews.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/article/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** BBC News — British public-service broadcaster. */
export function bbcNews(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "BBC News",
      type: "bbc-news",
      domain: "bbc.com",
      additionalDomains: ["bbc.co.uk"],
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      queryTerms: "profile OR biography OR life story",
    },
    options
  )
}

/** Reuters — international news agency. */
export function reuters(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Reuters",
      type: "reuters",
      domain: "reuters.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/world/", "/lifestyle/", "/entertainment/", "/business/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** NPR — U.S. public radio network. */
export function npr(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "NPR",
      type: "npr",
      domain: "npr.org",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/sections/", "/music/", "/books/", "/movies/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** The Independent — British broadsheet newspaper. */
export function independent(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "The Independent",
      type: "independent",
      domain: "independent.co.uk",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/arts-entertainment/", "/news/", "/life-style/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** The Telegraph — British broadsheet newspaper. */
export function telegraph(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "The Telegraph",
      type: "telegraph",
      domain: "telegraph.co.uk",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/films/", "/culture/", "/obituaries/", "/news/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** The Washington Post — U.S. national newspaper. */
export function washingtonPost(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "The Washington Post",
      type: "washington-post",
      domain: "washingtonpost.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/entertainment/", "/obituaries/", "/style/", "/lifestyle/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** Los Angeles Times — U.S. West Coast newspaper. */
export function laTimes(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Los Angeles Times",
      type: "la-times",
      domain: "latimes.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/entertainment/", "/obituaries/", "/california/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** Time — U.S. news magazine. */
export function time(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Time",
      type: "time",
      domain: "time.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/entertainment/", "/culture/", "/person-of-the-year/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** The New Yorker — U.S. magazine of reportage and commentary. */
export function newYorker(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "The New Yorker",
      type: "new-yorker",
      domain: "newyorker.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/magazine/", "/culture/", "/news/", "/books/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** PBS — U.S. public television network. */
export function pbs(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "PBS",
      type: "pbs",
      domain: "pbs.org",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/wgbh/", "/newshour/", "/frontline/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** Encyclopaedia Britannica — general-purpose reference encyclopaedia. */
export function britannica(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Britannica",
      type: "britannica",
      domain: "britannica.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/biography/"],
      queryTerms: "biography",
    },
    options
  )
}

// ============================================================================
// TRADE_PRESS (0.9)
// ============================================================================

/** Rolling Stone — music, film, and culture magazine. */
export function rollingStone(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Rolling Stone",
      type: "rolling-stone",
      domain: "rollingstone.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/music/", "/movies/", "/culture/", "/feature/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

/** Smithsonian Magazine — history, science, and culture magazine. */
export function smithsonian(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Smithsonian Magazine",
      type: "smithsonian",
      domain: "smithsonianmag.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/history/", "/biography/", "/people-places/"],
      queryTerms: "biography",
    },
    options
  )
}

/** National Geographic — science, exploration, and nature magazine. */
export function nationalGeographic(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "National Geographic",
      type: "national-geographic",
      domain: "nationalgeographic.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 1500,
      preferredPaths: ["/adventure/", "/science/", "/history/"],
      queryTerms: "profile OR biography",
    },
    options
  )
}

/** History.com — history-focused editorial site (A&E Networks). */
export function historyCom(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "History.com",
      type: "history-com",
      domain: "history.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/topics/", "/biographies/", "/people/"],
      queryTerms: "biography",
    },
    options
  )
}

/** TCM (Turner Classic Movies) — classic film database and editorial. */
export function tcm(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "TCM",
      type: "tcm",
      domain: "tcm.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/tcmdb/person/"],
      queryTerms: "biography",
    },
    options
  )
}

/** AllMusic — music reference database. */
export function allMusic(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "AllMusic",
      type: "all-music",
      domain: "allmusic.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/artist/", "/artists/"],
      queryTerms: "biography",
    },
    options
  )
}

// ============================================================================
// MARGINAL_EDITORIAL (0.65)
// ============================================================================

/** People — celebrity and human-interest magazine. */
export function people(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "People",
      type: "people",
      domain: "people.com",
      reliabilityTier: ReliabilityTier.MARGINAL_EDITORIAL,
      rateLimitMs: 1500,
      avoidPaths: ["/gallery/", "/video/", "/news/", "/shopping/", "/food/"],
      queryTerms: "profile OR personal life",
    },
    options
  )
}

// ============================================================================
// SECONDARY_COMPILATION (0.85)
// ============================================================================

/** Biography.com — biographical reference site (A&E Networks). */
export function biographyCom(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Biography.com",
      type: "biography-com",
      domain: "biography.com",
      reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
      rateLimitMs: 1500,
      avoidPaths: ["/lists/", "/news/", "/video/", "/gallery/"],
    },
    options
  )
}
