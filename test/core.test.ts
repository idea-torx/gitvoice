import { describe, expect, it, vi } from "vitest";
import worker, { allowAuthAttempt, duePeriod, duePeriods, resetAuthRateLimit } from "../src/index";
import { renderInvoiceHtml } from "../src/invoice";
import { hashPortalPassword, isPortalPasswordCompatible, issuePortalToken, verifyPortalPassword, verifyPortalToken, generateRecoveryCode, issueAdminToken, verifyAdminToken, hashAdminPassword, verifyAdminPassword } from "../src/security";
import { buildActivityDigest, buildTimeline, fallbackSummary } from "../src/summary";
import { createInvoiceRow, normalizeGithubRepositories } from "../src/repository";
import { collectGithubActivity, matchesGithubAuthor } from "../src/github";
import type { Client, InvoiceDraft } from "../src/types";

const client: Client = {
  id: "client-1",
  name: "Acme Inc.",
  email: "billing@example.com",
  address: "456 Market St\nSan Francisco, CA 94105\nUnited States",
  githubRepos: ["acme/product"],
  githubAuthor: "",
  projectContext: "A client-facing product platform.",
  summaryPriorities: "Prioritize launches, major capabilities, and reliability wins.",
  cadence: "weekly",
  billingDay: 1,
  billingModel: "flat",
  defaultRateCents: 400000,
  currency: "USD",
  paymentMethod: "wire",
  paymentTerms: "Due on receipt",
  paymentDays: 0,
  specialTerms: "Phase two retainer",
  taxRate: 0,
  active: true,
};

describe("billing periods", () => {
  it("returns the preceding Monday-Sunday window on Mondays", () => {
    expect(duePeriod(new Date("2026-07-27T08:00:00Z"))).toEqual({ cadence: "weekly", start: "2026-07-20", end: "2026-07-26" });
  });

  it("returns the preceding calendar month on the first", () => {
    expect(duePeriod(new Date("2026-08-01T08:00:00Z"))).toEqual({ cadence: "monthly", start: "2026-07-01", end: "2026-07-31" });
  });

  it("runs both schedules when the first day is a Monday", () => {
    expect(duePeriods(new Date("2026-06-01T08:00:00Z")).map((period) => period.cadence)).toEqual(["weekly", "monthly"]);
  });
});

describe("portal PDF authorization", () => {
  it("rejects invoice PDF downloads without a client session", async () => {
    const response = await worker.fetch(
      new Request("https://invoice.test/portal/invoices/invoice-1/pdf"),
      { PORTAL_SECRET: "test-secret" } as never,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("GitHub repository input", () => {
  it("normalizes full and adjacent GitHub URLs", () => {
    expect(normalizeGithubRepositories(["https://github.com/acme/websitehttps://github.com/other/mono-repo"])).toEqual([
      "acme/website",
      "other/mono-repo",
    ]);
  });

  it("accepts owner/repository names and removes duplicate URL forms", () => {
    expect(normalizeGithubRepositories(["acme/website", "https://github.com/acme/website.git"])).toEqual(["acme/website"]);
  });
});

describe("GitHub author matching", () => {
  it("matches configured handles and local Git author names", () => {
    const authors = "acme-bot, Jane Doe, octocat";
    expect(matchesGithubAuthor(authors, "acme-bot", "Jane Doe")).toBe(true);
    expect(matchesGithubAuthor(authors, undefined, "Jane Doe")).toBe(true);
    expect(matchesGithubAuthor(authors, "ghost", "Ghost Rider")).toBe(false);
  });

  it("includes every contributor when the filter is blank", () => {
    expect(matchesGithubAuthor("", "octocat", "Octo")).toBe(true);
  });

  it("collects and enriches commits beyond the first GitHub page", async () => {
    const commits = Array.from({ length: 201 }, (_, index) => ({
      oid: `sha-${index}`,
      url: `https://github.com/acme/product/commit/sha-${index}`,
      messageHeadline: `Commit ${index}`,
      committedDate: "2026-07-20T10:00:00Z",
      additions: 2,
      deletions: 1,
      changedFilesIfAvailable: 1,
      author: { name: "Developer", user: { login: "developer" } },
      parents: { nodes: [{ oid: `parent-${index}` }] },
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body || "{}")) as { variables?: { cursor?: string | null } };
        const page = body.variables?.cursor ? Number(body.variables.cursor.replace("cursor-", "")) : 0;
        const nodes = commits.slice(page * 100, (page + 1) * 100);
        const hasNextPage = (page + 1) * 100 < commits.length;
        return new Response(JSON.stringify({ data: { repository: { defaultBranchRef: { target: { history: { nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? `cursor-${page + 1}` : null } } } } } } }));
      }
      if (url.pathname.endsWith("/pulls")) return new Response(JSON.stringify([{ title: "Launch customer portal", body: "Delivers secure invoice access.", html_url: "https://github.com/acme/product/pull/1", merged_at: "2026-07-20T12:00:00Z", labels: [{ name: "launch" }] }]));
      if (url.pathname.endsWith("/releases")) return new Response(JSON.stringify([{ name: "Portal v1", tag_name: "v1.0.0", body: "First client portal release.", html_url: "https://github.com/acme/product/releases/v1", published_at: "2026-07-21T12:00:00Z", draft: false }]));
      const isHead = url.pathname.endsWith("/git/trees/sha-0");
      return new Response(JSON.stringify({ truncated: false, tree: isHead ? commits.map((_, index) => ({ path: `file-${index}.ts`, sha: `blob-${index}`, type: "blob" })) : [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const activity = await collectGithubActivity(client, "2026-07-01", "2026-07-31", "token");
      expect(activity.commits).toHaveLength(201);
      expect(activity.additions).toBe(402);
      expect(activity.filesChanged).toBe(201);
      expect(activity.signals?.map((signal) => signal.title)).toEqual(["Launch customer portal", "Portal v1"]);
      expect(fetchMock).toHaveBeenCalledTimes(7);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("summary and invoice rendering", () => {
  it("keeps fallback summaries grounded in commit activity", () => {
    const summary = fallbackSummary(client, "2026-07-20", "2026-07-26", {
      repositories: ["acme/product"],
      additions: 40,
      deletions: 8,
      filesChanged: 5,
      contributors: ["dev"],
      commits: [{ sha: "abc", repo: "acme/product", message: "feat: add client portal", date: "2026-07-21T10:00:00Z", author: "dev", url: "https://github.com/acme/product/commit/abc", additions: 40, deletions: 8, files: ["src/portal.ts"] }],
    });
    expect(summary.source).toBe("fallback");
    expect(summary.deliverables).toContain("Add client portal");
    expect(summary.activitySummary).toContain("1 commit");
    expect(summary.timeline).toHaveLength(1);
  });

  it("builds chronological timeline buckets for longer periods", () => {
    const commits = Array.from({ length: 12 }, (_, index) => ({ sha: String(index), repo: "acme/product", message: `feat: item ${index}`, date: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`, author: "dev", url: "https://github.com/acme/product", additions: 1, deletions: 0, files: ["src/index.ts"] }));
    expect(buildTimeline(commits).every((entry) => entry.period.startsWith("Week of"))).toBe(true);
  });

  it("ranks project outcomes ahead of newer maintenance details", () => {
    const commits = [
      { sha: "new", repo: "acme/product", message: "chore: fix formatting typo", date: "2026-07-31T10:00:00Z", author: "dev", url: "https://github.com/acme/product/commit/new", additions: 1, deletions: 1, files: ["README.md"] },
      { sha: "old", repo: "acme/product", message: "feat: launch secure customer billing portal", date: "2026-07-03T10:00:00Z", author: "dev", url: "https://github.com/acme/product/commit/old", additions: 400, deletions: 20, files: ["src/portal.ts", "src/auth.ts"] },
      { sha: "mid", repo: "acme/product", message: "test: validate customer portal access flows", date: "2026-07-15T10:00:00Z", author: "dev", url: "https://github.com/acme/product/commit/mid", additions: 120, deletions: 0, files: ["test/portal.test.ts"] },
    ];
    const digest = buildActivityDigest({ commits, repositories: ["acme/product"], additions: 521, deletions: 21, filesChanged: 4, contributors: ["dev"] });
    expect(digest.evidenceEntriesConsidered).toBe(3);
    expect(digest.standoutCandidates[0].evidence).toBe("Launch secure customer billing portal");
    expect(digest.workCategories[0].category).toBe("Launches and milestones");
  });

  it("renders a work summary page before activity rows", () => {
    const activity = Array.from({ length: 19 }, (_, index) => ({ sha: String(index), repo: "acme/product", message: `feat: item ${index}`, date: "2026-07-21T10:00:00Z", author: "dev", url: "https://github.com/acme/product", additions: 1, deletions: 0, files: ["src/index.ts"] }));
    const invoice: InvoiceDraft = { provider: { businessName: "Gitvoice", providerName: "Jane Doe", address: "Vancouver", email: "", website: "", taxId: "", remittance: "Wire details on file" }, client, periodStart: "2026-07-20", periodEnd: "2026-07-26", issuedAt: "2026-07-27T08:00:00Z", dueAt: "2026-07-27T08:00:00Z", subtotalCents: 400000, taxCents: 0, totalCents: 400000, pricing: { model: "flat", amountCents: 400000, description: "Flat project fee" }, summary: { title: "Phase two", overview: "A concise overview.", activitySummary: "19 commits changed 19 files.", highlights: ["Portal shipped"], deliverables: ["Client portal"], nextSteps: [], timeline: [{ period: "Jul 20", title: "Feature work", detail: "Portal shipped.", commits: 19 }], source: "fallback" }, activity: { commits: activity, repositories: ["acme/product"], additions: 19, deletions: 0, filesChanged: 19, contributors: ["dev"] } };
    const html = renderInvoiceHtml({ ...invoice, number: "INV-2026-0001" });
    expect(html.match(/<section class="invoice-page/g)?.length).toBe(4);
    expect(html).toContain("Work summary");
    expect(html).toContain("Activity log");
    expect(html).toContain("Wire transfer");
  });

  it("renders a client notes section only when notes are present", () => {
    const base: InvoiceDraft = { provider: { businessName: "Gitvoice", providerName: "Jane Doe", address: "Vancouver", email: "", website: "", taxId: "", remittance: "Wire details on file" }, client, periodStart: "2026-07-20", periodEnd: "2026-07-26", issuedAt: "2026-07-27T08:00:00Z", dueAt: "2026-07-27T08:00:00Z", subtotalCents: 400000, taxCents: 0, totalCents: 400000, pricing: { model: "flat", amountCents: 400000, description: "Flat project fee" }, summary: { title: "Phase two", overview: "A concise overview.", activitySummary: "One commit.", highlights: [], deliverables: [], nextSteps: [], timeline: [], source: "fallback" }, activity: { commits: [], repositories: [], additions: 0, deletions: 0, filesChanged: 0, contributors: [] } };
    expect(renderInvoiceHtml({ ...base, number: "INV-2026-0002" })).not.toContain('<section class="notes-card"');
    const withNotes = renderInvoiceHtml({ ...base, number: "INV-2026-0002", summary: { ...base.summary, notes: "Thanks for your business!\nUse the invoice number as the reference." } });
    expect(withNotes).toContain('<section class="notes-card"');
    expect(withNotes).toContain("Thanks for your business!");
    expect(withNotes).toContain("Use the invoice number as the reference.");
  });

  it("prints the hourly rate and billable hours on hourly invoices", () => {
    const hourlyClient = { ...client, billingModel: "hourly" as const, defaultRateCents: 0, paymentMethod: "etransfer" as const };
    const invoice: InvoiceDraft = {
      provider: { businessName: "Gitvoice", providerName: "Jane Doe", address: "Vancouver", email: "billing@example.com", website: "", taxId: "", remittance: "Sensitive wire details" },
      client: hourlyClient,
      periodStart: "2026-07-20",
      periodEnd: "2026-07-26",
      issuedAt: "2026-07-27T08:00:00Z",
      dueAt: "2026-08-10T08:00:00Z",
      subtotalCents: 250000,
      taxCents: 12500,
      totalCents: 262500,
      pricing: { model: "hourly", rateCents: 20000, hours: 12.5, amountCents: 250000, description: "Engineering services" },
      summary: { title: "Engineering services", overview: "A concise overview.", activitySummary: "No GitHub activity was recorded.", highlights: [], deliverables: [], nextSteps: [], timeline: [], source: "fallback" },
      activity: { commits: [], repositories: [], additions: 0, deletions: 0, filesChanged: 0, contributors: [] },
    };
    const html = renderInvoiceHtml({ ...invoice, number: "INV-2026-0003" });
    expect(html).toContain("12.5 hrs × USD 200.00/hr");
    expect(html).toContain("Engineering services");
    expect(html).toContain("Send the E-transfer to billing@example.com.");
    expect(html).not.toContain("Sensitive wire details");
  });
});

describe("invoice persistence", () => {
  it("binds exactly one value for every invoice insert placeholder", async () => {
    let preparedSql = "";
    let boundValues: unknown[] = [];
    const db = {
      prepare(sql: string) {
        preparedSql = sql;
        return {
          bind(...values: unknown[]) {
            boundValues = values;
            return { run: async () => ({ success: true }) };
          },
        };
      },
    } as unknown as D1Database;

    await createInvoiceRow(db, {
      id: "invoice-1",
      number: "INV-2026-0001",
      client_id: "client-1",
      status: "generated",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      issued_at: "2026-07-31T12:00:00Z",
      due_at: "2026-07-31T12:00:00Z",
      currency: "CAD",
      subtotal_cents: 10000,
      tax_cents: 0,
      total_cents: 10000,
      pricing_json: "{}",
      summary_json: "{}",
      activity_json: "{}",
      pdf_key: null,
    });

    expect(preparedSql.match(/\?/g) || []).toHaveLength(16);
    expect(boundValues).toHaveLength(16);
  });
});

describe("client portal security", () => {
  it("hashes client passwords and rejects the wrong password", async () => {
    const credentials = await hashPortalPassword("a-client-only-secret");
    expect(credentials.salt.startsWith("100000.")).toBe(true);
    expect(isPortalPasswordCompatible(credentials.hash, credentials.salt)).toBe(true);
    expect(isPortalPasswordCompatible(credentials.hash, credentials.salt.split(".")[1])).toBe(false);
    expect(credentials.hash).not.toContain("a-client-only-secret");
    expect(await verifyPortalPassword("a-client-only-secret", credentials.hash, credentials.salt)).toBe(true);
    expect(await verifyPortalPassword("not-the-password", credentials.hash, credentials.salt)).toBe(false);
  });

  it("scopes signed portal tokens to one client and one signing secret", async () => {
    const token = await issuePortalToken("client-1", "portal-secret");
    expect(await verifyPortalToken(token, "portal-secret")).toMatchObject({ clientId: "client-1" });
    expect(await verifyPortalToken(token, "different-secret")).toBeNull();
  });
});

describe("admin authentication", () => {
  it("issues and verifies signed admin tokens", async () => {
    const token = await issueAdminToken("admin-secret");
    expect(await verifyAdminToken(token, "admin-secret")).toMatchObject({ exp: expect.any(Number) });
    expect(await verifyAdminToken(token, "wrong-secret")).toBeNull();
  });

  it("keeps admin tokens separate from portal tokens", async () => {
    const adminToken = await issueAdminToken("shared-secret");
    const portalToken = await issuePortalToken("client-1", "shared-secret");
    expect(await verifyAdminToken(portalToken, "shared-secret")).toBeNull();
    expect(await verifyPortalToken(adminToken, "shared-secret")).toBeNull();
  });

  it("hashes and verifies admin passwords", async () => {
    const { hash, salt } = await hashAdminPassword("a-strong-admin-password");
    expect(hash).not.toContain("a-strong-admin-password");
    expect(await verifyAdminPassword("a-strong-admin-password", hash, salt)).toBe(true);
    expect(await verifyAdminPassword("wrong", hash, salt)).toBe(false);
  });

  it("generates grouped recovery codes", () => {
    expect(generateRecoveryCode()).toMatch(/^GV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});

describe("authentication rate limiting", () => {
  function unconfiguredDb(): D1Database {
    const statement = { first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }), bind: () => statement };
    return { prepare: () => statement } as unknown as D1Database;
  }

  function attempt(ip: string, now: number): boolean {
    return allowAuthAttempt(new Request("https://invoice.test/api/auth", { method: "POST", headers: { "CF-Connecting-IP": ip } }), now);
  }

  it("blocks an address after 10 attempts and frees it once the window rolls past", () => {
    resetAuthRateLimit();
    const start = Date.parse("2026-08-13T12:00:00Z");
    for (let index = 0; index < 10; index += 1) expect(attempt("203.0.113.7", start + index)).toBe(true);
    expect(attempt("203.0.113.7", start + 10)).toBe(false);
    expect(attempt("203.0.113.8", start + 10)).toBe(true);
    expect(attempt("203.0.113.7", start + 60_000)).toBe(true);
  });

  it("answers a throttled login with 429", async () => {
    resetAuthRateLimit();
    const env = { DB: unconfiguredDb(), ADMIN_TOKEN: "setup-token", PORTAL_SECRET: "portal-secret" } as never;
    const login = () => worker.fetch(
      new Request("https://invoice.test/api/auth", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.4" }, body: JSON.stringify({ password: "wrong" }) }),
      env,
    );
    for (let index = 0; index < 10; index += 1) expect((await login()).status).toBe(401);
    const throttled = await login();
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({ error: "Too many attempts. Try again shortly." });
  });
});

describe("admin onboarding endpoints", () => {
  function emptyDb(): D1Database {
    const statement = {
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      bind: () => statement,
    };
    return { prepare: () => statement } as unknown as D1Database;
  }

  it("reports an unconfigured instance as not onboarded", async () => {
    const response = await worker.fetch(new Request("https://invoice.test/api/status"), { DB: emptyDb() } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ onboarded: false, hasAdminPassword: false });
  });

  it("lets a deployment token bootstrap an unconfigured instance", async () => {
    const response = await worker.fetch(
      new Request("https://invoice.test/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "setup-token" }) }),
      { DB: emptyDb(), ADMIN_TOKEN: "setup-token", PORTAL_SECRET: "portal-secret" } as never,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as { requiresSetup: boolean; token: string };
    expect(data.requiresSetup).toBe(true);
    expect(typeof data.token).toBe("string");
  });
});
