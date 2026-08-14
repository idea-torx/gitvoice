import { collectGithubActivity, emptyActivity } from "./github";
import { renderInvoiceHtml } from "./invoice";
import {
  createInvoiceRow,
  deleteClient,
  deleteInvoiceRow,
  findInvoiceForPeriod,
  getAdminState,
  getClient,
  getInvoiceRow,
  getPortalCredentials,
  getProvider,
  listClients,
  listInvoices,
  listInvoicesForClient,
  listInvoiceDisputes,
  nextInvoiceNumber,
  rowToInvoice,
  saveAdminState,
  saveProvider,
  setInvoicePdfKey,
  upsertInvoiceDispute,
  upsertClient,
} from "./repository";
import { fallbackSummary, summarizeActivity } from "./summary";
import { generateRecoveryCode, hashAdminPassword, issueAdminToken, issuePortalToken, verifyAdminPassword, verifyAdminToken, verifyPortalPassword, verifyPortalToken } from "./security";
import type { ActivitySnapshot, AdminState, BillingModel, Client, ClientInput, Env, InvoiceDraft, InvoicePricing, InvoicePricingInput, InvoiceRecord, ProviderProfile, Summary } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      const status = message === "Unauthorized" || message.includes("Incorrect client password") ? 401 : message.includes("not configured") ? 503 : message.includes("not found") ? 404 : message.includes("required") || message.includes("Invalid") || message.includes("before") || message.includes("Pricing") || message.includes("Enter the") || message.includes("billable") ? 400 : 500;
      if (status >= 500) console.error(error);
      return json({ error: message }, status);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(controller.scheduledTime, env));
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (path === "/api/health") return json({ ok: true, service: "gitvoice" });

  if (path === "/api/status" && request.method === "GET") return status(request, env);
  if (path === "/api/auth" && request.method === "POST") return authenticateAdmin(request, env);
  if (path === "/api/auth/recover" && request.method === "POST") return recoverAdmin(request, env);
  if (path === "/api/setup" && request.method === "POST") return setupAdmin(request, env);

  if (path === "/api/portal/clients" && request.method === "GET") return portalClients(request, env);
  if (path === "/api/portal/auth" && request.method === "POST") return portalAuth(request, env);
  if (path === "/api/portal/invoices" && request.method === "GET") return portalInvoices(request, env);
  if (path.startsWith("/portal/invoices/") && path.endsWith("/dispute") && request.method === "POST") return portalDispute(request, env, path.split("/")[3]);
  if (path.startsWith("/portal/invoices/") && path.endsWith("/pdf") && request.method === "GET") return portalInvoicePdf(request, env, path.split("/")[3]);
  if (path.startsWith("/portal/invoices/") && request.method === "GET") return portalInvoiceHtml(request, env, path.split("/").pop());

  if ((path.startsWith("/api/") && !path.startsWith("/api/portal/")) || path.startsWith("/invoice/")) {
    await requireAuth(request, env);
  }

  if (path === "/api/bootstrap" && request.method === "GET") return bootstrap(env);
  if (path === "/api/settings" && request.method === "PUT") return saveSettings(request, env);
  if (path === "/api/clients" && request.method === "POST") return saveClient(request, env);
  if (path.startsWith("/api/clients/") && request.method === "PUT") return saveClient(request, env, path.split("/").pop());
  if (path.startsWith("/api/clients/") && request.method === "DELETE") return removeClient(env, path.split("/").pop());
  if (path === "/api/preview" && request.method === "POST") return previewInvoice(request, env);
  if (path === "/api/invoices" && request.method === "POST") return createInvoice(request, env);
  if (path === "/api/invoices" && request.method === "GET") return listInvoiceJson(env);
  if (path.startsWith("/api/invoices/") && path.endsWith("/pdf") && request.method === "GET") return invoicePdf(request, env, path.split("/")[3]);
  if (path.startsWith("/api/invoices/") && !path.endsWith("/pdf") && request.method === "DELETE") return deleteInvoice(env, path.split("/").pop());
  if (path.startsWith("/api/invoices/") && request.method === "GET") return invoiceJson(env, path.split("/").pop());
  if (path.startsWith("/invoice/") && request.method === "GET") return invoiceHtml(env, path.split("/").pop());

  if (path === "/portal" && env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response("Not found", { status: 404 });
}

async function bootstrap(env: Env): Promise<Response> {
  const [clients, provider, rows, disputes] = await Promise.all([listClients(env.DB), getProvider(env.DB), listInvoices(env.DB), listInvoiceDisputes(env.DB)]);
  const disputesByInvoice = new Map(disputes.map((dispute) => [dispute.invoiceId, dispute]));
  const invoices = [];
  for (const row of rows) {
    const client = await getClient(env.DB, row.client_id);
    if (client) invoices.push(publicInvoice(rowToInvoice(row, client, provider), disputesByInvoice.get(row.id) || null));
  }
  return json({ provider, clients, invoices });
}

async function status(request: Request, env: Env): Promise<Response> {
  const admin = await getAdminState(env.DB);
  return json({
    onboarded: admin.onboarded,
    hasAdminPassword: Boolean(admin.passwordHash && admin.passwordSalt),
    local: isLocalRequest(request),
  });
}

async function authenticateAdmin(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ password?: string }>(request);
  const password = body.password || "";
  const admin = await getAdminState(env.DB);
  if (admin.onboarded && admin.passwordHash && admin.passwordSalt) {
    if (await verifyAdminPassword(password, admin.passwordHash, admin.passwordSalt)) {
      return json({ token: await issueAdminToken(adminSecret(env)), requiresSetup: false });
    }
  }
  if (env.ADMIN_TOKEN && constantTimeEqual(password, env.ADMIN_TOKEN)) {
    return json({ token: await issueAdminToken(adminSecret(env)), requiresSetup: !admin.onboarded });
  }
  throw new Error("Unauthorized");
}

async function recoverAdmin(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ recoveryCode?: string; password?: string }>(request);
  const code = (body.recoveryCode || "").trim();
  const password = body.password || "";
  if (!code) throw new Error("Recovery code is required");
  assertPassword(password);
  const admin = await getAdminState(env.DB);
  if (!admin.recoveryHash || !admin.recoverySalt) throw new Error("No recovery code has been configured");
  if (!(await verifyAdminPassword(code, admin.recoveryHash, admin.recoverySalt))) throw new Error("Invalid recovery code");
  const passwordCreds = await hashAdminPassword(password);
  const newCode = generateRecoveryCode();
  const recoveryCreds = await hashAdminPassword(newCode);
  await saveAdminState(env.DB, {
    ...admin,
    passwordHash: passwordCreds.hash,
    passwordSalt: passwordCreds.salt,
    recoveryHash: recoveryCreds.hash,
    recoverySalt: recoveryCreds.salt,
  });
  return json({ recoveryCode: newCode });
}

async function setupAdmin(request: Request, env: Env): Promise<Response> {
  await authorizeSetup(request, env);
  const body = await readJson<{ password?: string; provider?: ProviderProfile }>(request);
  assertPassword(body.password || "");
  const admin = await getAdminState(env.DB);
  if (admin.onboarded && admin.passwordHash) throw new Error("This instance is already set up");
  const passwordCreds = await hashAdminPassword(body.password || "");
  const recoveryCode = generateRecoveryCode();
  const recoveryCreds = await hashAdminPassword(recoveryCode);
  const next: AdminState = {
    onboarded: true,
    passwordHash: passwordCreds.hash,
    passwordSalt: passwordCreds.salt,
    recoveryHash: recoveryCreds.hash,
    recoverySalt: recoveryCreds.salt,
    setupAt: new Date().toISOString(),
  };
  await saveAdminState(env.DB, next);
  const provider = body.provider ? await saveProvider(env.DB, body.provider) : await getProvider(env.DB);
  return json({ recoveryCode, provider, token: await issueAdminToken(adminSecret(env)) });
}

async function authorizeSetup(request: Request, env: Env): Promise<void> {
  if (isLocalRequest(request)) return;
  await requireAuth(request, env);
}

function assertPassword(password: string): void {
  if (!password) throw new Error("Password is required");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
}

async function portalClients(request: Request, env: Env): Promise<Response> {
  const localDebug = isLocalRequest(request);
  const [provider, allClients] = await Promise.all([getProvider(env.DB), listClients(env.DB, false)]);
  const clients = allClients
    .filter((client) => localDebug || client.portalPasswordSet)
    .map((client) => ({ id: client.id, name: client.name }));
  return json({ clients, provider: { businessName: provider.businessName, logoUrl: provider.logoUrl || "" } });
}

async function portalAuth(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ clientId: string; password: string }>(request);
  if (!body.clientId) throw new Error("Client is required");
  if (!body.password) throw new Error("Password is required");
  const credentials = await getPortalCredentials(env.DB, body.clientId);
  const localDebug = isLocalRequest(request) && body.password === env.ADMIN_TOKEN;
  const passwordValid = localDebug || Boolean(credentials && credentials.active === 1 && (await verifyPortalPassword(body.password, credentials.portal_password_hash, credentials.portal_password_salt)));
  if (!passwordValid) throw new Error("Incorrect client password");
  const client = await getClient(env.DB, body.clientId);
  if (!client) throw new Error("Client not found");
  const token = await issuePortalToken(client.id, portalSecret(env));
  return json({ token, client: { id: client.id, name: client.name } });
}

async function portalInvoices(request: Request, env: Env): Promise<Response> {
  const session = await requirePortalSession(request, env);
  const client = await getClient(env.DB, session.clientId);
  if (!client || !client.active) throw new Error("Client not found");
  const provider = await getProvider(env.DB);
  const rows = await listInvoicesForClient(env.DB, client.id);
  const disputesByInvoice = new Map((await listInvoiceDisputes(env.DB, client.id)).map((dispute) => [dispute.invoiceId, dispute]));
  const invoices = rows.map((row) => {
    const invoice = rowToInvoice(row, client, provider);
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      currency: invoice.currency,
      totalCents: invoice.totalCents,
      pricing: invoice.pricing,
      dispute: disputesByInvoice.get(invoice.id) || null,
      summary: { title: invoice.summary.title, overview: invoice.summary.overview, activitySummary: invoice.summary.activitySummary },
    };
  });
  return json({ client: { id: client.id, name: client.name }, invoices });
}

async function portalDispute(request: Request, env: Env, id?: string): Promise<Response> {
  const session = await requirePortalSession(request, env);
  if (!id) throw new Error("Invoice id is required");
  const row = await getInvoiceRow(env.DB, id);
  if (!row || row.client_id !== session.clientId) throw new Error("Invoice not found");
  const body = await readJson<{ reason?: string }>(request);
  const dispute = await upsertInvoiceDispute(env.DB, id, session.clientId, body.reason || "");
  return json({ dispute }, 201);
}

async function portalInvoiceHtml(request: Request, env: Env, id?: string): Promise<Response> {
  const session = await requirePortalSession(request, env);
  const invoice = await loadInvoice(env, id);
  if (invoice.client.id !== session.clientId) throw new Error("Invoice not found");
  return new Response(renderInvoiceHtml(invoice), { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function portalInvoicePdf(request: Request, env: Env, id?: string): Promise<Response> {
  const session = await requirePortalSession(request, env);
  const invoice = await loadInvoice(env, id);
  if (invoice.client.id !== session.clientId) throw new Error("Invoice not found");
  return serveInvoicePdf(env, invoice);
}

async function requirePortalSession(request: Request, env: Env): Promise<{ clientId: string; exp: number }> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const session = await verifyPortalToken(token, portalSecret(env));
  if (!session) throw new Error("Unauthorized");
  return session;
}

function portalSecret(env: Env): string {
  const secret = env.PORTAL_SECRET || env.ADMIN_TOKEN;
  if (!secret) throw new Error("Portal secret is not configured");
  return secret;
}

async function saveSettings(request: Request, env: Env): Promise<Response> {
  const provider = await readJson<ProviderProfile>(request);
  return json({ provider: await saveProvider(env.DB, provider) });
}

async function saveClient(request: Request, env: Env, pathId?: string): Promise<Response> {
  const input = await readJson<ClientInput>(request);
  if (pathId) input.id = pathId;
  const client = await upsertClient(env.DB, input);
  return json({ client }, 200);
}

async function removeClient(env: Env, id?: string): Promise<Response> {
  if (!id) throw new Error("Client id is required");
  await deleteClient(env.DB, id);
  return json({ ok: true });
}

async function previewInvoice(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ clientId: string; periodStart: string; periodEnd: string; pricing?: InvoicePricingInput }>(request);
  const draft = await buildDraft(env, body.clientId, body.periodStart, body.periodEnd, body.pricing, true);
  return json({ invoice: publicInvoice(draft), html: renderInvoiceHtml(draft) });
}

async function createInvoice(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ clientId: string; periodStart: string; periodEnd: string; pricing?: InvoicePricingInput; preview?: { summary?: Summary; activity?: ActivitySnapshot } }>(request);
  const existing = await findInvoiceForPeriod(env.DB, body.clientId, body.periodStart, body.periodEnd);
  if (existing) {
    const client = await getClient(env.DB, existing.client_id);
    if (!client) throw new Error("Existing invoice client could not be loaded");
    return json({ invoice: publicInvoice(rowToInvoice(existing, client, await getProvider(env.DB))), existing: true });
  }

  const reusablePreview = normalizeReusablePreview(body.preview);
  const draft = await buildDraft(env, body.clientId, body.periodStart, body.periodEnd, body.pricing, false, reusablePreview);
  const id = crypto.randomUUID();
  const number = await nextInvoiceNumber(env.DB);
  const invoice: InvoiceRecord = { ...draft, id, number, status: "generated", currency: draft.client.currency };
  await createInvoiceRow(env.DB, {
    id,
    number,
    client_id: draft.client.id,
    status: "generated",
    period_start: draft.periodStart,
    period_end: draft.periodEnd,
    issued_at: draft.issuedAt,
    due_at: draft.dueAt,
    currency: draft.client.currency,
    subtotal_cents: draft.subtotalCents,
    tax_cents: draft.taxCents,
    total_cents: draft.totalCents,
    pricing_json: JSON.stringify(draft.pricing),
    summary_json: JSON.stringify(draft.summary),
    activity_json: JSON.stringify(draft.activity),
    pdf_key: null,
  });
  await ensurePdf(env, invoice);
  return json({ invoice: publicInvoice(invoice) }, 201);
}

async function listInvoiceJson(env: Env): Promise<Response> {
  const provider = await getProvider(env.DB);
  const [rows, disputes] = await Promise.all([listInvoices(env.DB), listInvoiceDisputes(env.DB)]);
  const disputesByInvoice = new Map(disputes.map((dispute) => [dispute.invoiceId, dispute]));
  const invoices = [];
  for (const row of rows) {
    const client = await getClient(env.DB, row.client_id);
    if (client) invoices.push(publicInvoice(rowToInvoice(row, client, provider), disputesByInvoice.get(row.id) || null));
  }
  return json({ invoices });
}

async function invoiceJson(env: Env, id?: string): Promise<Response> {
  const invoice = await loadInvoice(env, id);
  return json({ invoice: publicInvoice(invoice) });
}

async function invoiceHtml(env: Env, id?: string): Promise<Response> {
  const invoice = await loadInvoice(env, id);
  return new Response(renderInvoiceHtml(invoice), { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function deleteInvoice(env: Env, id?: string): Promise<Response> {
  if (!id) throw new Error("Invoice id is required");
  const row = await getInvoiceRow(env.DB, id);
  if (!row) throw new Error("Invoice not found");
  if (row.pdf_key && env.INVOICE_PDFS) await env.INVOICE_PDFS.delete(row.pdf_key);
  await deleteInvoiceRow(env.DB, id);
  return json({ ok: true, id });
}

async function invoicePdf(request: Request, env: Env, id?: string): Promise<Response> {
  return serveInvoicePdf(env, await loadInvoice(env, id));
}

async function serveInvoicePdf(env: Env, invoice: InvoiceRecord): Promise<Response> {
  const key = invoice.pdfKey || `invoices/${invoice.id}.pdf`;
  const stored = await env.INVOICE_PDFS?.get(key);
  if (stored) return pdfResponse(stored.body, invoice.number);
  const response = await ensurePdf(env, invoice);
  if (!response) throw new Error("Cloudflare Browser Run is not configured. Add the BROWSER binding before requesting PDFs.");
  return pdfResponse(response.body, invoice.number);
}

async function loadInvoice(env: Env, id?: string): Promise<InvoiceRecord> {
  if (!id) throw new Error("Invoice id is required");
  const row = await getInvoiceRow(env.DB, id);
  if (!row) throw new Error("Invoice not found");
  const client = await getClient(env.DB, row.client_id);
  if (!client) throw new Error("Invoice client not found");
  return rowToInvoice(row, client, await getProvider(env.DB));
}

async function buildDraft(env: Env, clientId: string, periodStart: string, periodEnd: string, pricingInput: InvoicePricingInput | undefined, isPreview: boolean, reusablePreview?: { summary: Summary; activity: ActivitySnapshot } | null): Promise<InvoiceDraft> {
  if (!clientId) throw new Error("Client id is required");
  assertDateRange(periodStart, periodEnd);
  const client = await getClient(env.DB, clientId);
  if (!client) throw new Error("Client not found");
  const pricing = normalizePricing(pricingInput, client);
  const provider = await getProvider(env.DB);
  let activity = reusablePreview?.activity || emptyActivity();
  if (!reusablePreview) {
    try {
      activity = await collectGithubActivity(client, periodStart, periodEnd, env.GITHUB_TOKEN);
    } catch (error) {
      console.error("GitHub activity unavailable", error);
    }
  }
  const summary = reusablePreview?.summary || await summarizeActivity(client, periodStart, periodEnd, activity, env.OPENAI_API_KEY, env.OPENAI_MODEL || "gpt-5.6-luna", env.AI);
  const subtotalCents = pricing.amountCents;
  const taxCents = Math.round(subtotalCents * (client.taxRate / 100));
  const issuedAt = new Date().toISOString();
  const dueAt = new Date(Date.parse(`${issuedAt}`) + client.paymentDays * 86400000).toISOString();
  return {
    number: isPreview ? "PREVIEW" : undefined,
    client,
    provider,
    periodStart,
    periodEnd,
    issuedAt,
    dueAt,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    pricing,
    summary,
    activity,
  };
}

async function ensurePdf(env: Env, invoice: InvoiceRecord): Promise<Response | null> {
  if (!env.BROWSER || isLocalOrigin(env.APP_ORIGIN)) return null;
  if (!env.INVOICE_PDFS) throw new Error("INVOICE_PDFS is not configured. Add the R2 binding before requesting PDFs.");
  const html = renderInvoiceHtml(invoice);
  const rendered = await env.BROWSER.quickAction("pdf", {
    html,
    pdfOptions: { format: "a4", printBackground: true, preferCSSPageSize: true, margin: { top: "0px", right: "0px", bottom: "0px", left: "0px" } },
  });
  if (!rendered.ok) {
    const detail = await rendered.text().catch(() => "");
    throw new Error(`PDF render failed (${rendered.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  const key = invoice.pdfKey || `invoices/${invoice.id}.pdf`;
  const bytes = await rendered.clone().arrayBuffer();
  await env.INVOICE_PDFS.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  if (!invoice.pdfKey && invoice.id) {
    invoice.pdfKey = key;
    await setInvoicePdfKey(env.DB, invoice.id, key);
  }
  return rendered;
}

function isLocalOrigin(origin?: string): boolean {
  return Boolean(origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin));
}

function isLocalRequest(request: Request): boolean {
  return isLocalOrigin(new URL(request.url).origin);
}

async function runScheduled(time: number, env: Env): Promise<void> {
  const now = new Date(time);
  const clients = await listClients(env.DB, false);
  for (const period of duePeriods(now)) {
    for (const client of clients) {
      if (client.cadence !== period.cadence) continue;
      const existing = await findInvoiceForPeriod(env.DB, client.id, period.start, period.end);
      if (existing) continue;
      try {
        const scheduledPricing = scheduledPricingFor(client);
        if (!scheduledPricing) {
          console.warn(`Scheduled invoice skipped for ${client.id}: invoice-time pricing is required for hourly clients, or a default flat fee is missing.`);
          continue;
        }
        const draft = await buildDraft(env, client.id, period.start, period.end, scheduledPricing, false);
        const id = crypto.randomUUID();
        const number = await nextInvoiceNumber(env.DB);
        const invoice: InvoiceRecord = { ...draft, id, number, status: "generated", currency: draft.client.currency };
        await createInvoiceRow(env.DB, {
          id,
          number,
          client_id: draft.client.id,
          status: "generated",
          period_start: draft.periodStart,
          period_end: draft.periodEnd,
          issued_at: draft.issuedAt,
          due_at: draft.dueAt,
          currency: draft.client.currency,
          subtotal_cents: draft.subtotalCents,
          tax_cents: draft.taxCents,
          total_cents: draft.totalCents,
          pricing_json: JSON.stringify(draft.pricing),
          summary_json: JSON.stringify(draft.summary),
          activity_json: JSON.stringify(draft.activity),
          pdf_key: null,
        });
        await ensurePdf(env, invoice);
      } catch (error) {
        console.error(`Scheduled invoice failed for ${client.id}`, error);
      }
    }
  }
}

export function duePeriod(now: Date): { cadence: "weekly" | "monthly"; start: string; end: string } | null {
  return duePeriods(now)[0] || null;
}

export function duePeriods(now: Date): Array<{ cadence: "weekly" | "monthly"; start: string; end: string }> {
  const periods: Array<{ cadence: "weekly" | "monthly"; start: string; end: string }> = [];
  if (now.getUTCDay() === 1) {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 6));
    periods.push({ cadence: "weekly", start: isoDay(start), end: isoDay(end) });
  }
  if (now.getUTCDate() === 1) {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    periods.push({ cadence: "monthly", start: isoDay(start), end: isoDay(end) });
  }
  return periods;
}

function publicInvoice(invoice: InvoiceRecord | InvoiceDraft, dispute: unknown = null): Record<string, unknown> {
  return {
    id: invoice.id,
    number: invoice.number,
    status: "status" in invoice ? invoice.status : "draft",
    client: invoice.client,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    currency: invoice.client.currency,
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    pricing: invoice.pricing,
    summary: invoice.summary,
    activity: {
      commits: invoice.activity.commits,
      repositories: invoice.activity.repositories,
      additions: invoice.activity.additions,
      deletions: invoice.activity.deletions,
      filesChanged: invoice.activity.filesChanged,
      contributors: invoice.activity.contributors,
      signals: invoice.activity.signals || [],
    },
    pdfAvailable: Boolean("pdfKey" in invoice ? invoice.pdfKey : false),
    dispute,
  };
}

function normalizeReusablePreview(value: { summary?: Summary; activity?: ActivitySnapshot } | undefined): { summary: Summary; activity: ActivitySnapshot } | null {
  if (!value?.summary || !value.activity) return null;
  const summary = value.summary;
  const activity = value.activity;
  const validSummary = typeof summary.title === "string"
    && typeof summary.overview === "string"
    && typeof summary.activitySummary === "string"
    && Array.isArray(summary.highlights)
    && Array.isArray(summary.deliverables)
    && Array.isArray(summary.nextSteps)
    && Array.isArray(summary.timeline);
  const validActivity = Array.isArray(activity.commits)
    && activity.commits.length <= 5000
    && Array.isArray(activity.repositories)
    && Array.isArray(activity.contributors)
    && Number.isFinite(Number(activity.additions))
    && Number.isFinite(Number(activity.deletions))
    && Number.isFinite(Number(activity.filesChanged));
  return validSummary && validActivity ? { summary, activity } : null;
}

function normalizePricing(input: InvoicePricingInput | undefined, client: Client): InvoicePricing {
  const model: BillingModel = input?.model === "hourly" || input?.model === "flat" ? input.model : client.billingModel;
  if (model !== client.billingModel) throw new Error(`Pricing must use this client's ${client.billingModel} billing model`);

  if (model === "flat") {
    const amountCents = integerCents(input?.amountCents);
    if (amountCents <= 0) throw new Error("Enter the flat fee for this invoice before previewing it");
    return {
      model,
      amountCents,
      description: input?.description?.trim() || "Flat project fee",
    };
  }

  const rateCents = integerCents(input?.rateCents);
  const hours = Number(input?.hours);
  if (rateCents <= 0) throw new Error("Enter the hourly rate before previewing this invoice");
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("Enter the billable hours before previewing this invoice");
  const amountCents = Math.round(rateCents * hours);
  if (amountCents <= 0) throw new Error("Hourly rate and hours must produce a positive invoice total");
  return {
    model,
    amountCents,
    rateCents,
    hours: Math.round(hours * 100) / 100,
    description: input?.description?.trim() || "Hourly services",
  };
}

function scheduledPricingFor(client: Client): InvoicePricingInput | null {
  if (client.billingModel === "flat" && client.defaultRateCents > 0) {
    return { model: "flat", amountCents: client.defaultRateCents, description: "Recurring flat project fee" };
  }
  return null;
}

function integerCents(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

async function requireAuth(request: Request, env: Env): Promise<void> {
  if (!env.ADMIN_TOKEN && !env.PORTAL_SECRET) throw new Error("ADMIN_TOKEN is not configured");
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const headerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const presented = headerToken || queryToken || "";
  if (env.ADMIN_TOKEN && constantTimeEqual(presented, env.ADMIN_TOKEN)) return;
  if (await verifyAdminToken(presented, adminSecret(env))) return;
  throw new Error("Unauthorized");
}

function adminSecret(env: Env): string {
  const secret = env.PORTAL_SECRET || env.ADMIN_TOKEN;
  if (!secret) throw new Error("Admin secret is not configured");
  return secret;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function pdfResponse(body: ReadableStream<Uint8Array> | null, number?: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${(number || "invoice").replace(/[^a-z0-9-_]/gi, "_")}.pdf"`,
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}

async function readJson<T>(request: Request): Promise<T> {
  const body = await request.json<T>();
  if (!body || typeof body !== "object") throw new Error("Request body must be JSON");
  return body;
}

function assertDateRange(start: string, end: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error("Dates must use YYYY-MM-DD");
  if (start > end) throw new Error("Period start must be before period end");
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function corsHeaders(): HeadersInit {
  return { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() } });
}
