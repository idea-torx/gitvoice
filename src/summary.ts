import type { ActivitySnapshot, Client, CommitActivity, Summary, TimelineEntry } from "./types";

interface OpenAIResponse {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
}

interface WorkersAIResponse {
  response?: unknown;
}

interface CategoryDefinition {
  key: string;
  label: string;
  priority: number;
  matches: (message: string, prefix: string) => boolean;
}

interface ClassifiedCommit {
  commit: CommitActivity;
  category: CategoryDefinition;
  title: string;
  score: number;
}

const MAX_EVIDENCE_CHARACTERS = 36_000;
const MAX_STANDOUT_CANDIDATES = 28;
const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SUMMARY_INSTRUCTIONS = "You are a senior delivery lead writing a concise, client-facing software invoice summary from verified GitHub evidence. Reconstruct the larger project narrative; do not narrate a commit list. Lead with the largest completed outcomes, milestones, launches, user-facing capabilities, major integrations, platform work, reliability gains, and substantial testing. Group related implementation, debugging, testing, and polish into one initiative. Never place chores, dependency updates, formatting, or minor fixes ahead of larger achievements. Treat merged pull requests and releases as strong project-level evidence. Client context explains what the product is and what matters, but is not proof that an outcome occurred. Never invent business impact, user adoption, hours, completion status, metrics, or work not supported by the evidence. Describe verified capabilities and engineering outcomes rather than claiming unverified commercial results. The evidence digest was computed from all supplied commits; its category counts cover the full period even when the compact ledger contains representative entries. Return only valid JSON with exactly these keys: title (string describing the period's biggest project beat, not the client name or date), overview (string, 2-3 concise outcome-first sentences), activitySummary (string, 1-2 sentences with supporting measurable activity), highlights (array of 3-6 short strings ordered from most to least important), deliverables (array of 3-8 distinct shipped capabilities or substantial work products, ordered by importance), nextSteps (array of 0-3 short strings only when future work is explicitly evidenced), timeline (array of 3-10 objects with period, title, detail, commits). Keep the timeline chronological while emphasizing the most important achievement inside each period. Do not repeat the same item across highlights and deliverables. Keep each array item under 140 characters and each timeline detail under 200 characters.";
const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    activitySummary: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
    deliverables: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    timeline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          period: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          commits: { type: "integer" },
        },
        required: ["period", "title", "detail", "commits"],
      },
    },
  },
  required: ["title", "overview", "activitySummary", "highlights", "deliverables", "nextSteps", "timeline"],
};

const CATEGORIES: CategoryDefinition[] = [
  { key: "launch", label: "Launches and milestones", priority: 100, matches: (message) => !/\b(pre[- ]?launch|launch prep|prepare for launch)\b/i.test(message) && /\b(launch(?:ed)?|release[sd]?|ship(?:ped)?|rollout|go[- ]?live|production[- ]ready|milestone|\bmvp\b|initial .{0,24}scaffold)\b/i.test(message) },
  { key: "security", label: "Security and access", priority: 92, matches: (message) => /\b(security|secure|auth(?:entication|orization)?|permission|credential|password|token|vulnerab|encrypt)\b/i.test(message) },
  { key: "integration", label: "Integrations and connected systems", priority: 88, matches: (message) => /\b(integrat|\bapi\b|webhook|oauth|stripe|github|cloudflare|payment|sync|import|export|third[- ]party)\b/i.test(message) },
  { key: "capability", label: "Product capabilities", priority: 86, matches: (message, prefix) => prefix === "feat" || /\b(add(?:ed|s|ing)?|create[sd]?|build|implement(?:ed|s)?|introduc|enable[sd]?|support(?:ed|s)?|new feature)\b/i.test(message) },
  { key: "architecture", label: "Platform and architecture", priority: 80, matches: (message, prefix) => prefix === "refactor" || /\b(architect|refactor|rewrite|migrat|schema|database|pipeline|infrastructure|platform|foundation)\b/i.test(message) },
  { key: "performance", label: "Performance and efficiency", priority: 76, matches: (message) => /\b(performance|faster|speed|latency|optim(?:ize|ization)|cache|efficient|reduce load)\b/i.test(message) },
  { key: "reliability", label: "Reliability and debugging", priority: 72, matches: (message, prefix) => prefix === "fix" || /\b(fix(?:ed|es|ing)?|bug|debug|stabil|crash|error|failure|edge case|recover|reliab)\b/i.test(message) },
  { key: "quality", label: "Testing and validation", priority: 64, matches: (message, prefix) => prefix === "test" || /\b(test(?:ed|s|ing)?|spec|coverage|validate|verification|\bqa\b|regression)\b/i.test(message) },
  { key: "documentation", label: "Documentation", priority: 44, matches: (_message, prefix) => prefix === "docs" },
  { key: "maintenance", label: "Maintenance", priority: 24, matches: (message, prefix) => ["chore", "style", "build"].includes(prefix) || /\b(dependenc|deps|format|lint|cleanup|housekeeping|typo|merge branch)\b/i.test(message) },
  { key: "delivery", label: "Project delivery", priority: 56, matches: () => true },
];

export async function summarizeActivity(
  client: Client,
  periodStart: string,
  periodEnd: string,
  activity: ActivitySnapshot,
  apiKey?: string,
  model = "gpt-5.6-luna",
  workersAi?: Ai,
): Promise<Summary> {
  const fallback = fallbackSummary(client, periodStart, periodEnd, activity);
  if (activity.commits.length === 0) return fallback;

  const payload = {
    client: {
      name: client.name,
      projectContext: client.projectContext || "Not provided",
      prioritiesAndMilestones: client.summaryPriorities || "Not provided",
    },
    period: { start: periodStart, end: periodEnd },
    evidence: buildActivityDigest(activity),
  };

  if (apiKey) try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "medium" },
        text: { verbosity: "low" },
        instructions: SUMMARY_INSTRUCTIONS,
        input: JSON.stringify(payload),
        max_output_tokens: 1500,
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as OpenAIResponse;
      const parsed = parseModelJson(data.output_text || extractOutputText(data));
      const normalized = parsed ? normalizeSummary(parsed, "openai", fallback) : null;
      if (normalized) return normalized;
    }
  } catch {
    // Continue to Workers AI when the optional OpenAI request is unavailable.
  }

  if (workersAi) try {
    const result = await workersAi.run(WORKERS_AI_MODEL, {
      messages: [
        { role: "system", content: SUMMARY_INSTRUCTIONS },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_schema", json_schema: SUMMARY_SCHEMA },
      max_tokens: 1500,
      temperature: 0.2,
    }) as WorkersAIResponse;
    const parsed = typeof result.response === "string" ? parseModelJson(result.response) : result.response;
    const normalized = parsed ? normalizeSummary(parsed, "openai", fallback) : null;
    if (normalized) return normalized;
  } catch {
    // The deterministic outcome-ranked fallback keeps invoice creation functional.
  }
  return fallback;
}

export function buildActivityDigest(activity: ActivitySnapshot) {
  const classified = activity.commits.map(classifyCommit);
  const ranked = [...classified].sort((a, b) => b.score - a.score || a.commit.date.localeCompare(b.commit.date));
  const initiatives = buildInitiatives(classified);
  const categories = CATEGORIES
    .map((category) => {
      const entries = ranked.filter((entry) => entry.category.key === category.key);
      return {
        category: category.label,
        count: entries.length,
        topEvidence: uniqueTitles(entries).slice(0, 6),
      };
    })
    .filter((category) => category.count > 0);
  const repositories = activity.repositories.map((repo) => {
    const commits = classified.filter((entry) => entry.commit.repo === repo);
    return {
      repository: repo,
      commits: commits.length,
      additions: commits.reduce((sum, entry) => sum + entry.commit.additions, 0),
      deletions: commits.reduce((sum, entry) => sum + entry.commit.deletions, 0),
      filesChanged: commits.reduce((sum, entry) => sum + (entry.commit.fileCount ?? entry.commit.files.length), 0),
    };
  });
  const allEvidence = dedupeEvidence(classified)
    .sort((a, b) => a.commit.date.localeCompare(b.commit.date))
    .map(compactEvidenceLine);
  const chronologicalEvidence = fitEvidenceBudget(allEvidence, ranked.map(compactEvidenceLine));
  return {
    totals: {
      commits: activity.commits.length,
      repositories: activity.repositories.length,
      filesChanged: activity.filesChanged,
      additions: activity.additions,
      deletions: activity.deletions,
      contributors: activity.contributors,
    },
    projectSignals: (activity.signals || []).map((signal) => ({
      type: signal.type === "release" ? "Release" : "Merged pull request",
      repository: signal.repo,
      title: signal.title,
      description: signal.description,
      date: signal.date,
      labels: signal.labels,
    })),
    repositories,
    initiatives,
    workCategories: categories,
    standoutCandidates: ranked.slice(0, MAX_STANDOUT_CANDIDATES).map((entry) => ({
      date: entry.commit.date.slice(0, 10),
      repository: entry.commit.repo,
      category: entry.category.label,
      evidence: entry.title,
    })),
    chronologicalEvidence,
    evidenceEntriesIncluded: chronologicalEvidence.length,
    evidenceEntriesConsidered: allEvidence.length,
  };
}

export function fallbackSummary(client: Client, periodStart: string, periodEnd: string, activity: ActivitySnapshot): Summary {
  const digest = buildActivityDigest(activity);
  const classified = activity.commits.map(classifyCommit).sort((a, b) => b.score - a.score || a.commit.date.localeCompare(b.commit.date));
  const categories = digest.workCategories.filter((category) => category.category !== "Maintenance");
  const initiatives = digest.initiatives.filter((initiative) => initiative.initiative !== "Maintenance");
  const highlights = initiatives.slice(0, 5).map((initiative) => `${initiative.initiative}: ${initiative.topEvidence.slice(0, 2).join("; ")}`);
  const deliverables = uniqueTitles(classified.filter((entry) => entry.category.key !== "maintenance")).slice(0, 8);
  const leadingSignal = activity.signals?.find((signal) => signal.type === "release") || activity.signals?.[0];
  const leadingWork = leadingSignal?.title || initiatives.slice(0, 2).map((initiative) => initiative.initiative).join(" and ") || classified[0]?.title;
  const overview = activity.commits.length
    ? `Work during the period centered on ${initiatives.slice(0, 3).map((initiative) => initiative.initiative.toLowerCase()).join(", ") || categories.slice(0, 3).map((category) => category.category.toLowerCase()).join(", ") || "project delivery"}.`
    : "No GitHub commits were recorded for this billing period.";
  const contributorSummary = activity.contributors.length
    ? `Contributors: ${activity.contributors.slice(0, 3).join(", ")}${activity.contributors.length > 3 ? ` +${activity.contributors.length - 3} more` : ""}.`
    : "";
  const activitySummary = activity.commits.length
    ? `${activity.commits.length} commit${activity.commits.length === 1 ? "" : "s"} changed ${activity.filesChanged} file${activity.filesChanged === 1 ? "" : "s"} (+${activity.additions} / -${activity.deletions}) across ${activity.repositories.length} repositor${activity.repositories.length === 1 ? "y" : "ies"}. ${contributorSummary}`.trim()
    : "No GitHub activity was recorded for this billing period.";
  return {
    title: leadingWork || `${client.name} - ${formatPeriod(periodStart, periodEnd)}`,
    overview,
    activitySummary,
    highlights: highlights.length ? highlights : ["No categorized activity to report"],
    deliverables: deliverables.length ? deliverables : ["No deliverables recorded in GitHub for this period"],
    nextSteps: [],
    timeline: buildTimeline(activity.commits),
    source: "fallback",
  };
}

export function buildTimeline(commits: ActivitySnapshot["commits"]): TimelineEntry[] {
  if (!commits.length) return [];
  const sorted = [...commits].sort((a, b) => a.date.localeCompare(b.date));
  const dayGroups = groupByPeriod(sorted, (commit) => commit.date.slice(0, 10));
  const groups = dayGroups.size > 10 ? groupByPeriod(sorted, (commit) => weekStart(commit.date)) : dayGroups;
  return Array.from(groups.entries()).map(([key, entries]) => {
    const period = groups === dayGroups ? formatTimelineDate(key) : `Week of ${formatTimelineDate(key)}`;
    return {
      period,
      title: timelineTitle(entries),
      detail: timelineDetail(entries),
      commits: entries.length,
    } satisfies TimelineEntry;
  });
}

function classifyCommit(commit: CommitActivity): ClassifiedCommit {
  const message = commit.message.trim() || "Untitled commit";
  const prefix = message.match(/^(feat|fix|refactor|docs|test|chore|build|style)(?:\(.+?\))?[!: ]/i)?.[1]?.toLowerCase() || "";
  const category = CATEGORIES.find((candidate) => candidate.matches(message, prefix)) || CATEGORIES[CATEGORIES.length - 1];
  const title = cleanCommitTitle(message);
  const fileCount = commit.fileCount ?? commit.files.length;
  const milestoneBoost = /\b(launch|release|ship|complete|milestone|production|migration)\b/i.test(message) ? 18 : 0;
  const scopeBoost = /^(?:feat|fix|refactor)\([^)]+\)!?:/i.test(message) ? 6 : 0;
  const breadthBoost = Math.min(10, Math.floor(Math.log2(Math.max(1, fileCount))) * 2);
  const trivialPenalty = /\b(typo|format|lint|whitespace|bump|dependency|deps|readme only)\b/i.test(message) ? 30 : 0;
  return { commit, category, title, score: category.priority + milestoneBoost + scopeBoost + breadthBoost - trivialPenalty };
}

function buildInitiatives(entries: ClassifiedCommit[]) {
  const grouped = new Map<string, ClassifiedCommit[]>();
  for (const entry of entries) {
    const initiative = initiativeFor(entry);
    const group = grouped.get(initiative) || [];
    group.push(entry);
    grouped.set(initiative, group);
  }
  return Array.from(grouped.entries())
    .map(([initiative, group]) => {
      const ranked = [...group].sort((a, b) => b.score - a.score || a.commit.date.localeCompare(b.commit.date));
      const dates = group.map((entry) => entry.commit.date.slice(0, 10)).sort();
      const importance = Math.max(...group.map((entry) => entry.score)) + Math.min(45, Math.log2(group.length + 1) * 14);
      return {
        initiative,
        commits: group.length,
        period: dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`,
        topEvidence: uniqueTitles(ranked).slice(0, 6),
        importance,
      };
    })
    .sort((a, b) => b.importance - a.importance || b.commits - a.commits)
    .map(({ importance: _importance, ...initiative }) => initiative);
}

function initiativeFor(entry: ClassifiedCommit): string {
  const message = entry.commit.message.trim();
  const conventionalScope = message.match(/^(?:feat|fix|refactor|docs|test|chore|build|style)\(([^)]+)\)/i)?.[1];
  const colonScope = message.match(/^([^:]{2,40}):\s/)?.[1];
  const scope = (conventionalScope || colonScope || "").trim().toLowerCase();
  if (!scope) return entry.category.label;
  if (["feat", "fix", "refactor", "docs", "test", "chore", "build", "style"].includes(scope)) return entry.category.label;
  if (/^(home|homepage|hero|reprise)/.test(scope)) return "Homepage experience";
  if (/^(product|split|3d tubs?)/.test(scope)) return "Product experience";
  if (/^goals?/.test(scope)) return "Goals experience";
  if (/^(expert|experts)/.test(scope)) return "Expert credibility";
  if (/^accelerators?/.test(scope)) return "Accelerator credibility";
  if (/^testimonials?/.test(scope)) return "Customer proof";
  if (/^comparison/.test(scope)) return "Product comparison";
  if (/^ingredients?/.test(scope)) return "Ingredients and formula";
  if (/^manufacturing/.test(scope)) return "Manufacturing trust";
  if (/^mobile/.test(scope)) return "Mobile experience";
  if (/^(seo|geo|seo\/geo)/.test(scope)) return "SEO and discoverability";
  if (/^(launch prep|pre-launch|waitlist)/.test(scope)) return "Pre-launch readiness";
  if (/^cereluma/.test(scope)) return "Cereluma experience";
  if (/^contact/.test(scope)) return "Contact experience";
  if (/^header/.test(scope)) return "Navigation and header";
  if (/^footer/.test(scope)) return "Footer experience";
  return scope
    .split(/\s+/)
    .slice(0, 5)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function cleanCommitTitle(message: string): string {
  const cleaned = message
    .replace(/^merge pull request\s+#\d+\s+from\s+\S+/i, "")
    .replace(/^(feat|fix|refactor|docs|test|chore|build|style)(?:\(([^)]+)\))?[!: ]+\s*/i, "")
    .replace(/^[-:–—\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const value = cleaned || message.trim() || "Untitled commit";
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`.slice(0, 180);
}

function uniqueTitles(entries: ClassifiedCommit[]): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const entry of entries) {
    const key = entry.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(entry.title);
  }
  return titles;
}

function dedupeEvidence(entries: ClassifiedCommit[]): ClassifiedCommit[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.commit.repo}|${entry.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactEvidenceLine(entry: ClassifiedCommit): string {
  const fileAreas = Array.from(new Set(entry.commit.files.map((file) => file.split("/").slice(0, 2).join("/")))).slice(0, 3);
  return `${entry.commit.date.slice(0, 10)} | ${entry.commit.repo} | ${entry.category.label} | ${entry.title}${fileAreas.length ? ` | areas: ${fileAreas.join(", ")}` : ""}`;
}

function fitEvidenceBudget(chronological: string[], ranked: string[]): string[] {
  if (chronological.join("\n").length <= MAX_EVIDENCE_CHARACTERS) return chronological;
  const selected = new Set<string>();
  let characters = 0;
  for (const line of ranked) {
    if (selected.has(line) || characters + line.length + 1 > MAX_EVIDENCE_CHARACTERS) continue;
    selected.add(line);
    characters += line.length + 1;
  }
  return chronological.filter((line) => selected.has(line));
}

function normalizeSummary(value: unknown, source: Summary["source"], fallback: Summary): Summary | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const title = typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : fallback.title;
  const overview = typeof candidate.overview === "string" && candidate.overview.trim() ? candidate.overview.trim() : fallback.overview;
  const activitySummary = typeof candidate.activitySummary === "string" && candidate.activitySummary.trim() ? candidate.activitySummary.trim() : fallback.activitySummary;
  const highlights = stringArray(candidate.highlights).slice(0, 6);
  const deliverables = stringArray(candidate.deliverables).slice(0, 8);
  const nextSteps = stringArray(candidate.nextSteps).slice(0, 3);
  const timeline = timelineArray(candidate.timeline).slice(0, 10);
  return {
    title,
    overview,
    activitySummary,
    highlights: highlights.length ? highlights : fallback.highlights,
    deliverables: deliverables.length ? deliverables : fallback.deliverables,
    nextSteps,
    timeline: timeline.length ? timeline : fallback.timeline,
    source,
  };
}

function groupByPeriod(commits: CommitActivity[], keyFor: (commit: CommitActivity) => string): Map<string, CommitActivity[]> {
  const groups = new Map<string, CommitActivity[]>();
  for (const commit of commits) {
    const key = keyFor(commit);
    const entries = groups.get(key) || [];
    entries.push(commit);
    groups.set(key, entries);
  }
  return groups;
}

function weekStart(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function formatTimelineDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function timelineTitle(commits: CommitActivity[]): string {
  return commits.map(classifyCommit).sort((a, b) => b.score - a.score)[0]?.category.label || "Project delivery";
}

function timelineDetail(commits: CommitActivity[]): string {
  const ranked = commits.map(classifyCommit).sort((a, b) => b.score - a.score);
  const messages = uniqueTitles(ranked).slice(0, 2).join("; ");
  const suffix = commits.length > 2 ? `; +${commits.length - 2} supporting commit${commits.length - 2 === 1 ? "" : "s"}` : "";
  return `${messages}${suffix}`.slice(0, 200);
}

function timelineArray(value: unknown): TimelineEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      period: typeof entry.period === "string" ? entry.period.trim() : "",
      title: typeof entry.title === "string" ? entry.title.trim() : "Work",
      detail: typeof entry.detail === "string" ? entry.detail.trim() : "",
      commits: Math.max(0, Number(entry.commits) || 0),
    }))
    .filter((entry) => entry.period && entry.detail);
}

function parseModelJson(value: string): unknown {
  const cleaned = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function extractOutputText(response: OpenAIResponse): string {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text as string)
    .join("\n");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim()) : [];
}

function formatPeriod(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${start}T12:00:00Z`))} - ${formatter.format(new Date(`${end}T12:00:00Z`))}`;
}
