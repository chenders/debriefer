# Integration Examples

Debriefer works across domains — people, companies, drugs, historical events, anything you can express as a research subject. These examples show different combinations of sources, synthesis, batching, and quality thresholds.

Jump to: [RAG Pipelines](#provenance-scored-retrieval-for-rag-pipelines) · [Historical Archives](#cross-archive-historical-research) · [Drug Research](#drug--disease-research) · [Due Diligence](#corporate-due-diligence) · [Actor Research](#actor-research-with-ai-synthesis)

## Provenance-Scored Retrieval for RAG Pipelines

RAG systems typically stuff all retrieved text into the LLM's context window with no way to distinguish a Reuters wire story from a random blog post. Debriefer solves this by scoring every piece of retrieved content on two axes — source reliability and content relevance — so your LLM only sees trusted, relevant context and can cite where each fact came from.

```typescript
import { ResearchOrchestrator, NoopSynthesizer } from "@debriefer/core"
import {
  wikidata,
  wikipedia,
  apNews,
  bbcNews,
  reuters,
  guardian,
  openLibrary,
} from "@debriefer/sources"

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, sources: [wikidata(), wikipedia(), openLibrary()] },
    { phase: 2, sources: [apNews(), bbcNews(), reuters(), guardian()] },
  ],
  new NoopSynthesizer(),
  { confidenceThreshold: 0.6, reliabilityThreshold: 0.7 }
)

async function buildRAGContext(query: string): Promise<string> {
  const result = await orchestrator.debrief({ id: query, name: query })

  const trusted = result.findings.filter((f) => f.reliabilityScore >= 0.7 && f.confidence >= 0.6)

  return trusted
    .map(
      (f) => `[Source: ${f.sourceName} | Reliability: ${f.reliabilityScore} | ${f.url}]\n${f.text}`
    )
    .join("\n\n---\n\n")
}

// Pass to any LLM — works with Anthropic, OpenAI, or any chat completion API
const context = await buildRAGContext("climate change effects on coral reefs")
```

Without this, you'd need to build integrations for every source API, invent your own reliability scoring system, and figure out how to compare quality across completely different response formats. Debriefer gives you a single call that returns findings already scored on reliability and relevance, ready to filter and feed into your model.

## Cross-Archive Historical Research

Historians and journalists researching how a person or event was documented across countries and eras run into the same wall every time: every archive has a different API, different query syntax, different authentication, and different response format. Debriefer queries them all in one call, with reliability scoring to help you weight institutional archives against mirrors.

```typescript
import { ResearchOrchestrator, NoopSynthesizer } from "@debriefer/core"
import {
  chroniclingAmerica,
  trove,
  europeana,
  internetArchive,
  wikipedia,
  openLibrary,
} from "@debriefer/sources"

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Reference", sources: [wikipedia(), openLibrary()] },
    {
      phase: 2,
      name: "Archives",
      sources: [chroniclingAmerica(), trove(), europeana(), internetArchive()],
    },
  ],
  new NoopSynthesizer()
)

const result = await orchestrator.debrief({ id: "1918-flu", name: "1918 influenza pandemic" })

const bySource = new Map<string, typeof result.findings>()
for (const f of result.findings) {
  const group = bySource.get(f.sourceName) ?? []
  group.push(f)
  bySource.set(f.sourceName, group)
}
for (const [source, findings] of bySource) {
  console.log(`\n${source} (${findings.length} results):`)
  for (const f of findings) {
    console.log(`  [reliability: ${f.reliabilityScore}] ${f.url}`)
  }
}
```

One researcher, four countries' archives, one API call. Without Debriefer, this is weeks of integration work per archive.

## Drug & Disease Research

Pharmaceutical teams researching a drug need structured pharmacological data, recent clinical trial news, and published literature — and they need to trust the sources they're reading. Debriefer's phased execution queries Wikidata for structured facts first, then tier-1 news for recent developments, then book archives for published research.

```typescript
import { ResearchOrchestrator, type ResearchSubject } from "@debriefer/core"
import { ClaudeSynthesizer } from "@debriefer/ai"
import {
  wikidata,
  wikipedia,
  apNews,
  reuters,
  bbcNews,
  googleBooks,
  openLibrary,
} from "@debriefer/sources"

interface DrugProfile {
  genericName: string
  mechanismOfAction: string
  approvedIndications: string[]
  recentDevelopments: string[]
  regulatoryStatus: string
  sources: { name: string; url: string; reliability: number }[]
}

const synthesizer = new ClaudeSynthesizer<ResearchSubject, DrugProfile>({
  promptBuilder: (subject, findings) => ({
    system: `You are a medical information specialist. Produce an accurate drug profile
from the research findings. Include mechanism of action, approved indications,
recent regulatory or safety developments, and cite your sources.
Return JSON: { genericName, mechanismOfAction, approvedIndications, recentDevelopments, regulatoryStatus, sources }`,
    user: `Drug: ${subject.name}\n\nFindings:\n${findings
      .map((f) => `[${f.sourceName}] (reliability: ${f.reliabilityScore}) ${f.url}\n${f.text}`)
      .join("\n\n")}`,
  }),
  responseParser: (raw) => raw as DrugProfile,
})

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Structured", sources: [wikidata(), wikipedia()] },
    { phase: 2, name: "Clinical News", sources: [apNews(), reuters(), bbcNews()] },
    { phase: 3, name: "Published Research", sources: [googleBooks(), openLibrary()] },
  ],
  synthesizer,
  { earlyStopThreshold: 3, reliabilityThreshold: 0.85, costLimits: { maxCostPerSubject: 0.1 } }
)

const result = await orchestrator.debrief({
  id: "semaglutide",
  name: "semaglutide",
  context: { brandNames: ["Ozempic", "Wegovy", "Rybelsus"] },
})

console.log(result.data!.regulatoryStatus)
console.log(`${result.sourcesSucceeded} sources, cost: $${result.totalCostUsd.toFixed(4)}`)
```

The `reliabilityThreshold: 0.85` means only tier-1 news, structured data, and secondary compilations are _eligible_ to count toward early stopping — but they must also meet the confidence threshold. Search aggregators and user-generated content are still gathered for synthesis.

## Corporate Due Diligence

Screen companies for investment, compliance, or M&A due diligence by pulling structured facts from Wikidata alongside tier-1 news coverage. The batch processor researches multiple companies concurrently with lifecycle hooks for progress tracking — and reliability scoring ensures wire services outweigh aggregated or user-generated sources.

```typescript
import { ResearchOrchestrator, type ResearchSubject } from "@debriefer/core"
import { ClaudeSynthesizer } from "@debriefer/ai"
import {
  wikidata,
  wikipedia,
  apNews,
  reuters,
  bbcNews,
  guardian,
  bingSearch,
} from "@debriefer/sources"

interface RiskAssessment {
  headquarters: string | null
  recentRegulatoryActions: string[]
  litigationRisk: "low" | "moderate" | "high"
  reputationalFlags: string[]
  summary: string
}

// Synthesizer follows the same pattern as above — only the output schema and prompt change
const synthesizer = new ClaudeSynthesizer<ResearchSubject, RiskAssessment>({
  promptBuilder: (subject, findings) => ({
    system: `You are a corporate intelligence analyst. Summarize the research on this company.
Flag regulatory actions, lawsuits, executive misconduct, or reputational controversies.
Assign litigation risk as low/moderate/high based on evidence.
Return JSON: { headquarters, recentRegulatoryActions, litigationRisk, reputationalFlags, summary }`,
    user: `Company: ${subject.name}\n\nFindings:\n${findings
      .map((f) => `[${f.sourceName}] (reliability: ${f.reliabilityScore}) ${f.url}\n${f.text}`)
      .join("\n\n")}`,
  }),
  responseParser: (raw) => raw as RiskAssessment,
})

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Company Facts", sources: [wikidata(), wikipedia()] },
    { phase: 2, name: "News Coverage", sources: [apNews(), reuters(), bbcNews(), guardian()] },
    { phase: 3, name: "Web Search", sources: [bingSearch()] },
  ],
  synthesizer,
  { earlyStopThreshold: 4, costLimits: { maxCostPerSubject: 0.25 } }
)

const companies: ResearchSubject[] = [
  { id: "company-a", name: "Acme Corporation", context: { ticker: "ACME" } },
  { id: "company-b", name: "Globex Industries", context: { ticker: "GLBX" } },
  { id: "company-c", name: "Initech Financial", context: { industry: "Fintech" } },
]

const results = await orchestrator.debriefBatch(companies, {
  onSubjectComplete: (subject, result) =>
    console.log(
      `${subject.name}: risk=${result.data?.litigationRisk ?? "unknown"}, ` +
        `cost=$${result.totalCostUsd.toFixed(3)}, ${result.durationMs}ms`
    ),
  onRunComplete: (stats) =>
    console.log(
      `\nScreened ${stats.succeeded}/${stats.total} companies, $${stats.costUsd.toFixed(3)} total`
    ),
})
```

The batch processor shares rate limiting across all companies — no thundering herd against any single news API — and per-subject cost caps prevent any one company from consuming the entire budget.

## Actor Research with AI Synthesis

Build a film database that enriches actor profiles from news, archives, and structured data — then synthesizes a cited biography with Claude:

```typescript
import { ResearchOrchestrator, type ResearchSubject } from "@debriefer/core"
import { ClaudeSynthesizer } from "@debriefer/ai"
import {
  wikidata,
  wikipedia,
  guardian,
  apNews,
  bbcNews,
  chroniclingAmerica,
  internetArchive,
  legacy,
} from "@debriefer/sources"

interface ActorProfile {
  biography: string
  birthDate: string | null
  deathDate: string | null
  notableRoles: string[]
  sources: { name: string; url: string; reliability: number }[]
}

const synthesizer = new ClaudeSynthesizer<ResearchSubject, ActorProfile>({
  promptBuilder: (subject, findings) => ({
    system: `You are building a film database. Given research findings about an actor,
extract a biography, birth/death dates, notable roles, and cite your sources.
Return JSON matching: { biography, birthDate, deathDate, notableRoles, sources }`,
    user: `Actor: ${subject.name}\n\nFindings:\n${findings
      .map((f) => `[${f.sourceName}] (reliability: ${f.reliabilityScore}) ${f.url}\n${f.text}`)
      .join("\n\n")}`,
  }),
  responseParser: (raw) => raw as ActorProfile,
})

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Structured", sources: [wikidata(), wikipedia()] },
    {
      phase: 2,
      name: "News & Archives",
      sources: [guardian(), apNews(), bbcNews(), chroniclingAmerica()],
    },
    { phase: 3, name: "Deep Archives", sources: [internetArchive(), legacy()] },
  ],
  synthesizer,
  { earlyStopThreshold: 3, costLimits: { maxCostPerSubject: 0.1 } }
)

const profile = await orchestrator.debrief({
  id: "nm0000030",
  name: "Audrey Hepburn",
  context: { knownFor: "Breakfast at Tiffany's" },
})

console.log(profile.data!.biography)
console.log(
  `Sources: ${profile.data!.sources.length} cited, cost: $${profile.totalCostUsd.toFixed(4)}`
)
```

Structured data runs first (free, fast). News and archives only fire if early stopping hasn't triggered. Deep archives are the last resort. The whole thing costs pennies.
