export type Cadence = "weekly" | "monthly" | "manual";
export type BillingModel = "hourly" | "flat";
export type PaymentMethod = "etransfer" | "wire" | "alternative";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  INVOICE_PDFS: R2Bucket;
  BROWSER?: BrowserRun;
  AI?: Ai;
  EMAIL?: { send: (message: unknown) => Promise<void> };
  ADMIN_TOKEN?: string;
  GITHUB_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  APP_ORIGIN?: string;
  PORTAL_SECRET?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export interface ProviderTheme {
  accentColor?: string;
  fontFamily?: string;
  headerStyle?: "classic" | "modern" | "minimal";
}

export interface ProviderProfile {
  businessName: string;
  providerName: string;
  address: string;
  email: string;
  website: string;
  taxId: string;
  remittance: string;
  logoUrl?: string;
  theme?: ProviderTheme;
}

export interface AdminState {
  onboarded: boolean;
  passwordHash: string;
  passwordSalt: string;
  recoveryHash: string;
  recoverySalt: string;
  setupAt: string;
}

export interface Operator {
  id: string;
  name: string;
  role: "admin" | "operator";
  tokenHash: string;
  tokenSalt: string;
  createdAt?: string;
}

export interface Client {
  id: string;
  /** Company billed on the invoice. */
  name: string;
  /** Person to address at that company. Blank when there is no named contact. */
  contactFirstName: string;
  contactLastName: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  githubRepos: string[];
  githubAuthor: string;
  projectContext: string;
  summaryPriorities: string;
  cadence: Cadence;
  billingDay: number;
  billingModel: BillingModel;
  defaultRateCents: number;
  defaultHours?: number;
  currency: string;
  paymentMethod: PaymentMethod;
  paymentTerms: string;
  paymentDays: number;
  specialTerms: string;
  taxRate: number;
  active: boolean;
  /** Free-form keys an agent can set without a migration. Never rendered on the invoice. */
  metadata: Record<string, string>;
  portalPasswordSet?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientNote {
  id: string;
  clientId: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface CommitActivity {
  sha: string;
  repo: string;
  message: string;
  date: string;
  author: string;
  url: string;
  additions: number;
  deletions: number;
  files: string[];
  fileCount?: number;
}

export interface ActivitySnapshot {
  commits: CommitActivity[];
  repositories: string[];
  additions: number;
  deletions: number;
  filesChanged: number;
  contributors: string[];
  signals?: GithubProjectSignal[];
}

export interface GithubProjectSignal {
  type: "pull_request" | "release";
  repo: string;
  title: string;
  description: string;
  date: string;
  url: string;
  labels: string[];
}

export interface TimelineEntry {
  period: string;
  title: string;
  detail: string;
  commits: number;
}

export interface Summary {
  title: string;
  overview: string;
  activitySummary: string;
  highlights: string[];
  deliverables: string[];
  nextSteps: string[];
  timeline: TimelineEntry[];
  notes?: string;
  source: "openai" | "fallback";
}

export interface SummaryOverride {
  title?: string;
  overview?: string;
  highlights?: string[];
  deliverables?: string[];
  nextSteps?: string[];
  timeline?: TimelineEntry[];
}

export interface TimeEntry {
  id: string;
  clientId: string;
  date: string;
  hours: number;
  description: string;
  source?: string;
}

export interface InvoiceVersion {
  id: string;
  invoiceId: string;
  version: number;
  status: InvoiceRecord["status"];
  summaryJson: string;
  pricingJson: string;
  createdAt: string;
}

export interface InvoiceDraft {
  id?: string;
  number?: string;
  client: Client;
  provider: ProviderProfile;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  pricing: InvoicePricing;
  summary: Summary;
  activity: ActivitySnapshot;
  /** Operator's raw work description. Set on manual invoices only; GitHub-sourced invoices leave it undefined. */
  manualDescription?: string;
}

export interface InvoiceRecord extends InvoiceDraft {
  id: string;
  number: string;
  status: "draft" | "generated" | "sent" | "paid" | "void";
  currency: string;
  /** Payment state. `amountPaidCents` accumulates, so a part payment leaves the status alone. */
  paidAt?: string;
  amountPaidCents?: number;
  paymentReference?: string;
  paymentChannel?: string;
  sentAt?: string;
  pdfKey?: string | null;
  createdAt?: string;
  version?: number;
}

export interface ClientInput {
  id?: string;
  name: string;
  contactFirstName?: string;
  contactLastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  githubRepos: string[];
  githubAuthor?: string;
  projectContext?: string;
  summaryPriorities?: string;
  cadence: Cadence;
  billingDay?: number;
  billingModel?: BillingModel;
  defaultRateCents?: number;
  /** @deprecated Use defaultRateCents. Kept so older clients can still be edited. */
  flatAmountCents?: number;
  defaultHours?: number;
  currency: string;
  paymentMethod: PaymentMethod;
  paymentTerms: string;
  paymentDays?: number;
  specialTerms?: string;
  taxRate?: number;
  metadata?: Record<string, unknown>;
  portalPassword?: string;
  active?: boolean;
}

export interface InvoicePricing {
  model: BillingModel;
  amountCents: number;
  rateCents?: number;
  hours?: number;
  description: string;
}

export interface InvoicePricingInput {
  model?: BillingModel;
  amountCents?: number;
  rateCents?: number;
  hours?: number;
  description?: string;
}

export interface BrowserRun {
  quickAction(action: "pdf", options: Record<string, unknown>): Promise<Response>;
}

export interface D1ClientRow {
  id: string;
  name: string;
  contact_first_name: string;
  contact_last_name: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  github_repos: string;
  github_author: string;
  project_context: string;
  summary_priorities: string;
  cadence: Cadence;
  billing_day: number;
  billing_model: BillingModel;
  flat_amount_cents: number;
  currency: string;
  payment_method: PaymentMethod;
  payment_terms: string;
  payment_days: number;
  special_terms: string;
  tax_rate: number;
  portal_password_hash: string;
  portal_password_salt: string;
  active: number;
  created_at?: string;
  updated_at?: string;
  default_hours?: number | null;
  metadata?: string | null;
}

export interface D1InvoiceRow {
  id: string;
  number: string;
  client_id: string;
  status: InvoiceRecord["status"];
  period_start: string;
  period_end: string;
  issued_at: string;
  due_at: string;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  pricing_json: string;
  summary_json: string;
  activity_json: string;
  manual_description?: string | null;
  paid_at?: string | null;
  amount_paid_cents?: number | null;
  payment_reference?: string | null;
  payment_channel?: string | null;
  sent_at?: string | null;
  reminded_at?: string | null;
  pdf_key?: string | null;
  created_at?: string;
  version?: number;
}

export interface D1ClientNoteRow {
  id: string;
  client_id: string;
  body: string;
  author: string;
  created_at: string;
}

export interface InvoiceDispute {
  id: string;
  invoiceId: string;
  clientId: string;
  reason: string;
  createdAt: string;
}

export interface D1InvoiceDisputeRow {
  id: string;
  invoice_id: string;
  client_id: string;
  reason: string;
  created_at: string;
}

export interface D1InvoiceVersionRow {
  id: string;
  invoice_id: string;
  version: number;
  status: string;
  summary_json: string;
  pricing_json: string;
  created_at: string;
}

export interface D1OperatorRow {
  id: string;
  name: string;
  role: string;
  token_hash: string;
  token_salt: string;
  created_at: string;
}

export interface D1TimeEntryRow {
  id: string;
  client_id: string;
  date: string;
  hours: number;
  description: string;
  source: string;
  created_at: string;
}
