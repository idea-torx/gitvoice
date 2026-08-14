import type { InvoiceDraft, InvoiceRecord } from "./types";

const PAPER_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
:root { --ink: #1d1d1f; --muted: #6e6e73; --subtle: #86868b; --line: #e5e5e7; --soft: #f5f5f7; --blue: #0071e3; --blue-soft: #f0f7ff; }
html, body { margin: 0; padding: 0; background: #e8e8ed; color: var(--ink); }
body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; font-size: 10.5px; line-height: 1.45; -webkit-font-smoothing: antialiased; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.invoice-page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; position: relative; overflow: hidden; page-break-after: always; }
.invoice-page:last-child { page-break-after: auto; }
.page-inner { min-height: 297mm; padding: 15mm 16mm 14mm; display: flex; flex-direction: column; }
.doc-header, .summary-header, .activity-header { min-height: 13mm; display: flex; align-items: flex-start; justify-content: space-between; gap: 12mm; padding-bottom: 6mm; border-bottom: 1px solid var(--line); }
.brand { font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }
.invoice-logo { width: 36mm; height: auto; display: block; }
.brand-subtitle { margin-top: 2px; color: var(--muted); font-size: 9px; }
.document-mark { text-align: right; }
.eyebrow, .label { margin: 0; color: var(--subtle); font-size: 8px; font-weight: 600; letter-spacing: -0.01em; text-transform: uppercase; }
.document-mark strong { display: block; margin-top: 3px; font-size: 11px; font-weight: 600; letter-spacing: -0.01em; }
.cover-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12mm; align-items: end; padding: 11mm 0 10mm; }
.hero-kicker { margin: 0 0 3mm; color: var(--blue); font-size: 9px; font-weight: 600; }
.hero-title { max-width: 118mm; margin: 0; font-size: 30px; line-height: 1.03; font-weight: 650; letter-spacing: -0.01em; }
.hero-period { margin: 4mm 0 0; color: var(--muted); font-size: 10px; }
.amount-card { min-width: 48mm; border-radius: 5mm; padding: 6mm; background: var(--soft); text-align: right; }
.amount-card strong { display: block; margin-top: 2mm; font-size: 23px; line-height: 1; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; }
.info-grid { display: grid; grid-template-columns: 1.15fr .85fr .85fr; gap: 3mm; margin-bottom: 4mm; }
.info-card { min-height: 31mm; border: 1px solid var(--line); border-radius: 4mm; padding: 4.5mm; }
.info-value { margin-top: 3mm; font-size: 11px; font-weight: 600; line-height: 1.35; }
.info-detail { margin-top: 1.5mm; color: var(--muted); font-size: 9px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
.work-card { margin-top: 3mm; border-radius: 5mm; padding: 5.5mm 6mm; background: var(--soft); }
.work-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10mm; margin-bottom: 3mm; }
.work-card h2 { margin: 0; font-size: 15px; line-height: 1.15; font-weight: 650; letter-spacing: -0.01em; }
.source-note { max-width: 52mm; color: var(--subtle); font-size: 8px; line-height: 1.35; text-align: right; }
.summary-copy { margin: 0; color: #424245; font-size: 10px; line-height: 1.55; }
.work-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 4mm; }
.work-columns ul { margin: 2mm 0 0; padding-left: 4mm; }
.work-columns li { margin: 1.2mm 0; color: #424245; font-size: 9px; line-height: 1.4; }
.billing-card { margin-top: 4mm; overflow: hidden; border: 1px solid var(--line); border-radius: 4mm; }
.billing-row { display: grid; grid-template-columns: 1fr auto; gap: 8mm; align-items: baseline; padding: 3mm 4.5mm; border-bottom: 1px solid var(--line); }
.billing-row:last-child { border-bottom: 0; }
.billing-row span { color: var(--muted); }
.billing-row strong { font-size: 10px; font-weight: 600; white-space: nowrap; }
.billing-total { padding-top: 4mm; padding-bottom: 4mm; background: var(--blue-soft); }
.billing-total span { color: var(--ink); font-weight: 600; }
.billing-total strong { color: var(--blue); font-size: 17px; letter-spacing: -0.01em; }
.terms-note { margin-top: 3mm; border-left: 2px solid var(--blue); padding: 2mm 0 2mm 3mm; color: var(--muted); font-size: 9px; line-height: 1.45; }
.notes-card { margin-top: 3mm; border: 1px solid var(--line); border-radius: 4mm; padding: 3.5mm 4mm; }
.notes-card .label { margin-bottom: 2mm; }
.notes-copy { color: #424245; font-size: 9px; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; }
.cover-footer { display: grid; grid-template-columns: 1fr 1.2fr; gap: 10mm; margin-top: auto; padding-top: 7mm; }
.footer-block strong { display: block; margin: 2.5mm 0 1mm; font-size: 10px; font-weight: 600; }
.footer-copy { color: var(--muted); font-size: 8.5px; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; }
.footer-meta { display: flex; flex-wrap: wrap; gap: 2mm 4mm; margin-top: 2mm; color: var(--subtle); font-size: 8px; }
.summary-page .page-inner, .activity-page .page-inner { padding-top: 15mm; }
.summary-header h1, .activity-header h1 { margin: 2mm 0 0; font-size: 24px; line-height: 1; font-weight: 650; letter-spacing: -0.01em; }
.page-number { color: var(--muted); font-size: 9px; font-variant-numeric: tabular-nums; }
.summary-intro { max-width: 158mm; margin: 7mm 0; color: #424245; font-size: 11px; line-height: 1.6; }
.summary-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 0 0 8mm; }
.summary-metric { min-height: 22mm; border-radius: 4mm; padding: 4mm; background: var(--soft); }
.summary-metric strong { display: block; margin-top: 3mm; font-size: 19px; line-height: 1; font-weight: 650; letter-spacing: -0.01em; }
.timeline-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8mm; padding-bottom: 3mm; border-bottom: 1px solid var(--line); }
.timeline-heading h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
.timeline-heading span { color: var(--muted); font-size: 9px; }
.timeline-list { margin-top: 1mm; }
.timeline-row { position: relative; display: grid; grid-template-columns: 28mm 38mm 1fr 17mm; gap: 4mm; align-items: start; padding: 4.5mm 3mm 4.5mm 5mm; border-bottom: 1px solid var(--line); }
.timeline-row::before { content: ""; position: absolute; top: 5mm; left: 1mm; width: 2mm; height: 2mm; border-radius: 50%; background: var(--blue); }
.timeline-row:last-child { border-bottom: 0; }
.timeline-period { color: var(--muted); font-size: 9px; }
.timeline-row h3 { margin: 0; font-size: 10px; font-weight: 650; }
.timeline-detail { color: #515154; font-size: 9.5px; line-height: 1.5; }
.timeline-count { color: var(--muted); font-size: 8.5px; text-align: right; white-space: nowrap; }
.timeline-note { margin-top: 6mm; border-radius: 3mm; padding: 3mm 4mm; background: var(--blue-soft); color: #515154; font-size: 9px; }
.activity-intro { margin: 6mm 0 0; color: var(--muted); font-size: 9.5px; line-height: 1.55; }
.activity-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 6mm; overflow: hidden; border: 1px solid var(--line); border-radius: 4mm; background: #fff; }
.activity-table th { border-bottom: 1px solid var(--line); padding: 3mm; background: var(--soft); color: var(--subtle); text-align: left; text-transform: uppercase; font-size: 7.5px; font-weight: 600; letter-spacing: -0.01em; }
.activity-table td { border-bottom: 1px solid var(--line); padding: 3mm; vertical-align: top; font-size: 8.5px; }
.activity-table tr:last-child td { border-bottom: 0; }
.activity-table .message { width: 58%; }
.activity-table .message strong { font-size: 9px; font-weight: 600; }
.activity-table .repo { margin-top: 1mm; color: var(--muted); font-size: 8px; }
.activity-table a { color: inherit; text-decoration: none; }
.activity-table a:hover { color: var(--blue); }
.activity-footer { position: absolute; left: 16mm; right: 16mm; bottom: 9mm; display: flex; justify-content: space-between; padding-top: 3mm; border-top: 1px solid var(--line); color: var(--subtle); font-size: 8px; }
.muted { color: var(--muted); }
@media screen { .invoice-page { box-shadow: 0 14px 50px rgba(0,0,0,.13); margin: 24px auto; } }
@media print { html, body { background: #fff; } .invoice-page { margin: 0; box-shadow: none; } }
`;

export function renderInvoiceHtml(invoice: InvoiceDraft | InvoiceRecord): string {
  const pages = [renderCoverPage(invoice)];
  const commits = invoice.activity.commits;
  if (invoice.summary.timeline.length || commits.length) pages.push(renderWorkSummaryPage(invoice));
  for (let offset = 0; offset < commits.length; offset += 12) {
    pages.push(renderActivityPage(invoice, commits.slice(offset, offset + 12), Math.floor(offset / 12) + 3));
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(invoice.number || "Invoice")}</title><style>${PAPER_CSS}</style></head><body>${pages.join("")}</body></html>`;
}

function renderCoverPage(invoice: InvoiceDraft | InvoiceRecord): string {
  const summary = invoice.summary;
  const highlights = summary.highlights.slice(0, 4);
  const deliverables = summary.deliverables.slice(0, 4);
  const sourceNote = summary.source === "openai" ? "AI-assisted summary grounded in GitHub activity" : "Generated from verified GitHub commit activity";
  const invoiceNumber = invoice.number || "DRAFT";
  const logoSrc = invoice.provider.logoUrl || "/logo.svg";
  const logoAlt = invoice.provider.businessName || "Gitvoice";
  const issuedDate = formatDate(invoice.issuedAt, { month: "short", day: "numeric", year: "numeric" });
  const dueDate = formatDate(invoice.dueAt, { month: "short", day: "numeric", year: "numeric" });
  const period = `${formatDate(invoice.periodStart, { month: "short", day: "numeric", year: "numeric" })} – ${formatDate(invoice.periodEnd, { month: "short", day: "numeric", year: "numeric" })}`;
  return `<section class="invoice-page cover-page"><div class="page-inner">
    <header class="doc-header"><div><img class="invoice-logo" src="${escapeAttribute(logoSrc)}" alt="${escapeHtml(logoAlt)}"><div class="brand-subtitle">Independent services</div></div><div class="document-mark"><p class="eyebrow">Invoice</p><strong>${escapeHtml(invoiceNumber)}</strong></div></header>
    <section class="cover-hero"><div><p class="hero-kicker">Invoice for ${escapeHtml(invoice.client.name)}</p><h1 class="hero-title">${escapeHtml(summary.title || "Professional services")}</h1><p class="hero-period">Billing period · ${escapeHtml(period)}</p></div><div class="amount-card"><p class="label">Total due</p><strong>${formatMoney(invoice.totalCents, invoice.client.currency)}</strong></div></section>
    <section class="info-grid"><div class="info-card"><p class="label">Billed to</p><div class="info-value">${escapeHtml(invoice.client.name)}</div><div class="info-detail">${escapeHtml(invoice.client.address || "Address not provided")}${invoice.client.email ? `\n${escapeHtml(invoice.client.email)}` : ""}</div></div><div class="info-card"><p class="label">Dates</p><div class="info-value">Issued ${issuedDate}</div><div class="info-detail">Due ${dueDate}</div></div><div class="info-card"><p class="label">Payment</p><div class="info-value">${escapeHtml(paymentMethodLabel(invoice.client.paymentMethod))}</div><div class="info-detail">${escapeHtml(invoice.client.paymentTerms)} · Ref ${escapeHtml(invoiceNumber)}</div></div></section>
    <section class="work-card"><div class="work-card-header"><div><p class="label" style="margin-bottom:2mm">Work completed</p><h2>${escapeHtml(summary.title)}</h2></div><div class="source-note">${escapeHtml(sourceNote)}</div></div><p class="summary-copy">${escapeHtml(summary.overview)}</p>${highlights.length || deliverables.length ? `<div class="work-columns">${highlights.length ? `<div><p class="label">Highlights</p><ul>${highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}${deliverables.length ? `<div><p class="label">Deliverables</p><ul>${deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}</div>` : ""}</section>
    <section class="billing-card"><div class="billing-row"><span>${escapeHtml(invoice.pricing.description || "Professional services")}</span><strong>${escapeHtml(formatPricing(invoice))}</strong></div><div class="billing-row"><span>GitHub activity</span><strong>${invoice.activity.commits.length} commits · ${invoice.activity.filesChanged} files · ${invoice.activity.repositories.length} repo${invoice.activity.repositories.length === 1 ? "" : "s"}</strong></div><div class="billing-row"><span>Subtotal</span><strong>${formatMoney(invoice.subtotalCents, invoice.client.currency)}</strong></div>${invoice.taxCents ? `<div class="billing-row"><span>Tax (${formatTaxRate(invoice.client.taxRate)}%)</span><strong>${formatMoney(invoice.taxCents, invoice.client.currency)}</strong></div>` : ""}<div class="billing-row billing-total"><span>Total due</span><strong>${formatMoney(invoice.totalCents, invoice.client.currency)}</strong></div></section>
    ${invoice.client.specialTerms ? `<div class="terms-note"><strong>Special terms:</strong> ${escapeHtml(invoice.client.specialTerms)}</div>` : ""}
    ${summary.notes ? `<section class="notes-card"><p class="label">Notes</p><div class="notes-copy">${escapeHtml(summary.notes)}</div></section>` : ""}
    <footer class="cover-footer"><div class="footer-block"><p class="label">Service provider</p><strong>${escapeHtml(invoice.provider.providerName)}</strong><div class="footer-copy">${escapeHtml(invoice.provider.address)}${invoice.provider.email ? `\n${escapeHtml(invoice.provider.email)}` : ""}</div><div class="footer-meta">${invoice.provider.website ? `<span>${escapeHtml(invoice.provider.website)}</span>` : ""}${invoice.provider.taxId ? `<span>Tax ID ${escapeHtml(invoice.provider.taxId)}</span>` : ""}</div></div><div class="footer-block"><p class="label">Payment instructions · ${escapeHtml(paymentMethodLabel(invoice.client.paymentMethod))}</p><strong>Use ${escapeHtml(invoiceNumber)} as the payment reference</strong><div class="footer-copy">${escapeHtml(paymentInstructions(invoice))}</div></div></footer>
  </div></section>`;
}

function renderActivityPage(invoice: InvoiceDraft | InvoiceRecord, commits: InvoiceDraft["activity"]["commits"], page: number): string {
  return `<section class="invoice-page activity-page"><div class="page-inner"><header class="activity-header"><div><div class="eyebrow">${escapeHtml(invoice.number || "Draft invoice")}</div><h1>Activity log</h1></div><div class="page-number">Page ${page}</div></header><p class="activity-intro">${escapeHtml(invoice.summary.activitySummary)} Commit links cover ${formatDate(invoice.periodStart, { month: "short", day: "numeric", year: "numeric" })} – ${formatDate(invoice.periodEnd, { month: "short", day: "numeric", year: "numeric" })}.</p><table class="activity-table"><thead><tr><th>Date</th><th>Commit</th><th>Changes</th></tr></thead><tbody>${commits.map((commit) => `<tr><td>${formatDate(commit.date, { month: "short", day: "numeric" })}</td><td class="message"><a href="${escapeAttribute(commit.url)}"><strong>${escapeHtml(commit.message)}</strong></a><div class="repo">${escapeHtml(commit.repo)} · ${escapeHtml(commit.author)}</div></td><td>+${commit.additions}<br>−${commit.deletions}<br><span class="muted">${commit.fileCount ?? commit.files.length} files</span></td></tr>`).join("")}</tbody></table><footer class="activity-footer"><span>${escapeHtml(invoice.provider.businessName)}</span><span>${escapeHtml(invoice.number || "Draft")}</span></footer></div></section>`;
}

function renderWorkSummaryPage(invoice: InvoiceDraft | InvoiceRecord): string {
  const timeline = invoice.summary.timeline.length ? invoice.summary.timeline : [{ period: "Period", title: "No timeline entries", detail: "No dated GitHub commits were available for this billing period.", commits: 0 }];
  return `<section class="invoice-page summary-page"><div class="page-inner"><header class="summary-header"><div><div class="eyebrow">${escapeHtml(invoice.number || "Draft invoice")}</div><h1>Work summary</h1></div><div class="page-number">Page 2</div></header><p class="summary-intro">${escapeHtml(invoice.summary.activitySummary)} The timeline below is built from dated GitHub activity so the sequence of work is easy to review.</p><div class="summary-metrics"><div class="summary-metric"><div class="eyebrow">Commits</div><strong>${invoice.activity.commits.length}</strong></div><div class="summary-metric"><div class="eyebrow">Files changed</div><strong>${invoice.activity.filesChanged}</strong></div><div class="summary-metric"><div class="eyebrow">Repositories</div><strong>${invoice.activity.repositories.length}</strong></div><div class="summary-metric"><div class="eyebrow">Contributors</div><strong>${invoice.activity.contributors.length}</strong></div></div><div class="timeline-heading"><h2>Timeline of work</h2><span>${formatDate(invoice.periodStart, { month: "short", day: "numeric", year: "numeric" })} – ${formatDate(invoice.periodEnd, { month: "short", day: "numeric", year: "numeric" })}</span></div><div class="timeline-list">${timeline.map((entry) => `<div class="timeline-row"><div class="timeline-period">${escapeHtml(entry.period)}</div><h3>${escapeHtml(entry.title)}</h3><div class="timeline-detail">${escapeHtml(entry.detail)}</div><div class="timeline-count">${entry.commits} commit${entry.commits === 1 ? "" : "s"}</div></div>`).join("")}</div><p class="timeline-note">The following page${invoice.activity.commits.length === 1 ? " contains the raw commit" : "s contain the raw commits"} used to create this summary.</p><footer class="activity-footer"><span>${escapeHtml(invoice.provider.businessName)}</span><span>${escapeHtml(invoice.number || "Draft")}</span></footer></div></section>`;
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function formatPricing(invoice: InvoiceDraft | InvoiceRecord): string {
  if (invoice.pricing.model === "hourly") {
    const hours = Number(invoice.pricing.hours || 0).toFixed(2).replace(/\.?0+$/, "");
    return `${hours} hrs × ${formatMoney(invoice.pricing.rateCents || 0, invoice.client.currency)}/hr`;
  }
  return formatMoney(invoice.pricing.amountCents, invoice.client.currency);
}

function formatTaxRate(rate: number): string {
  return Number(rate || 0).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function paymentMethodLabel(method: InvoiceDraft["client"]["paymentMethod"]): string {
  if (method === "etransfer") return "E-transfer";
  if (method === "alternative") return "Alternative";
  return "Wire transfer";
}

function paymentInstructions(invoice: InvoiceDraft | InvoiceRecord): string {
  if (invoice.client.paymentMethod === "etransfer") {
    return invoice.provider.email
      ? `Send the E-transfer to ${invoice.provider.email}.`
      : "E-transfer address available on request.";
  }
  if (invoice.client.paymentMethod === "wire") {
    return "Wire transfer details available on request.";
  }
  return invoice.provider.remittance || "Alternative payment instructions available on request.";
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" }): string {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
