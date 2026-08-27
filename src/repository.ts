import type {
  AdminState,
  Cadence,
  Client,
  ClientInput,
  ClientNote,
  D1ClientNoteRow,
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
import { SESSION_TTL_MS, generateSessionToken, hashPortalPassword, hashSessionToken, isPortalPasswordCompatible } from "./security";

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
    contactFirstName: row.contact_first_name || "",
    contactLastName: row.contact_last_name || "",
    email: row.email,
    phone: row.phone || "",
    address: row.address,
    website: row.website || "",
    githubRepos: parseJsonArray(row.github_repos),
    githubAuthor: row.github_author,
    projectContext: row.project_context || "",
    summaryPriorities: row.summary_priorities || "",
    cadence: row.cadence,
    billingDay: row.billing_day,
    billingModel: row.billing_model === "hourly" ? "hourly" : "flat",
    defaultRateCents: row.flat_amount_cents,
    defaultHours: Number(row.default_hours || 0) || undefined,
    currency: row.currency,
    paymentMethod: normalizePaymentMethod(row.payment_method),
    paymentTerms: row.payment_terms,
    paymentDays: row.payment_days,
    specialTerms: row.special_terms,
    taxRate: row.tax_rate,
    active: row.active === 1,
    metadata: parseMetadata(row.metadata),
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
    version: row.version ?? 1,
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
    paidAt: row.paid_at || undefined,
    amountPaidCents: Number(row.amount_paid_cents || 0),
    paymentReference: row.payment_reference || undefined,
    paymentChannel: row.payment_channel || undefined,
    sentAt: row.sent_at || undefined,
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
  try {
    const row = await db.prepare("SELECT onboarded, password_hash, password_salt, recovery_hash, recovery_salt, setup_at FROM admin_state WHERE id = 'singleton'").first<{ onboarded: number; password_hash: string; password_salt: string; recovery_hash: string; recovery_salt: string; setup_at: string }>();
    if (row) return { onboarded: row.onboarded === 1, passwordHash: row.password_hash || "", passwordSalt: row.password_salt || "", recoveryHash: row.recovery_hash || "", recoverySalt: row.recovery_salt || "", setupAt: row.setup_at || "" };
  } catch {}
  const legacy = await db.prepare("SELECT value FROM settings WHERE key = 'admin'").first<{ value: string }>();
  return legacy ? parseJson(legacy.value, EMPTY_ADMIN_STATE) : EMPTY_ADMIN_STATE;
}

export async function saveAdminState(db: D1Database, state: AdminState): Promise<void> {
  const legacy = JSON.stringify(state);
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('admin', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(legacy).run();
  try {
    await db.prepare(`INSERT INTO admin_state (id, onboarded, password_hash, password_salt, recovery_hash, recovery_salt, setup_at, updated_at)
      VALUES ('singleton', ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET onboarded=excluded.onboarded, password_hash=excluded.password_hash, password_salt=excluded.password_salt, recovery_hash=excluded.recovery_hash, recovery_salt=excluded.recovery_salt, setup_at=excluded.setup_at, updated_at=datetime('now')`)
      .bind(state.onboarded ? 1 : 0, state.passwordHash, state.passwordSalt, state.recoveryHash, state.recoverySalt, state.setupAt).run();
  } catch {}
  // Best-effort R2 backup marker is handled in scheduled(); no blocking write here.
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
        id, name, contact_first_name, contact_last_name, email, phone, address, website,
        github_repos, github_author, project_context, summary_priorities, cadence, billing_day,
        billing_model, flat_amount_cents, default_hours, currency, payment_method, payment_terms, payment_days, special_terms, tax_rate,
        metadata, portal_password_hash, portal_password_salt, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        contact_first_name = excluded.contact_first_name,
        contact_last_name = excluded.contact_last_name,
        email = excluded.email,
        phone = excluded.phone,
        address = excluded.address,
        website = excluded.website,
        github_repos = excluded.github_repos,
        github_author = excluded.github_author,
        project_context = excluded.project_context,
        summary_priorities = excluded.summary_priorities,
        cadence = excluded.cadence,
        billing_day = excluded.billing_day,
        billing_model = excluded.billing_model,
        flat_amount_cents = excluded.flat_amount_cents,
        default_hours = excluded.default_hours,
        currency = excluded.currency,
        payment_method = excluded.payment_method,
        payment_terms = excluded.payment_terms,
        payment_days = excluded.payment_days,
        special_terms = excluded.special_terms,
        tax_rate = excluded.tax_rate,
        metadata = excluded.metadata,
        portal_password_hash = CASE WHEN excluded.portal_password_hash <> '' THEN excluded.portal_password_hash ELSE clients.portal_password_hash END,
        portal_password_salt = CASE WHEN excluded.portal_password_salt <> '' THEN excluded.portal_password_salt ELSE clients.portal_password_salt END,
        active = excluded.active,
        updated_at = datetime('now')`,
    )
    .bind(
      id,
      normalized.name,
      normalized.contactFirstName,
      normalized.contactLastName,
      normalized.email,
      normalized.phone,
      normalized.address,
      normalized.website,
      JSON.stringify(normalized.githubRepos),
      normalized.githubAuthor,
      normalized.projectContext,
      normalized.summaryPriorities,
      normalized.cadence,
      normalized.billingDay,
      normalized.billingModel,
      normalized.defaultRateCents,
      normalized.defaultHours ?? 0,
      normalized.currency,
      normalized.paymentMethod,
      normalized.paymentTerms,
      normalized.paymentDays,
      normalized.specialTerms,
      normalized.taxRate,
      JSON.stringify(normalized.metadata),
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
        subtotal_cents, tax_cents, total_cents, pricing_json, summary_json, activity_json, manual_description, pdf_key, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      values.version ?? 1,
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
    contactFirstName: input.contactFirstName?.trim().slice(0, 120) || "",
    contactLastName: input.contactLastName?.trim().slice(0, 120) || "",
    email: input.email?.trim() || "",
    phone: input.phone?.trim().slice(0, 40) || "",
    address: input.address?.trim() || "",
    website: input.website?.trim().slice(0, 300) || "",
    githubRepos: repos,
    githubAuthor: input.githubAuthor?.trim() || "",
    projectContext: input.projectContext?.trim().slice(0, 4000) || "",
    summaryPriorities: input.summaryPriorities?.trim().slice(0, 4000) || "",
    cadence,
    billingDay: Math.max(1, Math.min(31, Math.floor(input.billingDay || 1))),
    billingModel: input.billingModel === "hourly" ? "hourly" : "flat",
    defaultRateCents: Math.max(0, Math.round(Number(input.defaultRateCents ?? input.flatAmountCents) || 0)),
    defaultHours: input.defaultHours !== undefined ? Math.max(0, Number(input.defaultHours)) : undefined,
    currency: (input.currency || "CAD").trim().toUpperCase().slice(0, 3),
    paymentMethod: normalizePaymentMethod(input.paymentMethod),
    paymentTerms: required(input.paymentTerms || "Due on receipt", "Payment terms"),
    paymentDays: Math.max(0, Math.min(365, Math.floor(input.paymentDays || 0))),
    specialTerms: input.specialTerms?.trim() || "",
    taxRate: Math.max(0, Math.min(100, Number(input.taxRate) || 0)),
    metadata: normalizeMetadata(input.metadata),
    active: input.active !== false,
  };
}

/** Metadata is stored as flat string values so it stays greppable and safe to render anywhere. */
function normalizeMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, entry]) => key.trim() && entry !== null && entry !== undefined && entry !== "")
    .slice(0, 50)
    .map(([key, entry]) => [key.trim().slice(0, 60), String(entry).slice(0, 500)] as const);
  return Object.fromEntries(entries);
}

function parseMetadata(value: string | null | undefined): Record<string, string> {
  return normalizeMetadata(parseJson<unknown>(value || "{}", {}));
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
    theme: provider.theme ? {
      accentColor: provider.theme.accentColor?.trim() || undefined,
      fontFamily: provider.theme.fontFamily?.trim() || undefined,
      headerStyle: provider.theme.headerStyle === "modern" || provider.theme.headerStyle === "minimal" ? provider.theme.headerStyle : "classic",
    } : undefined,
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

// ── Bulk import ──────────────────────────────────────────────────────────────

export async function bulkUpsertClients(db: D1Database, inputs: ClientInput[]): Promise<{ clients: Client[]; errors: Array<{ index: number; error: string }> }> {
  const clients: Client[] = [];
  const errors: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      const client = await upsertClient(db, inputs[i]);
      clients.push(client);
    } catch (e) {
      errors.push({ index: i, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { clients, errors };
}

export async function discoverGithubRepos(token: string | undefined, query: string): Promise<string[]> {
  if (!query.trim()) return [];
  // Query is org name or user/org search; fetch repos via GitHub API.
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const org = query.trim().replace(/^https?:\/\/github\.com\//i, "").split("/")[0];
  const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated`, { headers });
  if (!res.ok) {
    const userRes = await fetch(`https://api.github.com/users/${encodeURIComponent(org)}/repos?per_page=100&sort=updated`, { headers });
    if (!userRes.ok) throw new Error(`GitHub discovery failed (${res.status})`);
    const repos = await userRes.json() as Array<{ full_name: string }>;
    return repos.map((r) => r.full_name);
  }
  const repos = await res.json() as Array<{ full_name: string }>;
  return repos.map((r) => r.full_name);
}

// ── Invoice versioning / void / reissue ────────────────────────────────────

export async function createInvoiceVersion(db: D1Database, invoice: D1InvoiceRow): Promise<void> {
  const nextVersion = (invoice.version ?? 1) + 1;
  await db.prepare("INSERT INTO invoice_versions (id, invoice_id, version, status, summary_json, pricing_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), invoice.id, nextVersion - 1, invoice.status, invoice.summary_json, invoice.pricing_json).run();
}

export async function listInvoiceVersions(db: D1Database, invoiceId: string): Promise<Array<{ id: string; version: number; status: string; createdAt: string }>> {
  const { results } = await db.prepare("SELECT id, version, status, created_at as createdAt FROM invoice_versions WHERE invoice_id = ? ORDER BY version DESC").bind(invoiceId).all();
  return results as Array<{ id: string; version: number; status: string; createdAt: string }>;
}

export async function voidInvoice(db: D1Database, id: string): Promise<D1InvoiceRow> {
  const row = await getInvoiceRow(db, id);
  if (!row) throw new Error("Invoice not found");
  if (row.status === "void") return row;
  await createInvoiceVersion(db, row);
  await db.prepare("UPDATE invoices SET status = 'void', version = version + 1 WHERE id = ?").bind(id).run();
  const updated = await getInvoiceRow(db, id);
  if (!updated) throw new Error("Invoice not found after void");
  return updated;
}

export async function reissueInvoice(db: D1Database, id: string): Promise<D1InvoiceRow> {
  const row = await getInvoiceRow(db, id);
  if (!row) throw new Error("Invoice not found");
  if (row.status !== "void") throw new Error("Only voided invoices can be reissued");
  await db.prepare("UPDATE invoices SET status = 'generated', version = version + 1 WHERE id = ?").bind(id).run();
  const updated = await getInvoiceRow(db, id);
  if (!updated) throw new Error("Invoice not found after reissue");
  return updated;
}

/**
 * The only writer of payment state. Stripe webhooks and manually entered e-transfer/wire
 * payments both land here so every payment is recorded the same way.
 * Amounts accumulate: a part payment records the money without settling the invoice.
 */
export async function recordPayment(
  db: D1Database,
  id: string,
  payment: { amountCents?: number; reference?: string; channel?: string; paidAt?: string },
): Promise<D1InvoiceRow> {
  const row = await getInvoiceRow(db, id);
  if (!row) throw new Error("Invoice not found");
  if (row.status === "void") throw new Error("A voided invoice cannot be marked paid");
  const requested = Number(payment.amountCents);
  const amount = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : row.total_cents - Number(row.amount_paid_cents || 0);
  const paidTotal = Number(row.amount_paid_cents || 0) + Math.max(0, amount);
  const settled = paidTotal >= row.total_cents;
  await db
    .prepare("UPDATE invoices SET amount_paid_cents = ?, payment_reference = ?, payment_channel = ?, status = ?, paid_at = ?, version = version + 1 WHERE id = ?")
    .bind(
      paidTotal,
      (payment.reference || row.payment_reference || "").slice(0, 200),
      (payment.channel || row.payment_channel || "").slice(0, 40),
      settled ? "paid" : row.status,
      settled ? payment.paidAt || new Date().toISOString() : row.paid_at ?? null,
      id,
    )
    .run();
  const updated = await getInvoiceRow(db, id);
  if (!updated) throw new Error("Invoice not found after payment");
  return updated;
}

export async function markInvoicePaid(db: D1Database, id: string, provider: string, eventId: string, payload: string): Promise<D1InvoiceRow> {
  const existing = await db.prepare("SELECT 1 FROM webhook_events WHERE provider = ? AND event_id = ?").bind(provider, eventId).first();
  if (existing) throw new Error("Webhook event already processed");
  await db.prepare("INSERT INTO webhook_events (id, invoice_id, provider, event_id, payload) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, provider, eventId, payload).run();
  return recordPayment(db, id, { channel: provider, reference: eventId });
}

/** Records that the invoice reached the client. Only a freshly generated invoice moves to `sent`. */
export async function markInvoiceSent(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE invoices SET sent_at = ?, status = CASE WHEN status = 'generated' THEN 'sent' ELSE status END WHERE id = ?").bind(new Date().toISOString(), id).run();
}

export async function markInvoiceReminded(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE invoices SET reminded_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
}

/** Every invoice still owing money, oldest due date first. `dueBefore` narrows it to the overdue ones. */
export async function listOutstandingInvoices(db: D1Database, dueBefore?: string): Promise<D1InvoiceRow[]> {
  const query = "SELECT * FROM invoices WHERE status NOT IN ('paid', 'void') AND total_cents > amount_paid_cents";
  const statement = dueBefore
    ? db.prepare(`${query} AND due_at < ? ORDER BY due_at`).bind(dueBefore)
    : db.prepare(`${query} ORDER BY due_at`);
  const { results } = await statement.all<D1InvoiceRow>();
  return results;
}

// ── Client notes ────────────────────────────────────────────────────────────

export async function listClientNotes(db: D1Database, clientId: string): Promise<ClientNote[]> {
  const { results } = await db.prepare("SELECT * FROM client_notes WHERE client_id = ? ORDER BY created_at DESC LIMIT 200").bind(clientId).all<D1ClientNoteRow>();
  return results.map((row) => ({ id: row.id, clientId: row.client_id, body: row.body, author: row.author, createdAt: row.created_at }));
}

export async function addClientNote(db: D1Database, clientId: string, body: string, author: string): Promise<ClientNote> {
  const note = body.trim();
  if (!note) throw new Error("Note body is required");
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO client_notes (id, client_id, body, author) VALUES (?, ?, ?, ?)").bind(id, clientId, note.slice(0, 4000), author.trim().slice(0, 120)).run();
  const row = await db.prepare("SELECT * FROM client_notes WHERE id = ?").bind(id).first<D1ClientNoteRow>();
  if (!row) throw new Error("Note could not be saved");
  return { id: row.id, clientId: row.client_id, body: row.body, author: row.author, createdAt: row.created_at };
}

// ── Time entries ────────────────────────────────────────────────────────────

export async function listTimeEntries(db: D1Database, clientId: string): Promise<Array<{ id: string; clientId: string; date: string; hours: number; description: string; source: string }>> {
  const { results } = await db.prepare("SELECT id, client_id as clientId, date, hours, description, source FROM time_entries WHERE client_id = ? ORDER BY date DESC").bind(clientId).all();
  return results as Array<{ id: string; clientId: string; date: string; hours: number; description: string; source: string }>;
}

export async function importTimeEntries(db: D1Database, clientId: string, entries: Array<{ date: string; hours: number; description?: string; source?: string }>): Promise<number> {
  let count = 0;
  for (const e of entries) {
    if (!e.date || !Number.isFinite(Number(e.hours)) || Number(e.hours) <= 0) continue;
    await db.prepare("INSERT INTO time_entries (id, client_id, date, hours, description, source) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), clientId, e.date, Math.round(Number(e.hours) * 100) / 100, (e.description || "").slice(0, 500), (e.source || "manual").slice(0, 20)).run();
    count++;
  }
  return count;
}

// ── Operators / RBAC ───────────────────────────────────────────────────────

export async function listOperators(db: D1Database): Promise<Array<{ id: string; name: string; role: string; createdAt: string }>> {
  const { results } = await db.prepare("SELECT id, name, role, created_at as createdAt FROM operators ORDER BY created_at DESC").all();
  return results as Array<{ id: string; name: string; role: string; createdAt: string }>;
}

export async function createOperator(db: D1Database, name: string, role: "admin" | "operator", token: string): Promise<{ id: string; name: string; role: string; token: string }> {
  const { hash, salt } = await hashPortalPassword(token);
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO operators (id, name, role, token_hash, token_salt) VALUES (?, ?, ?, ?, ?)").bind(id, name.trim(), role, hash, salt).run();
  return { id, name: name.trim(), role, token };
}

export async function verifyOperatorToken(db: D1Database, presented: string): Promise<{ id: string; name: string; role: string } | null> {
  const { results } = await db.prepare("SELECT id, name, role, token_hash, token_salt FROM operators").all<{ id: string; name: string; role: string; token_hash: string; token_salt: string }>();
  const { verifyPortalPassword } = await import("./security");
  for (const row of results) {
    if (await verifyPortalPassword(presented, row.token_hash, row.token_salt)) return { id: row.id, name: row.name, role: row.role };
  }
  return null;
}

/** Mints a session and returns the secret. Only its hash is stored, so a database dump cannot sign in. */
export async function createSession(db: D1Database): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .bind(await hashSessionToken(token), now.toISOString(), expiresAt)
    .run();
  return { token, expiresAt };
}

export async function verifySession(db: D1Database, token: string): Promise<boolean> {
  if (!token) return false;
  const row = await db
    .prepare("SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await hashSessionToken(token), new Date().toISOString())
    .first<{ token_hash: string }>();
  return Boolean(row);
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  if (!token) return;
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashSessionToken(token)).run();
}

/** Signs every device out. Used whenever the password changes, so a stolen session dies with it. */
export async function deleteAllSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions").run();
}

export async function purgeExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
}

/**
 * Login throttle: at most 10 attempts per address in a rolling 60s window.
 * ponytail: sweeps the whole table on every attempt — fine while it holds tens of rows,
 * switch to a per-address delete if login volume ever grows.
 */
export async function recordAuthAttempt(db: D1Database, address: string, now = Date.now()): Promise<boolean> {
  const since = now - 60_000;
  await db.prepare("DELETE FROM auth_attempts WHERE attempted_at <= ?").bind(since).run();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE address = ? AND attempted_at > ?")
    .bind(address, since)
    .first<{ n: number }>();
  if (Number(row?.n || 0) >= 10) return false;
  await db.prepare("INSERT INTO auth_attempts (address, attempted_at) VALUES (?, ?)").bind(address, now).run();
  return true;
}
