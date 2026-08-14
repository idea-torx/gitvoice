import type {
  AdminState,
  Cadence,
  Client,
  ClientInput,
  D1ClientRow,
  D1InvoiceDisputeRow,
  D1InvoiceRow,
  InvoicePricing,
  InvoiceDispute,
  InvoiceRecord,
  PaymentMethod,
  ProviderProfile,
  Summary,
} from "./types";
import { hashPortalPassword, isPortalPasswordCompatible } from "./security";

const DEFAULT_PROVIDER: ProviderProfile = {
  businessName: "Gitvoice",
  providerName: "Your name",
  address: "Your address\nCity, Province, Country",
  email: "hello@example.com",
  website: "",
  taxId: "",
  remittance: "International wire transfer or direct deposit details go here.",
  logoUrl: "",
};

export function rowToClient(row: D1ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    address: row.address,
    githubRepos: parseJsonArray(row.github_repos),
    githubAuthor: row.github_author,
    projectContext: row.project_context || "",
    summaryPriorities: row.summary_priorities || "",
    cadence: row.cadence,
    billingDay: row.billing_day,
    billingModel: row.billing_model === "hourly" ? "hourly" : "flat",
    defaultRateCents: row.flat_amount_cents,
    currency: row.currency,
    paymentMethod: normalizePaymentMethod(row.payment_method),
    paymentTerms: row.payment_terms,
    paymentDays: row.payment_days,
    specialTerms: row.special_terms,
    taxRate: row.tax_rate,
    active: row.active === 1,
    portalPasswordSet: isPortalPasswordCompatible(row.portal_password_hash, row.portal_password_salt),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToInvoice(row: D1InvoiceRow, client: Client, provider: ProviderProfile): InvoiceRecord {
  const storedSummary = parseJson<Partial<Summary>>(row.summary_json, {});
  return {
    id: row.id,
    number: row.number,
    client,
    provider,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    currency: row.currency,
    pricing: normalizeStoredPricing(parseJson<Partial<InvoicePricing>>(row.pricing_json, {}), client, row.subtotal_cents),
    summary: {
      title: storedSummary.title || "Services provided",
      overview: storedSummary.overview || "",
      activitySummary: storedSummary.activitySummary || "Activity summary unavailable for this invoice.",
      highlights: Array.isArray(storedSummary.highlights) ? storedSummary.highlights.filter((item): item is string => typeof item === "string") : [],
      deliverables: Array.isArray(storedSummary.deliverables) ? storedSummary.deliverables.filter((item): item is string => typeof item === "string") : [],
      nextSteps: Array.isArray(storedSummary.nextSteps) ? storedSummary.nextSteps.filter((item): item is string => typeof item === "string") : [],
      timeline: Array.isArray(storedSummary.timeline) ? storedSummary.timeline.filter((item): item is NonNullable<Summary["timeline"]>[number] => Boolean(item) && typeof item === "object" && typeof item.period === "string" && typeof item.title === "string" && typeof item.detail === "string") : [],
      notes: typeof storedSummary.notes === "string" ? storedSummary.notes : undefined,
      source: storedSummary.source === "openai" ? "openai" : "fallback",
    },
    activity: parseJson(row.activity_json, {
      commits: [],
      repositories: [],
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      contributors: [],
    }),
    manualDescription: row.manual_description || undefined,
    pdfKey: row.pdf_key,
    createdAt: row.created_at,
  };
}

export async function getProvider(db: D1Database): Promise<ProviderProfile> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'provider'").first<{ value: string }>();
  return row ? parseJson(row.value, DEFAULT_PROVIDER) : DEFAULT_PROVIDER;
}

export async function saveProvider(db: D1Database, provider: ProviderProfile): Promise<ProviderProfile> {
  const value = JSON.stringify(sanitizeProvider(provider));
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('provider', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(value)
    .run();
  return sanitizeProvider(provider);
}

const EMPTY_ADMIN_STATE: AdminState = {
  onboarded: false,
  passwordHash: "",
  passwordSalt: "",
  recoveryHash: "",
  recoverySalt: "",
  setupAt: "",
};

export async function getAdminState(db: D1Database): Promise<AdminState> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'admin'").first<{ value: string }>();
  return row ? parseJson(row.value, EMPTY_ADMIN_STATE) : EMPTY_ADMIN_STATE;
}

export async function saveAdminState(db: D1Database, state: AdminState): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('admin', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(state))
    .run();
}

export async function listClients(db: D1Database, includeInactive = true): Promise<Client[]> {
  const query = includeInactive ? "SELECT * FROM clients ORDER BY name COLLATE NOCASE" : "SELECT * FROM clients WHERE active = 1 ORDER BY name COLLATE NOCASE";
  const { results } = await db.prepare(query).all<D1ClientRow>();
  return results.map(rowToClient);
}

export async function getClient(db: D1Database, id: string): Promise<Client | null> {
  const row = await db.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first<D1ClientRow>();
  return row ? rowToClient(row) : null;
}

export async function upsertClient(db: D1Database, input: ClientInput): Promise<Client> {
  const id = input.id || crypto.randomUUID();
  const normalized = normalizeClientInput(input);
  const portalPassword = input.portalPassword?.trim() || "";
  const portalCredentials = portalPassword ? await hashPortalPassword(portalPassword) : { hash: "", salt: "" };
  await db
    .prepare(
      `INSERT INTO clients (
        id, name, email, address, github_repos, github_author, project_context, summary_priorities, cadence, billing_day,
        billing_model, flat_amount_cents, currency, payment_method, payment_terms, payment_days, special_terms, tax_rate,
        portal_password_hash, portal_password_salt, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        address = excluded.address,
        github_repos = excluded.github_repos,
        github_author = excluded.github_author,
        project_context = excluded.project_context,
        summary_priorities = excluded.summary_priorities,
        cadence = excluded.cadence,
        billing_day = excluded.billing_day,
        billing_model = excluded.billing_model,
        flat_amount_cents = excluded.flat_amount_cents,
        currency = excluded.currency,
        payment_method = excluded.payment_method,
        payment_terms = excluded.payment_terms,
        payment_days = excluded.payment_days,
        special_terms = excluded.special_terms,
        tax_rate = excluded.tax_rate,
        portal_password_hash = CASE WHEN excluded.portal_password_hash <> '' THEN excluded.portal_password_hash ELSE clients.portal_password_hash END,
        portal_password_salt = CASE WHEN excluded.portal_password_salt <> '' THEN excluded.portal_password_salt ELSE clients.portal_password_salt END,
        active = excluded.active,
        updated_at = datetime('now')`,
    )
    .bind(
      id,
      normalized.name,
      normalized.email,
      normalized.address,
      JSON.stringify(normalized.githubRepos),
      normalized.githubAuthor,
      normalized.projectContext,
      normalized.summaryPriorities,
      normalized.cadence,
      normalized.billingDay,
      normalized.billingModel,
      normalized.defaultRateCents,
      normalized.currency,
      normalized.paymentMethod,
      normalized.paymentTerms,
      normalized.paymentDays,
      normalized.specialTerms,
      normalized.taxRate,
      portalCredentials.hash,
      portalCredentials.salt,
      normalized.active ? 1 : 0,
    )
    .run();

  const client = await getClient(db, id);
  if (!client) throw new Error("Client could not be saved");
  return client;
}

export async function deleteClient(db: D1Database, id: string): Promise<void> {
  const invoice = await db.prepare("SELECT 1 FROM invoices WHERE client_id = ? LIMIT 1").bind(id).first();
  if (invoice) {
    await db.prepare("UPDATE clients SET active = 0, updated_at = datetime('now') WHERE id = ?").bind(id).run();
    return;
  }
  await db.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
}

export async function getPortalCredentials(db: D1Database, id: string): Promise<{ id: string; active: number; portal_password_hash: string; portal_password_salt: string } | null> {
  return db.prepare("SELECT id, active, portal_password_hash, portal_password_salt FROM clients WHERE id = ?").bind(id).first();
}

export async function listInvoices(db: D1Database, limit = 30): Promise<D1InvoiceRow[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const { results } = await db.prepare(`SELECT * FROM invoices ORDER BY issued_at DESC LIMIT ${safeLimit}`).all<D1InvoiceRow>();
  return results;
}

export async function listInvoicesForClient(db: D1Database, clientId: string, limit = 100): Promise<D1InvoiceRow[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const { results } = await db.prepare(`SELECT * FROM invoices WHERE client_id = ? ORDER BY issued_at DESC LIMIT ${safeLimit}`).bind(clientId).all<D1InvoiceRow>();
  return results;
}

export async function getInvoiceRow(db: D1Database, id: string): Promise<D1InvoiceRow | null> {
  return db.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first<D1InvoiceRow>();
}

export async function deleteInvoiceRow(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM invoices WHERE id = ?").bind(id).run();
}

export async function listInvoiceDisputes(db: D1Database, clientId?: string): Promise<InvoiceDispute[]> {
  const query = clientId
    ? "SELECT * FROM invoice_disputes WHERE client_id = ? ORDER BY created_at DESC"
    : "SELECT * FROM invoice_disputes ORDER BY created_at DESC";
  const statement = clientId ? db.prepare(query).bind(clientId) : db.prepare(query);
  const { results } = await statement.all<D1InvoiceDisputeRow>();
  return results.map(rowToInvoiceDispute);
}

export async function upsertInvoiceDispute(db: D1Database, invoiceId: string, clientId: string, reason: string): Promise<InvoiceDispute> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO invoice_disputes (id, invoice_id, client_id, reason)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(invoice_id) DO UPDATE SET reason = excluded.reason, created_at = datetime('now')`,
    )
    .bind(id, invoiceId, clientId, reason.trim().slice(0, 2000))
    .run();
  const row = await db.prepare("SELECT * FROM invoice_disputes WHERE invoice_id = ?").bind(invoiceId).first<D1InvoiceDisputeRow>();
  if (!row) throw new Error("Invoice dispute could not be saved");
  return rowToInvoiceDispute(row);
}

function rowToInvoiceDispute(row: D1InvoiceDisputeRow): InvoiceDispute {
  return { id: row.id, invoiceId: row.invoice_id, clientId: row.client_id, reason: row.reason, createdAt: row.created_at };
}

export async function findInvoiceForPeriod(db: D1Database, clientId: string, periodStart: string, periodEnd: string): Promise<D1InvoiceRow | null> {
  return db
    .prepare("SELECT * FROM invoices WHERE client_id = ? AND period_start = ? AND period_end = ? LIMIT 1")
    .bind(clientId, periodStart, periodEnd)
    .first<D1InvoiceRow>();
}

export async function createInvoiceRow(
  db: D1Database,
  values: Omit<D1InvoiceRow, "created_at">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invoices (
        id, number, client_id, status, period_start, period_end, issued_at, due_at, currency,
        subtotal_cents, tax_cents, total_cents, pricing_json, summary_json, activity_json, manual_description, pdf_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.id,
      values.number,
      values.client_id,
      values.status,
      values.period_start,
      values.period_end,
      values.issued_at,
      values.due_at,
      values.currency,
      values.subtotal_cents,
      values.tax_cents,
      values.total_cents,
      values.pricing_json,
      values.summary_json,
      values.activity_json,
      values.manual_description ?? null,
      values.pdf_key ?? null,
    )
    .run();
}

export async function setInvoicePdfKey(db: D1Database, id: string, pdfKey: string): Promise<void> {
  await db.prepare("UPDATE invoices SET pdf_key = ? WHERE id = ?").bind(pdfKey, id).run();
}

export async function nextInvoiceNumber(db: D1Database, prefix = "INV"): Promise<string> {
  const row = await db
    .prepare("INSERT INTO counters (name, value) VALUES ('invoice', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value")
    .first<{ value: number }>();
  const sequence = row?.value ?? 1;
  return `${prefix}-${new Date().getUTCFullYear()}-${String(sequence).padStart(4, "0")}`;
}

function normalizeClientInput(input: ClientInput): Client {
  const repos = normalizeGithubRepositories(input.githubRepos);
  const cadence: Cadence = input.cadence === "weekly" || input.cadence === "monthly" ? input.cadence : "manual";
  return {
    id: input.id || "",
    name: required(input.name, "Client name"),
    email: input.email?.trim() || "",
    address: input.address?.trim() || "",
    githubRepos: repos,
    githubAuthor: input.githubAuthor?.trim() || "",
    projectContext: input.projectContext?.trim().slice(0, 4000) || "",
    summaryPriorities: input.summaryPriorities?.trim().slice(0, 4000) || "",
    cadence,
    billingDay: Math.max(1, Math.min(31, Math.floor(input.billingDay || 1))),
    billingModel: input.billingModel === "hourly" ? "hourly" : "flat",
    defaultRateCents: Math.max(0, Math.round(Number(input.defaultRateCents ?? input.flatAmountCents) || 0)),
    currency: (input.currency || "USD").trim().toUpperCase().slice(0, 3),
    paymentMethod: normalizePaymentMethod(input.paymentMethod),
    paymentTerms: required(input.paymentTerms || "Due on receipt", "Payment terms"),
    paymentDays: Math.max(0, Math.min(365, Math.floor(input.paymentDays || 0))),
    specialTerms: input.specialTerms?.trim() || "",
    taxRate: Math.max(0, Math.min(100, Number(input.taxRate) || 0)),
    active: input.active !== false,
  };
}

export function normalizeGithubRepositories(values: string[]): string[] {
  const candidates = values.flatMap((value) =>
    String(value || "")
      .replace(/(?=https?:\/\/(?:www\.)?github\.com\/)/gi, "\n")
      .split(/[\s,]+/)
      .filter(Boolean),
  );
  const repositories = candidates.map((candidate) =>
    candidate
      .trim()
      .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
      .replace(/^git@github\.com:/i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, ""),
  );
  for (const repository of repositories) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  return Array.from(new Set(repositories));
}

function normalizePaymentMethod(value: string | undefined): PaymentMethod {
  if (value === "etransfer" || value === "alternative") return value;
  return "wire";
}

function normalizeStoredPricing(stored: Partial<InvoicePricing>, client: Client, subtotalCents: number): InvoicePricing {
  const model = stored.model === "hourly" || stored.model === "flat" ? stored.model : client.billingModel;
  const amountCents = Number.isFinite(Number(stored.amountCents)) ? Math.max(0, Math.round(Number(stored.amountCents))) : subtotalCents;
  const rateCents = Number.isFinite(Number(stored.rateCents)) ? Math.max(0, Math.round(Number(stored.rateCents))) : undefined;
  const hours = Number.isFinite(Number(stored.hours)) ? Math.max(0, Number(stored.hours)) : undefined;
  return {
    model,
    amountCents,
    ...(rateCents === undefined ? {} : { rateCents }),
    ...(hours === undefined ? {} : { hours }),
    description: typeof stored.description === "string" && stored.description.trim() ? stored.description.trim() : model === "hourly" ? "Hourly services" : "Flat project fee",
  };
}

function sanitizeProvider(provider: ProviderProfile): ProviderProfile {
  return {
    businessName: provider.businessName?.trim() || DEFAULT_PROVIDER.businessName,
    providerName: provider.providerName?.trim() || DEFAULT_PROVIDER.providerName,
    address: provider.address?.trim() || DEFAULT_PROVIDER.address,
    email: provider.email?.trim() || "",
    website: provider.website?.trim() || "",
    taxId: provider.taxId?.trim() || "",
    remittance: provider.remittance?.trim() || "",
    logoUrl: provider.logoUrl?.trim() || "",
  };
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseJsonArray(value: string): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}
