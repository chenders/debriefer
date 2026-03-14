# debriefer-sources

Built-in research source integrations for [debriefer](https://github.com/chenders/debriefer): Wikipedia, Wikidata, web search, news, archives, and more.

## Install

```bash
npm install debriefer debriefer-sources
```

## Source Categories

| Category        | Count | Cost        | Sources                                                                                                   |
| --------------- | ----- | ----------- | --------------------------------------------------------------------------------------------------------- |
| Structured data | 2     | Free        | Wikipedia, Wikidata                                                                                       |
| News            | 22    | Mostly free | AP, BBC, Reuters, NPR, Guardian, NYT, Washington Post, LA Times, Rolling Stone, Britannica, TCM, and more |
| Web search      | 4     | Mixed       | DuckDuckGo (free), Google, Bing, Brave (API key required)                                                 |
| Books           | 2     | Mixed       | Open Library (free), Google Books (API key required)                                                      |
| Archives        | 4     | Free        | Chronicling America, Trove, Europeana, Internet Archive                                                   |
| Obituary        | 2     | Free        | Find a Grave, Legacy.com                                                                                  |

News sources marked "mostly free" use DuckDuckGo site-search under the hood and require no API keys. The Guardian and New York Times sources use their official APIs and require keys.

## Example

```typescript
import { ResearchOrchestrator } from "debriefer"
import { wikipedia, apNews, guardian, wikidata } from "debriefer-sources"

const orchestrator = new ResearchOrchestrator({
  sources: [
    wikipedia(),
    wikidata({
      sparqlQuery: (subject) =>
        `SELECT ?item WHERE { ?item wdt:P31 wd:Q5; rdfs:label "${subject.name}"@en }`,
    }),
    apNews(),
    guardian({ apiKey: process.env.GUARDIAN_API_KEY }),
  ],
  synthesizer: mySynthesizer,
})

const result = await orchestrator.debrief({ id: "ada-lovelace", name: "Ada Lovelace" })
```

## Shared Utilities

`debriefer-sources` exports utilities useful when building custom sources:

| Utility                 | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `fetchPage`             | HTTP fetch with timeout, User-Agent, and redirect handling |
| `extractArticleContent` | Mozilla Readability extraction from raw HTML               |
| `sanitizeSourceText`    | Clean extracted text for use as research findings          |
| `htmlToText`            | Convert HTML to plain text                                 |
| `searchDuckDuckGo`      | Run a DuckDuckGo search and return result URLs             |

## Documentation

See the [monorepo README](https://github.com/chenders/debriefer) for full documentation including orchestrator configuration, reliability scoring, and adding custom sources.

## License

MIT
