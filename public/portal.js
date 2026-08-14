const state = {
  token: sessionStorage.getItem("gitvoice_portal_token") || "",
  clients: [],
  invoices: [],
  provider: {},
  selectedClient: null,
  openInvoiceId: null,
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", () => {
  bindPasswordToggles();
  $("#portalDashboardButton").addEventListener("click", () => { window.location.href = "/"; });
  $("#passwordForm").addEventListener("submit", authenticate);
  $("#backButton").addEventListener("click", showClientStep);
  $("#portalSignOut").addEventListener("click", signOut);
  $("#invoiceModalClose").addEventListener("click", closeInvoiceModal);
  $("#invoiceModal").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeInvoiceModal(); });
  $("#portalDisputeButton").addEventListener("click", showDisputeForm);
  $("#disputeCancel").addEventListener("click", hideDisputeForm);
  $("#disputeForm").addEventListener("submit", submitDispute);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#invoiceModal").classList.contains("hidden")) closeInvoiceModal(); });
  loadClients();
  if (state.token) loadInvoices();
});

async function loadClients() {
  try {
    const data = await api("/api/portal/clients", { auth: false });
    state.clients = data.clients || [];
    state.provider = data.provider || {};
    applyProviderBrand();
    renderClients();
  } catch (error) {
    $("#clientError").textContent = error.message || "Could not load the client list.";
  }
}

function applyProviderBrand() {
  const businessName = state.provider?.businessName || "Gitvoice";
  const logoUrl = state.provider?.logoUrl || "";
  const brandName = $("#portalBrandName");
  if (brandName) brandName.textContent = businessName;
  const hint = $("#portalProviderHint");
  if (hint) hint.textContent = `Use the password shared with you by ${businessName}.`;
  const logo = document.querySelector(".portal-logo");
  if (logo) {
    if (logoUrl) { logo.src = logoUrl; logo.classList.add("has-custom-logo"); }
    else { logo.src = "/logo-white.svg"; logo.classList.remove("has-custom-logo"); }
  }
}

function renderClients() {
  const root = $("#clientList");
  if (!state.clients.length) {
    const businessName = state.provider?.businessName || "Gitvoice";
    root.innerHTML = `<div class="portal-empty"><span>—</span><p>Your client portal is being prepared. Ask ${esc(businessName)} for your access link.</p></div>`;
    return;
  }
  root.innerHTML = state.clients.map((client) => `<button class="portal-client" type="button" data-client-id="${esc(client.id)}"><span><strong>${esc(client.name)}</strong><small>View your invoice archive</small></span><span class="portal-client-arrow">↗</span></button>`).join("");
  root.querySelectorAll("[data-client-id]").forEach((button) => button.addEventListener("click", () => chooseClient(button.dataset.clientId)));
}

function chooseClient(id) {
  state.selectedClient = state.clients.find((client) => client.id === id) || null;
  if (!state.selectedClient) return;
  $("#selectedClientName").textContent = state.selectedClient.name;
  $("#clientPassword").value = "";
  $("#passwordError").textContent = "";
  $("#clientStep").classList.add("hidden");
  $("#passwordStep").classList.remove("hidden");
  window.setTimeout(() => $("#clientPassword").focus(), 0);
}

async function authenticate(event) {
  event.preventDefault();
  if (!state.selectedClient) return;
  const button = event.submitter;
  setBusy(button, true, "Checking access…");
  $("#passwordError").textContent = "";
  try {
    const data = await api("/api/portal/auth", { method: "POST", auth: false, body: { clientId: state.selectedClient.id, password: $("#clientPassword").value } });
    state.token = data.token;
    sessionStorage.setItem("gitvoice_portal_token", state.token);
    await loadInvoices();
  } catch (error) {
    $("#passwordError").textContent = error.message === "Request failed (401)" || error.message === "Incorrect client password" ? "That password does not match. Try again." : error.message || "Could not verify access.";
  } finally {
    setBusy(button, false, "Show my invoices ↗");
  }
}

async function loadInvoices() {
  try {
    const data = await api("/api/portal/invoices");
    state.invoices = data.invoices || [];
    $("#invoiceClientName").textContent = data.client?.name ? `${data.client.name} · invoices` : "Your invoices";
    renderInvoices(state.invoices);
    $("#clientStep").classList.add("hidden");
    $("#passwordStep").classList.add("hidden");
    $("#invoiceStep").classList.remove("hidden");
  } catch (error) {
    if (error.message === "Request failed (401)") signOut();
    else $("#invoiceError").textContent = error.message || "Could not load invoices.";
  }
}

function renderInvoices(invoices) {
  const root = $("#invoiceList");
  if (!invoices.length) {
    root.innerHTML = `<div class="portal-empty"><span>—</span><p>No invoices have been issued yet.</p></div>`;
    return;
  }
  root.innerHTML = invoices.map((invoice) => `<article class="portal-invoice"><div class="portal-invoice-main"><div class="portal-invoice-number">${esc(invoice.number)}</div><h3>${esc(invoice.summary?.title || "Services provided")}</h3><p>${esc(invoice.summary?.activitySummary || "Activity summary unavailable.")}</p><small>${formatDate(invoice.periodStart)} — ${formatDate(invoice.periodEnd)}</small></div><div class="portal-invoice-side"><strong>${formatMoney(invoice.totalCents, invoice.currency)}</strong><div class="portal-invoice-actions"><button class="portal-invoice-view" type="button" data-open-invoice="${esc(invoice.id)}">View ↗</button></div>${invoice.dispute ? "<small class=\"portal-disputed\">Dispute submitted</small>" : ""}</div></article>`).join("");
  root.querySelectorAll("[data-open-invoice]").forEach((button) => button.addEventListener("click", () => openInvoiceModal(button.dataset.openInvoice)));
}

function openInvoiceModal(id) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice) return;
  state.openInvoiceId = id;
  const url = `/portal/invoices/${encodeURIComponent(id)}?token=${encodeURIComponent(state.token)}`;
  const pdfUrl = `/portal/invoices/${encodeURIComponent(id)}/pdf?token=${encodeURIComponent(state.token)}`;
  $("#invoiceModalTitle").textContent = invoice.number;
  $("#invoiceModalMeta").textContent = `${state.selectedClient?.name || "Invoice"} · ${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`;
  $("#invoiceFullPage").href = url;
  $("#invoiceDownload").href = pdfUrl;
  $("#invoiceFrame").src = url;
  $("#disputeReason").value = "";
  $("#disputeError").textContent = "";
  renderDisputeState(invoice);
  $("#invoiceModal").classList.remove("hidden");
  document.body.classList.add("portal-modal-open");
  $("#invoiceModalClose").focus();
}

function closeInvoiceModal() {
  state.openInvoiceId = null;
  $("#invoiceModal").classList.add("hidden");
  $("#invoiceFrame").src = "about:blank";
  hideDisputeForm();
  document.body.classList.remove("portal-modal-open");
}

function renderDisputeState(invoice) {
  const disputed = Boolean(invoice.dispute);
  $("#portalDisputeButton").disabled = disputed;
  $("#portalDisputeButton").textContent = disputed ? "Dispute submitted" : "Dispute invoice";
  $("#disputeNote").textContent = disputed ? "Your dispute has been sent for review." : "See something that needs correcting? Let us know.";
  $("#disputePrompt").classList.remove("hidden");
  $("#disputeForm").classList.add("hidden");
}

function showDisputeForm() {
  $("#disputePrompt").classList.add("hidden");
  $("#disputeForm").classList.remove("hidden");
  $("#disputeReason").focus();
}

function hideDisputeForm() {
  $("#disputePrompt").classList.remove("hidden");
  $("#disputeForm").classList.add("hidden");
  $("#disputeError").textContent = "";
}

async function submitDispute(event) {
  event.preventDefault();
  if (!state.openInvoiceId) return;
  const button = event.submitter;
  setBusy(button, true, "Sending…");
  $("#disputeError").textContent = "";
  try {
    const data = await api(`/portal/invoices/${encodeURIComponent(state.openInvoiceId)}/dispute`, { method: "POST", body: { reason: $("#disputeReason").value.trim() } });
    const invoice = state.invoices.find((item) => item.id === state.openInvoiceId);
    if (invoice) invoice.dispute = data.dispute;
    if (invoice) renderDisputeState(invoice);
    renderInvoices(state.invoices);
  } catch (error) {
    $("#disputeError").textContent = error.message || "Could not submit the dispute.";
  } finally {
    if (button?.isConnected) setBusy(button, false, "Send dispute");
  }
}

function showClientStep() {
  state.selectedClient = null;
  $("#passwordStep").classList.add("hidden");
  $("#invoiceStep").classList.add("hidden");
  $("#clientStep").classList.remove("hidden");
}

function signOut() {
  closeInvoiceModal();
  state.token = "";
  state.selectedClient = null;
  sessionStorage.removeItem("gitvoice_portal_token");
  $("#clientPassword").type = "password";
  resetPasswordToggle("clientPassword");
  showClientStep();
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}) };
  if (options.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function setBusy(button, busy, label) { button.disabled = busy; button.textContent = label; }
function bindPasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    setPasswordToggleIcon(button, visible);
    button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} client password`);
    button.setAttribute("aria-pressed", String(visible));
  }));
}

function resetPasswordToggle(id) {
  const button = document.querySelector(`[data-password-toggle="${id}"]`);
  if (!button) return;
  setPasswordToggleIcon(button, false);
  button.setAttribute("aria-label", "Show client password");
  button.setAttribute("aria-pressed", "false");
}

function setPasswordToggleIcon(button, visible) {
  const icon = document.createElement("span");
  icon.className = "password-eye";
  icon.setAttribute("aria-hidden", "true");
  button.replaceChildren(icon);
  button.setAttribute("aria-pressed", String(visible));
}
function formatMoney(cents, currency) { try { return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format((Number(cents) || 0) / 100); } catch { return `${currency} ${((Number(cents) || 0) / 100).toFixed(2)}`; } }
function formatDate(value) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character); }
