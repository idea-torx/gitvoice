import type { ActivitySnapshot, Client, CommitActivity, GithubProjectSignal } from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_VERSION = "2022-11-28";
const MAX_COMMIT_PAGES_PER_REPOSITORY = 5;
const GITHUB_DETAIL_CONCURRENCY = 6;

interface GithubCommitListItem {
  sha: string;
  html_url?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  author?: { login?: string } | null;
}

interface GithubCommitDetail extends GithubCommitListItem {
  stats?: { additions?: number; deletions?: number };
  files?: Array<{ filename?: string }>;
}

interface GithubHistoryNode {
  oid: string;
  url: string;
  messageHeadline: string;
  committedDate: string;
  additions: number;
  deletions: number;
  changedFilesIfAvailable?: number | null;
  author?: { name?: string | null; user?: { login?: string | null } | null } | null;
  parents?: { nodes?: Array<{ oid: string }> };
}

interface GithubHistoryPage {
  nodes?: GithubHistoryNode[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
}

interface GithubHistoryResponse {
  data?: {
    repository?: {
      defaultBranchRef?: {
        target?: {
          history?: GithubHistoryPage;
        };
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

interface GithubTreeResponse {
  truncated?: boolean;
  tree?: Array<{ path?: string; sha?: string; type?: string }>;
}

interface GithubPullRequest {
  title?: string;
  body?: string | null;
  html_url?: string;
  merged_at?: string | null;
  labels?: Array<{ name?: string }>;
  user?: { login?: string } | null;
}

interface GithubRelease {
  name?: string | null;
  tag_name?: string;
  body?: string | null;
  html_url?: string;
  published_at?: string | null;
  created_at?: string;
  draft?: boolean;
}

interface RepositoryActivity {
  commits: CommitActivity[];
  changedFiles: string[];
}

export async function collectGithubActivity(
  client: Client,
  periodStart: string,
  periodEnd: string,
  githubToken?: string,
): Promise<ActivitySnapshot> {
  if (client.githubRepos.length === 0) return emptyActivity();

  const allCommits: CommitActivity[] = [];
  const allSignals: GithubProjectSignal[] = [];
  const uniqueFiles = new Set<string>();
  for (const repo of client.githubRepos) {
    const [activity, signals] = await Promise.all([
      githubToken
        ? collectRepositoryWithGraphql(repo, periodStart, periodEnd, client.githubAuthor, githubToken)
        : collectRepositoryWithRest(repo, periodStart, periodEnd, client.githubAuthor),
      collectRepositorySignals(repo, periodStart, periodEnd, client.githubAuthor, githubToken).catch(() => []),
    ]);
    allCommits.push(...activity.commits);
    if (activity.commits.length) allSignals.push(...signals);
    for (const path of activity.changedFiles) uniqueFiles.add(`${repo}:${path}`);
  }

  allCommits.sort((a, b) => b.date.localeCompare(a.date));
  const contributors = Array.from(new Set(allCommits.map((commit) => commit.author).filter(Boolean))).sort();
  const reportedFileChanges = allCommits.reduce((sum, commit) => sum + (commit.fileCount ?? commit.files.length), 0);
  return {
    commits: allCommits,
    repositories: client.githubRepos,
    additions: allCommits.reduce((sum, commit) => sum + commit.additions, 0),
    deletions: allCommits.reduce((sum, commit) => sum + commit.deletions, 0),
    filesChanged: uniqueFiles.size || reportedFileChanges,
    contributors,
    signals: allSignals.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function emptyActivity(): ActivitySnapshot {
  return { commits: [], repositories: [], additions: 0, deletions: 0, filesChanged: 0, contributors: [], signals: [] };
}

async function collectRepositorySignals(repo: string, periodStart: string, periodEnd: string, configuredAuthors: string, token?: string): Promise<GithubProjectSignal[]> {
  const [owner, repository] = splitRepository(repo);
  const base = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const pullsUrl = new URL(`${base}/pulls`);
  pullsUrl.searchParams.set("state", "closed");
  pullsUrl.searchParams.set("sort", "updated");
  pullsUrl.searchParams.set("direction", "desc");
  pullsUrl.searchParams.set("per_page", "100");
  const releasesUrl = new URL(`${base}/releases`);
  releasesUrl.searchParams.set("per_page", "100");
  const [pulls, releases] = await Promise.all([
    githubFetch<GithubPullRequest[]>(pullsUrl, token).catch(() => []),
    githubFetch<GithubRelease[]>(releasesUrl, token).catch(() => []),
  ]);
  const pullSignals = pulls
    .filter((pull) => pull.merged_at && isDateInRange(pull.merged_at, periodStart, periodEnd) && matchesGithubAuthor(configuredAuthors, pull.user?.login))
    .map((pull) => ({
      type: "pull_request" as const,
      repo,
      title: normalizeSignalText(pull.title || "Merged pull request", 180),
      description: normalizeSignalText(pull.body || "", 600),
      date: pull.merged_at as string,
      url: pull.html_url || `https://github.com/${repo}/pulls`,
      labels: (pull.labels || []).map((label) => label.name || "").filter(Boolean).slice(0, 8),
    }));
  const releaseSignals = releases
    .filter((release) => !release.draft && isDateInRange(release.published_at || release.created_at || "", periodStart, periodEnd))
    .map((release) => ({
      type: "release" as const,
      repo,
      title: normalizeSignalText(release.name || release.tag_name || "Release", 180),
      description: normalizeSignalText(release.body || "", 600),
      date: release.published_at || release.created_at || `${periodEnd}T23:59:59Z`,
      url: release.html_url || `https://github.com/${repo}/releases`,
      labels: [],
    }));
  return [...pullSignals, ...releaseSignals];
}

function isDateInRange(value: string, periodStart: string, periodEnd: string): boolean {
  const date = value.slice(0, 10);
  return Boolean(date) && date >= periodStart && date <= periodEnd;
}

function normalizeSignalText(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

async function collectRepositoryWithGraphql(repo: string, periodStart: string, periodEnd: string, author: string, token: string): Promise<RepositoryActivity> {
  const [owner, repository] = splitRepository(repo);
  const nodes: GithubHistoryNode[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= MAX_COMMIT_PAGES_PER_REPOSITORY; page += 1) {
    const result: GithubHistoryResponse = await githubGraphqlFetch<GithubHistoryResponse>(GITHUB_HISTORY_QUERY, {
      owner,
      name: repository,
      since: `${periodStart}T00:00:00Z`,
      until: `${periodEnd}T23:59:59Z`,
      cursor,
    }, token);
    const history: GithubHistoryPage | undefined = result.data?.repository?.defaultBranchRef?.target?.history;
    if (!history) throw new Error(`GitHub history unavailable for ${repo}: ${result.errors?.[0]?.message || "default branch not found"}`);
    nodes.push(...(history.nodes || []));
    if (!history.pageInfo?.hasNextPage || !history.pageInfo.endCursor) break;
    cursor = history.pageInfo.endCursor;
  }

  const commits = nodes
    .filter((node) => matchesGithubAuthor(author, node.author?.user?.login || undefined, node.author?.name || undefined))
    .map((node) => ({
      sha: node.oid,
      repo,
      message: node.messageHeadline || "Untitled commit",
      date: node.committedDate,
      author: node.author?.user?.login || node.author?.name || "Unknown contributor",
      url: node.url,
      additions: node.additions || 0,
      deletions: node.deletions || 0,
      files: [],
      fileCount: node.changedFilesIfAvailable || 0,
    }));

  const newest = nodes[0];
  const oldest = nodes[nodes.length - 1];
  const baseSha = oldest?.parents?.nodes?.[0]?.oid;
  const changedFiles = newest
    ? await changedFilesBetweenTrees(repo, baseSha || oldest.oid, newest.oid, token, !baseSha).catch(() => [])
    : [];
  return { commits, changedFiles };
}

async function collectRepositoryWithRest(repo: string, periodStart: string, periodEnd: string, author: string): Promise<RepositoryActivity> {
  const commits = await listCommits(repo, periodStart, periodEnd, author);
  const details = await mapWithConcurrency(
    commits,
    GITHUB_DETAIL_CONCURRENCY,
    (commit) => getCommitDetail(repo, commit.sha).catch(() => commit),
  );
  const activity = details.map((detail) => toActivity(repo, detail));
  return { commits: activity, changedFiles: activity.flatMap((commit) => commit.files) };
}

async function listCommits(repo: string, periodStart: string, periodEnd: string, author: string): Promise<GithubCommitListItem[]> {
  const [owner, repository] = splitRepository(repo);
  const commits: GithubCommitListItem[] = [];
  for (let page = 1; page <= MAX_COMMIT_PAGES_PER_REPOSITORY; page += 1) {
    const url = new URL(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits`);
    url.searchParams.set("since", `${periodStart}T00:00:00Z`);
    url.searchParams.set("until", `${periodEnd}T23:59:59Z`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const data = await githubFetch<GithubCommitListItem[]>(url);
    commits.push(...data.filter((commit) => matchesGithubAuthor(author, commit.author?.login, commit.commit?.author?.name)));
    if (data.length < 100) break;
  }
  return commits;
}

async function changedFilesBetweenTrees(repo: string, baseSha: string, headSha: string, token: string, includeEntireBase = false): Promise<string[]> {
  const headTree = await getTree(repo, headSha, token);
  const baseTree = await getTree(repo, baseSha, token);
  const paths = new Set([...headTree.keys(), ...baseTree.keys()]);
  if (includeEntireBase) return Array.from(paths);
  return Array.from(paths).filter((path) => headTree.get(path) !== baseTree.get(path));
}

async function getTree(repo: string, sha: string, token: string): Promise<Map<string, string>> {
  const [owner, repository] = splitRepository(repo);
  const url = new URL(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(sha)}`);
  url.searchParams.set("recursive", "1");
  const result = await githubFetch<GithubTreeResponse>(url, token);
  if (result.truncated) throw new Error(`GitHub tree for ${repo} was truncated`);
  return new Map((result.tree || []).filter((entry) => entry.type === "blob" && entry.path && entry.sha).map((entry) => [entry.path!, entry.sha!]));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function matchesGithubAuthor(configuredAuthors: string, login?: string, authorName?: string): boolean {
  const aliases = configuredAuthors.split(/[\n,]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!aliases.length) return true;
  const identities = [login, authorName].map((value) => value?.trim().toLowerCase()).filter(Boolean);
  return aliases.some((alias) => identities.includes(alias));
}

async function getCommitDetail(repo: string, sha: string, token?: string): Promise<GithubCommitDetail> {
  const [owner, repository] = splitRepository(repo);
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(sha)}`;
  return githubFetch<GithubCommitDetail>(url, token);
}

async function githubGraphqlFetch<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  return githubFetch<T>(`${GITHUB_API}/graphql`, token, { method: "POST", body: JSON.stringify({ query, variables }), headers: { "Content-Type": "application/json" } });
}

async function githubFetch<T>(url: string | URL, token?: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_VERSION,
    "User-Agent": "gitvoice/0.1",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub request failed (${response.status}): ${body.slice(0, 180)}`);
  }
  return response.json<T>();
}

function splitRepository(repo: string): [string, string] {
  const [owner, repository] = repo.split("/");
  if (!owner || !repository) throw new Error(`Invalid GitHub repository: ${repo}`);
  return [owner, repository];
}

function toActivity(repo: string, commit: GithubCommitDetail): CommitActivity {
  const files = (commit.files || []).map((file) => file.filename || "").filter(Boolean);
  return {
    sha: commit.sha,
    repo,
    message: (commit.commit?.message || "Untitled commit").split("\n")[0].trim(),
    date: commit.commit?.author?.date || new Date().toISOString(),
    author: commit.author?.login || commit.commit?.author?.name || "Unknown contributor",
    url: commit.html_url || `https://github.com/${repo}/commit/${commit.sha}`,
    additions: commit.stats?.additions || 0,
    deletions: commit.stats?.deletions || 0,
    files,
    fileCount: files.length,
  };
}

const GITHUB_HISTORY_QUERY = `query RepositoryHistory($owner: String!, $name: String!, $since: GitTimestamp!, $until: GitTimestamp!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, since: $since, until: $until, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              oid url messageHeadline committedDate additions deletions changedFilesIfAvailable
              author { name user { login } }
              parents(first: 1) { nodes { oid } }
            }
          }
        }
      }
    }
  }
}`;
