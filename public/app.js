function getStoredToken(){
  try{ const v=localStorage.getItem("gitvoice_token"); if(v) return v; }catch{}
  try{ const v=sessionStorage.getItem("gitvoice_token"); if(v){ try{ localStorage.setItem("gitvoice_token",v);}catch{} return v; }}catch{}
  return "";
}
function setStoredToken(v){ try{ localStorage.setItem("gitvoice_token",v);}catch{} try{ sessionStorage.setItem("gitvoice_token",v);}catch{} }
function clearStoredToken(){ try{ localStorage.removeItem("gitvoice_token");}catch{} try{ sessionStorage.removeItem("gitvoice_token");}catch{} }
const state = { token: getStoredToken(), status: null, mode: "login", setup: null, recoveryCode: "", clients: [], provider: null, invoices: [], preview: null, previewKey: "", previewRequest: null, source: "github", openInvoiceId: null };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const DEFAULT_LOGO = "/logo-white.svg";

document.addEventListener("DOMContentLoaded", () => {
  initStyledSelects();
  initDatePickers();
  initPreviewEditor();
  bindPasswordToggles();
  bindEvents();
  setDefaultPeriod();
  initAuth();
});

function bindEvents() {
  $("#authForm").addEventListener("submit", authenticate);
  $("#recoverLink").addEventListener("click", openRecoverModal);
  $("#recoverForm").addEventListener("submit", recoverAccess);
  if($("#resetLink")) $("#resetLink").addEventListener("click", openResetModal);
  if($("#resetForm")) $("#resetForm").addEventListener("submit", resetAccess);
  if($("#resetDoneButton")) $("#resetDoneButton").addEventListener("click", () => { closeModal("resetModal"); renderAuthScreen(state.status || {}); });
  $("#recoverDoneButton").addEventListener("click", () => { closeModal("recoverModal"); renderAuthScreen(state.status || {}); });
  $("#setupForm").addEventListener("submit", handleSetupSubmit);
  $("#setupBack").addEventListener("click", () => stepSetup(-1));
  $("#signOutButton").addEventListener("click", () => { clearStoredToken(); state.token = ""; state.status = null; initAuth(); });
  $("#generatorForm").addEventListener("submit", preview);
  $("#previewForm").addEventListener("submit", (event) => { event.preventDefault(); generateInvoice(); });
  $("#generatorClient").addEventListener("change", selectGeneratorClient);
  $("#statPeriod").addEventListener("change", updateStats);
  $("#createButton").addEventListener("click", generateInvoice);
  $("#newClientButton").addEventListener("click", () => openClientModal());
  $("#clientForm").addEventListener("submit", saveClient);
  $("#settingsButton").addEventListener("click", openSettingsModal);
  $("#settingsForm").addEventListener("submit", saveSettings);
  $("#brandLogoButton").addEventListener("click", openBrandModal);
  $("#brandForm").addEventListener("submit", saveBrandLogo);
  $("#brandRemoveButton").addEventListener("click", removeBrandLogo);
  if($("#bulkButton")) $("#bulkButton").addEventListener("click", openBulkModal);
  if($("#bulkForm")) $("#bulkForm").addEventListener("submit", submitBulk);
  if($("#discoverButton")) $("#discoverButton").addEventListener("click", openDiscoverModal);
  if($("#discoverForm")) $("#discoverForm").addEventListener("submit", submitDiscover);
  if($("#timeImportButton")) $("#timeImportButton").addEventListener("click", openTimeModal);
  if($("#timeForm")) $("#timeForm").addEventListener("submit", submitTime);
  if($("#invoiceEditForm")) $("#invoiceEditForm").addEventListener("submit", submitInvoiceEdit);
  if($("#operatorForm")) $("#operatorForm").addEventListener("submit", createOperatorSubmit);
  if($("#newOperatorButton")) $("#newOperatorButton").addEventListener("click", () => { $("#operatorModal").classList.remove("hidden"); $("#operatorName").focus(); });
  if($("#clientSearchButton")) $("#clientSearchButton").addEventListener("click", ()=>{ document.getElementById("clientSearchModal")?.classList.remove("hidden"); setTimeout(()=> document.getElementById("clientSearch")?.focus(), 0); updateSearchPreview(); });
  if($("#invoiceSearchButton")) $("#invoiceSearchButton").addEventListener("click", ()=>{ document.getElementById("invoiceSearchModal")?.classList.remove("hidden"); setTimeout(()=> document.getElementById("invoiceSearch")?.focus(), 0); updateSearchPreview(); });
  if($("#revenueButton")) $("#revenueButton").addEventListener("click", openRevenueModal);
  if($("#clientSearch")) { $("#clientSearch").addEventListener("input", ()=>{ const v=$("#clientSearch").value; const c=document.querySelector("[data-clear=\"clientSearch\"]"); if(c) c.classList.toggle("hidden", !v); renderClients(); }); }
  if($("#invoiceSearch")) { $("#invoiceSearch").addEventListener("input", ()=>{ const v=$("#invoiceSearch").value; const c=document.querySelector("[data-clear=\"invoiceSearch\"]"); if(c) c.classList.toggle("hidden", !v); renderInvoices(); }); }
  if($("#invoiceStatusFilter")) $("#invoiceStatusFilter").addEventListener("change", ()=>{ renderInvoices(); updateSearchPreview(); });
  document.querySelectorAll("[data-clear]").forEach(btn=> btn.addEventListener("click", ()=>{ const id=btn.dataset.clear; const el=document.getElementById(id); if(el){ el.value=""; el.dispatchEvent(new Event("input")); btn.classList.add("hidden"); } }));
  if($("#changePasswordButton")) $("#changePasswordButton").addEventListener("click", openChangePasswordModal);
  if($("#changePasswordForm")) $("#changePasswordForm").addEventListener("submit", changePassword);
  if($("#changePasswordDoneButton")) $("#changePasswordDoneButton").addEventListener("click", () => { closeModal("changePasswordModal"); });
  $("#brandModal").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeBrandModal(); });
  bindLogoPreview($("#brandLogoUrl"), $("#brandPreviewImage"), setBrandPreviewStatus, { immediate: false });
  $("#invoiceDeleteButton").addEventListener("click", (event) => deleteInvoice(state.openInvoiceId, event.currentTarget));
  ["periodStart", "periodEnd", "invoiceAmount", "invoiceRate", "invoiceHours", "invoiceDescription", "manualDescription"].forEach((id) => $("#" + id).addEventListener("input", invalidatePreview));
  $$("[data-source]").forEach((button) => button.addEventListener("click", () => setSource(button.dataset.source)));
  $$('[data-close]').forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.close;
    if (id === "invoiceModal") closeInvoiceModal();
    else if (id === "brandModal") closeBrandModal();
    else closeModal(id);
  }));
  $$("[data-period]").forEach((button) => button.addEventListener("click", () => { setPeriod(button.dataset.period); invalidatePreview(); }));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#invoiceModal").classList.contains("hidden")) closeInvoiceModal();
    if (!$("#previewModal").classList.contains("hidden")) closePreviewModal();
    if (!$("#brandModal").classList.contains("hidden")) closeBrandModal();
  });
}

async function connect() {
  try {
    const data = await api("/api/bootstrap");
    setStoredToken(state.token);
    state.clients = data.clients || [];
    state.provider = data.provider || {};
    state.invoices = data.invoices || [];
    hideAuth();
    render();
    applyProviderBrand();
  } catch (error) {
    state.token = "";
    $("#authError").textContent = error.message === "Request failed (401)" ? "Session expired. Sign in again." : error.message || "Could not connect";
    renderAuthScreen(state.status || { onboarded: true, local: false });
  }
}

async function initAuth() {
  try {
    const status = await api("/api/status", { auth: false });
    state.status = status;
    if (state.token) {
      await connect();
      return;
    }
    renderAuthScreen(status);
  } catch (error) {
    state.status = null;
    showAuth();
  }
}

function renderAuthScreen(status) {
  const title = $("#authTitle");
  const subcopy = $("#authSubcopy");
  const field = $("#authField");
  const input = $("#tokenInput");
  const submit = $("#authSubmit");
  const recoverRow = $("#recoverLink").closest(".auth-hint");
  const resetRow = $("#resetLink") ? $("#resetLink").closest(".auth-hint") : null;
  $("#authError").textContent = "";
  input.value = "";
  field.classList.remove("hidden");
  input.autocomplete = "current-password";
  // Single form: accepts either admin password OR setup token — backend tries both
  if (!status.onboarded) {
    if (status.local) {
      state.mode = "local-setup";
      title.textContent = "Set up Gitvoice";
      subcopy.textContent = "Finish a quick setup to start invoicing.";
      field.classList.add("hidden");
      submit.textContent = "Get started";
      if(recoverRow) recoverRow.classList.add("hidden");
      if(resetRow) resetRow.classList.add("hidden");
    } else {
      state.mode = "bootstrap";
      title.textContent = "Set up Gitvoice";
      subcopy.textContent = "Paste your setup token to create your admin password.";
      input.placeholder = "Setup token (ADMIN_TOKEN)";
      submit.textContent = "Continue";
      if(recoverRow) recoverRow.classList.add("hidden");
      if(resetRow) resetRow.classList.add("hidden");
    }
  } else {
    state.mode = "login";
    title.textContent = "Welcome back";
    subcopy.textContent = "Sign in — admin password or setup token both work.";
    input.placeholder = "Admin password or setup token";
    submit.textContent = "Sign in";
    if(recoverRow) recoverRow.classList.remove("hidden");
    if(resetRow) resetRow.classList.remove("hidden");
  }
  showAuth();
}

async function authenticate(event) {
  event.preventDefault();
  $("#authError").textContent = "";
  if (state.mode === "local-setup") { openSetup(); return; }
  const value = $("#tokenInput").value.trim();
  if (!value) {
    $("#authError").textContent = "Enter your password or setup token.";
    return;
  }
  const button = $("#authSubmit");
  const isBootstrap = state.mode === "bootstrap";
  setBusy(button, true, isBootstrap ? "Checking…" : "Signing in…");
  try {
    const data = await api("/api/auth", { method: "POST", auth: false, body: { password: value } });
    state.token = data.token;
    setStoredToken(state.token);
    if (data.requiresSetup) { openSetup(); }
    else { await connect(); }
  } catch (error) {
    const msg = error.message || "";
    if (msg.includes("401") || msg.includes("Unauthorized")) {
      $("#authError").textContent = isBootstrap ? "That setup token is not valid — check Cloudflare ADMIN_TOKEN." : "Incorrect password or token. Try your admin password, setup token, or Reset with setup token below.";
    } else {
      $("#authError").textContent = msg || "Could not sign in.";
    }
  } finally {
    setBusy(button, false, isBootstrap ? "Continue" : "Sign in");
  }
}

async function openSetup() {
  state.setup = { step: 1, password: "", provider: {}, client: {} };
  state.recoveryCode = "";
  if (state.token) {
    try {
      const data = await api("/api/bootstrap");
      state.setup.provider = data.provider || {};
    } catch (error) { /* prefill is best-effort */ }
  }
  $("#setupModal").classList.remove("hidden");
  $("#setupError").textContent = "";
  renderSetupStep();
}

function stepSetup(delta) {
  if (!state.setup) return;
  const next = state.setup.step + delta;
  if (next < 1 || next > 4) return;
  state.setup.step = next;
  $("#setupError").textContent = "";
  renderSetupStep();
}

function renderSetupStep() {
  const s = state.setup;
  const body = $("#setupBody");
  const title = $("#setupTitle");
  const next = $("#setupNext");
  const back = $("#setupBack");
  $$(".setup-progress-step").forEach((el) => el.classList.toggle("active", Number(el.dataset.setupStep) <= s.step));
  back.classList.toggle("hidden", s.step === 1 || s.step === 4);

  if (s.step === 1) {
    title.textContent = "Create your admin login";
    next.textContent = "Continue";
    body.innerHTML = `<p class="modal-description">Choose a password for your workspace. You'll get a one-time recovery code on the next screen.</p><label class="field"><span>Admin password</span><div class="secret-input"><input id="setupPassword" type="password" autocomplete="new-password" placeholder="At least 8 characters" /></div></label><label class="field"><span>Confirm password</span><div class="secret-input"><input id="setupConfirm" type="password" autocomplete="new-password" placeholder="Repeat your password" /></div></label>`;
  } else if (s.step === 2) {
    title.textContent = "Your business";
    next.textContent = "Continue";
    const p = s.provider || {};
    body.innerHTML = `<p class="modal-description">These details appear on your invoices and client portal. You can change them later.</p><label class="field"><span>Business or brand</span><input id="setupBusiness" value="${esc(p.businessName || "")}" placeholder="Acme Inc." /></label><label class="field"><span>Provider name</span><input id="setupProviderName" value="${esc(p.providerName || "")}" placeholder="Your name" /></label><label class="field"><span>Address</span><textarea id="setupAddress" rows="3">${esc(p.address || "")}</textarea></label><div class="field-row"><label class="field"><span>Email</span><input id="setupEmail" type="email" value="${esc(p.email || "")}" /></label><label class="field"><span>Website</span><input id="setupWebsite" value="${esc(p.website || "")}" /></label></div><div class="field"><span>Logo URL <small>Optional</small></span><div class="logo-field-row"><span class="logo-thumb"><img id="setupLogoPreview" class="logo-preview" src="/logo-white.svg" alt="Logo preview" /></span><input id="setupLogo" type="url" inputmode="url" autocomplete="off" spellcheck="false" aria-label="Logo URL" value="${esc(p.logoUrl || "")}" placeholder="https://example.com/logo.svg" /></div><small>Leave blank to use the Gitvoice mark.</small></div><label class="field"><span>Tax ID <small>Optional</small></span><input id="setupTaxId" value="${esc(p.taxId || "")}" /></label><label class="field"><span>Alternative payment instructions <small>Optional</small></span><textarea id="setupRemittance" rows="3" placeholder="Optional payment link or instructions">${esc(p.remittance || "")}</textarea></label>`;
  } else if (s.step === 3) {
    title.textContent = "First client";
    next.textContent = "Finish setup";
    const c = s.client || {};
    const currencyOptions = ["USD", "CAD", "EUR", "GBP", "AUD"].map((cur) => `<option${cur === (c.currency || "USD") ? " selected" : ""}>${cur}</option>`).join("");
    body.innerHTML = `<p class="modal-description">Add your first client now, or skip and add one later.</p><label class="field"><span>Client or company</span><input id="setupClientName" value="${esc(c.name || "")}" placeholder="Acme Inc." /></label><label class="field"><span>Billing email</span><input id="setupClientEmail" type="email" value="${esc(c.email || "")}" placeholder="billing@example.com" /></label><label class="field"><span>GitHub repositories</span><textarea id="setupClientRepos" rows="3" placeholder="https://github.com/owner/repository">${esc(c.repos || "")}</textarea></label><div class="field-row"><label class="field"><span>Billing model</span><select id="setupClientModel"><option value="flat"${c.model !== "hourly" ? " selected" : ""}>Flat fee</option><option value="hourly"${c.model === "hourly" ? " selected" : ""}>Hourly</option></select></label><label class="field"><span>Currency</span><select id="setupClientCurrency">${currencyOptions}</select></label></div>`;
  } else if (s.step === 4) {
    title.textContent = "You're all set";
    next.textContent = "Go to workspace";
    body.innerHTML = `<p class="modal-description">Save this recovery code somewhere safe. It's the only way to reset your password.</p><div class="recovery-code">${esc(state.recoveryCode)}</div><p class="auth-hint">You won't see this code again.</p>`;
  }

  if (s.step === 2) bindLogoPreview($("#setupLogo"), $("#setupLogoPreview"));
}

function handleSetupSubmit(event) {
  event.preventDefault();
  const s = state.setup;
  if (!s) return;
  $("#setupError").textContent = "";
  if (s.step === 1) {
    const password = $("#setupPassword").value;
    const confirm = $("#setupConfirm").value;
    if (password.length < 8) { $("#setupError").textContent = "Password must be at least 8 characters."; return; }
    if (password !== confirm) { $("#setupError").textContent = "Passwords do not match."; return; }
    s.password = password;
    s.step = 2;
    renderSetupStep();
  } else if (s.step === 2) {
    s.provider = {
      businessName: $("#setupBusiness").value.trim(),
      providerName: $("#setupProviderName").value.trim(),
      address: $("#setupAddress").value.trim(),
      email: $("#setupEmail").value.trim(),
      website: $("#setupWebsite").value.trim(),
      logoUrl: $("#setupLogo").value.trim(),
      taxId: $("#setupTaxId").value.trim(),
      remittance: $("#setupRemittance").value.trim(),
    };
    if (!s.provider.businessName) { $("#setupError").textContent = "Business name is required."; return; }
    s.step = 3;
    renderSetupStep();
  } else if (s.step === 3) {
    s.client = {
      name: $("#setupClientName").value.trim(),
      email: $("#setupClientEmail").value.trim(),
      repos: $("#setupClientRepos").value.trim(),
      model: $("#setupClientModel").value,
      currency: $("#setupClientCurrency").value,
    };
    finishSetup();
  } else if (s.step === 4) {
    closeSetupModal();
  }
}

async function finishSetup() {
  const s = state.setup;
  const button = $("#setupNext");
  setBusy(button, true, "Saving…");
  try {
    const data = await api("/api/setup", { method: "POST", body: { password: s.password, provider: s.provider } });
    state.token = data.token;
    setStoredToken(state.token);
    state.provider = data.provider;
    state.recoveryCode = data.recoveryCode;
    if (s.client && s.client.name) {
      try {
        await api("/api/clients", { method: "POST", body: { name: s.client.name, email: s.client.email, address: "", githubRepos: parseGithubRepositories(s.client.repos), githubAuthor: "", projectContext: "", summaryPriorities: "", currency: s.client.currency, billingModel: s.client.model, defaultRateCents: 0, taxRate: 0, cadence: "manual", paymentMethod: "wire", paymentDays: 0, paymentTerms: "Due on receipt", specialTerms: "", active: true } });
      } catch (error) { console.error("First client save failed", error); }
    }
    s.step = 4;
    renderSetupStep();
    button.disabled = false;
  } catch (error) {
    setBusy(button, false, "Finish setup");
    $("#setupError").textContent = error.message || "Could not complete setup.";
  }
}

function closeSetupModal() {
  $("#setupModal").classList.add("hidden");
  state.setup = null;
  connect();
}

function openRecoverModal() {
  $("#recoverCode").value = "";
  $("#recoverPassword").value = "";
  $("#recoverError").textContent = "";
  $("#recoverFields").classList.remove("hidden");
  $("#recoverDone").classList.add("hidden");
  $("#recoverModal").classList.remove("hidden");
  setTimeout(() => $("#recoverCode").focus(), 0);
}

async function recoverAccess(event) {
  event.preventDefault();
  const code = $("#recoverCode").value.trim();
  const password = $("#recoverPassword").value;
  if (!code) { $("#recoverError").textContent = "Enter your recovery code."; return; }
  if (password.length < 8) { $("#recoverError").textContent = "Password must be at least 8 characters."; return; }
  try {
    const data = await api("/api/auth/recover", { method: "POST", auth: false, body: { recoveryCode: code, password } });
    $("#recoverFields").classList.add("hidden");
    $("#recoverDone").classList.remove("hidden");
    $("#recoverNewCode").textContent = data.recoveryCode;
  } catch (error) {
    $("#recoverError").textContent = error.message || "Could not reset password.";
  }
}

function openResetModal(){
  $("#resetToken").value = "";
  $("#resetPassword").value = "";
  $("#resetConfirm").value = "";
  $("#resetError").textContent = "";
  $("#resetFields").classList.remove("hidden");
  $("#resetDone").classList.add("hidden");
  $("#resetModal").classList.remove("hidden");
  setTimeout(() => $("#resetToken").focus(), 0);
}
async function resetAccess(event){
  event.preventDefault();
  const token = $("#resetToken").value.trim();
  const password = $("#resetPassword").value;
  const confirm = $("#resetConfirm").value;
  if(!token){ $("#resetError").textContent = "Enter your setup token."; return; }
  if(password.length < 8){ $("#resetError").textContent = "Password must be at least 8 characters."; return; }
  if(password !== confirm){ $("#resetError").textContent = "Passwords do not match."; return; }
  $("#resetError").textContent = "";
  try{
    const data = await api("/api/auth/reset", { method: "POST", auth: false, body: { adminToken: token, password } });
    state.token = data.token || "";
    if(state.token) setStoredToken(state.token);
    $("#resetFields").classList.add("hidden");
    $("#resetDone").classList.remove("hidden");
    $("#resetNewCode").textContent = data.recoveryCode || "";
    if(state.token) setTimeout(()=> connect(), 800);
  }catch(error){
    $("#resetError").textContent = error.message || "Could not reset password.";
  }
}

function openChangePasswordModal(){
  $("#changePasswordCurrent").value = "";
  $("#changePasswordNew").value = "";
  $("#changePasswordConfirm").value = "";
  $("#changePasswordError").textContent = "";
  $("#changePasswordFields").classList.remove("hidden");
  $("#changePasswordDone").classList.add("hidden");
  $("#changePasswordModal").classList.remove("hidden");
  setTimeout(()=> $("#changePasswordNew").focus(), 0);
}
async function changePassword(event){
  event.preventDefault();
  const cur = $("#changePasswordCurrent") ? $("#changePasswordCurrent").value : "";
  const neu = $("#changePasswordNew").value;
  const conf = $("#changePasswordConfirm").value;
  if(neu.length < 8){ $("#changePasswordError").textContent = "New password must be at least 8 characters."; return; }
  if(neu !== conf){ $("#changePasswordError").textContent = "Passwords do not match."; return; }
  $("#changePasswordError").textContent = "";
  try{
    let data;
    try{
      data = await api("/api/auth/reset", { method: "POST", body: { password: neu } });
    } catch(e){
      if(String(e.message).includes("Unauthorized") && cur){
        data = await api("/api/auth/reset", { method: "POST", auth:false, body: { adminToken: cur, password: neu } });
      } else throw e;
    }
    $("#changePasswordFields").classList.add("hidden");
    $("#changePasswordDone").classList.remove("hidden");
    $("#changePasswordNewCode").textContent = data.recoveryCode || "";
    if(data.token){ state.token = data.token; setStoredToken(state.token); }
  }catch(error){
    $("#changePasswordError").textContent = error.message || "Could not change password.";
  }
}

// Switches the generator between GitHub-sourced invoices and manually described work.
function setSource(source) {
  const next = source === "manual" ? "manual" : "github";
  if (state.source === next) return;
  state.source = next;
  const manual = next === "manual";
  $$("[data-source]").forEach((button) => {
    const active = button.dataset.source === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#manualField").classList.toggle("hidden", !manual);
  $("#generatorHint").textContent = manual
    ? "Describe the work performed and we write the client-facing summary."
    : "Choose the client and exact billing period.";
  $("#pricingError").textContent = "";
  invalidatePreview();
  if (!state.preview) renderPreview(null);
}

async function preview(event) {
  event.preventDefault();
  const clientId = $("#generatorClient").value;
  if (!clientId) return toast("Choose a client first.");
  const manual = state.source === "manual";
  const description = $("#manualDescription").value.trim();
  if (manual && !description) {
    $("#pricingError").textContent = "Enter a description of the work performed.";
    return toast("Describe the work performed first.");
  }
  const pricing = readPricing();
  if (!pricing) return;
  const request = { clientId, periodStart: $("#periodStart").value, periodEnd: $("#periodEnd").value, pricing };
  if (manual) { request.source = "manual"; request.description = description; }
  const previewKey = JSON.stringify(request);
  if (state.preview && state.previewKey === previewKey) {
    $("#previewButton").textContent = "Edit summary";
    openPreviewModal();
    return;
  }
  setBusy($("#previewButton"), true, manual ? "Writing summary..." : "Reading GitHub...");
  $("#createButton").disabled = true;
  try {
    const data = await api("/api/preview", { method: "POST", body: request });
    const previousNotes = state.preview?.summary?.notes || "";
    state.preview = data.invoice;
    state.previewKey = previewKey;
    state.previewRequest = request;
    if (previousNotes) state.preview.summary.notes = previousNotes;
    renderPreview(data.invoice);
    openPreviewModal();
    $("#createButton").disabled = false;
    toast("Summary ready to review.");
  } catch (error) {
    toast(error.message || "Preview failed.");
  } finally {
    setBusy($("#previewButton"), false, "Edit summary");
  }
}

async function generateInvoice() {
  if (!state.preview) return;
  setBusy($("#createButton"), true, "Generating...");
  try {
    const body = { clientId: state.preview.client.id, periodStart: state.preview.periodStart, periodEnd: state.preview.periodEnd, pricing: state.preview.pricing, preview: { summary: state.preview.summary, activity: state.preview.activity } };
    if (state.previewRequest?.source === "manual") { body.source = "manual"; body.description = state.previewRequest.description; }
    const data = await api("/api/invoices", { method: "POST", body });
    const existingIndex = state.invoices.findIndex((invoice) => invoice.id === data.invoice?.id);
    if (existingIndex === -1) state.invoices.unshift(data.invoice); else state.invoices[existingIndex] = data.invoice;
    state.preview = null;
    state.previewKey = "";
    state.previewRequest = null;
    $("#createButton").disabled = true;
    renderPreview(null);
    renderInvoices();
    updateStats();
    toast(data.existing ? "That billing period already exists." : "Invoice generated and saved.");
    closePreviewModal();
    if (data.invoice?.id) openInvoiceModal(data.invoice.id);
  } catch (error) {
    toast(error.message || "Invoice generation failed.");
  } finally {
    setBusy($("#createButton"), false, "Generate invoice");
  }
}

function render() {
  renderClients();
  renderInvoices();
  updateStats();
  populateClientSelect();
}

function applyProviderBrand() {
  const logo = document.querySelector(".brand-logo");
  if (logo) applyLogoPreview(logo, state.provider?.logoUrl || "");
}

// Swaps an <img> between a custom logo URL and the bundled Gitvoice mark, falling
// back to the mark when the custom image cannot be loaded. `onStatus` receives
// "custom", "error", or "default".
function applyLogoPreview(image, url, onStatus) {
  const value = String(url || "").trim();
  image.onload = null;
  image.onerror = null;
  if (!value) {
    image.classList.remove("has-custom-logo");
    image.src = DEFAULT_LOGO;
    if (onStatus) onStatus("default");
    return;
  }
  image.onload = () => { image.onload = null; image.onerror = null; if (onStatus) onStatus("custom"); };
  image.onerror = () => {
    image.onload = null;
    image.onerror = null;
    image.classList.remove("has-custom-logo");
    image.src = DEFAULT_LOGO;
    if (onStatus) onStatus("error");
  };
  image.classList.add("has-custom-logo");
  image.src = value;
}

function bindLogoPreview(input, image, onStatus, options = {}) {
  if (!input || !image) return;
  let timer = 0;
  const update = () => applyLogoPreview(image, input.value, onStatus);
  input.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(update, 260); });
  input.addEventListener("change", () => { window.clearTimeout(timer); update(); });
  if (options.immediate !== false) update();
}

function setBrandPreviewStatus(status) {
  const label = $("#brandPreviewLabel");
  const note = $("#brandPreviewNote");
  note.classList.toggle("is-invalid", status === "error");
  if (status === "custom") {
    label.textContent = "Your logo";
    note.textContent = "Loaded from the URL below.";
  } else if (status === "error") {
    label.textContent = "Gitvoice mark";
    note.textContent = "That image could not be loaded. Check the URL and try again.";
  } else {
    label.textContent = "Gitvoice mark";
    note.textContent = "The bundled default is used until you add your own.";
  }
}

function openBrandModal() {
  const input = $("#brandLogoUrl");
  const saved = state.provider?.logoUrl || "";
  input.value = saved;
  $("#brandError").textContent = "";
  $("#brandRemoveButton").disabled = !saved;
  applyLogoPreview($("#brandPreviewImage"), saved, setBrandPreviewStatus);
  $("#brandModal").classList.remove("hidden");
  setTimeout(() => input.focus(), 0);
}

function closeBrandModal() {
  closeModal("brandModal");
  $("#brandError").textContent = "";
  const trigger = $("#brandLogoButton");
  if (trigger) trigger.focus();
}

function saveBrandLogo(event) {
  event.preventDefault();
  persistLogoUrl($("#brandLogoUrl").value.trim(), $("#brandSaveButton"), "Save", "Brand logo updated.");
}

function removeBrandLogo() {
  persistLogoUrl("", $("#brandRemoveButton"), "Remove", "Brand logo reset to the Gitvoice mark.");
}

async function persistLogoUrl(logoUrl, button, label, message) {
  $("#brandError").textContent = "";
  setBusy(button, true, "Saving…");
  try {
    const data = await api("/api/settings", { method: "PUT", body: { ...providerPayload(), logoUrl } });
    state.provider = data.provider;
    applyProviderBrand();
    const settingsField = $("#providerLogo");
    if (settingsField) settingsField.value = state.provider?.logoUrl || "";
    closeBrandModal();
    toast(message);
  } catch (error) {
    $("#brandError").textContent = error.message || "Could not save the brand logo.";
  } finally {
    setBusy(button, false, label);
  }
}

// The settings endpoint replaces the whole provider record, so every field has to
// be sent back even when only the logo changes.
function providerPayload() {
  const provider = state.provider || {};
  return {
    businessName: provider.businessName || "",
    logoUrl: provider.logoUrl || "",
    providerName: provider.providerName || "",
    address: provider.address || "",
    email: provider.email || "",
    website: provider.website || "",
    taxId: provider.taxId || "",
    remittance: provider.remittance || "",
  };
}

function renderClients() {
  const root = $("#clientList");
  const q = ($("#clientSearch")?.value || "").trim().toLowerCase();
  const filtered = q ? state.clients.filter(c => `${c.name} ${contactName(c)} ${c.email} ${c.phone || ""} ${c.githubRepos.join(" ")} ${c.billingModel}`.toLowerCase().includes(q)) : state.clients;
  $("#clientCount").textContent = `${filtered.length} client${filtered.length === 1 ? "" : "s"}${q?` / ${state.clients.length}`:""}`;
  if (!filtered.length) {
    root.innerHTML = q ? `<div class="empty-state"><span>∅</span><p>No clients match “${esc(q)}”.</p></div>` : `<div class="empty-state"><span>+</span><p>Add your first client to start.</p></div>`;
    return;
  }
  const _origClients = state.clients; state.clients = filtered;
  root.innerHTML = filtered.map((client) => `<article class="client-row"><div><p class="client-name">${esc(client.name)}</p><div class="client-meta">${contactName(client) ? `<span>${esc(contactName(client))}</span>` : ""}<span><i class="cadence-dot ${client.cadence === "manual" ? "manual" : ""}"></i>${esc(client.cadence)}</span><span>${client.githubRepos.length} repo${client.githubRepos.length === 1 ? "" : "s"}</span><span>${esc(client.billingModel === "hourly" ? "Hourly" : "Flat fee")}</span><span>${esc(paymentMethodLabel(client.paymentMethod))}</span><span>${client.portalPasswordSet ? "Portal ready" : "Portal password needed"}</span></div></div><div class="client-actions"><button data-edit-client="${esc(client.id)}">Edit</button><button data-delete-client="${esc(client.id)}">Remove</button></div></article>`).join("");
  state.clients = _origClients;
  $$('[data-edit-client]').forEach((button) => button.addEventListener("click", () => openClientModal(state.clients.find((client) => client.id === button.dataset.editClient))));
  $$('[data-delete-client]').forEach((button) => button.addEventListener("click", () => removeClient(button.dataset.deleteClient)));
}

function renderInvoices() {
  const root = $("#invoiceList");
  const q = ($("#invoiceSearch")?.value || "").trim().toLowerCase();
  const statusFilter = $("#invoiceStatusFilter")?.value || "";
  let filtered = state.invoices;
  if (q) filtered = filtered.filter(inv => `${inv.number} ${inv.client.name} ${inv.periodStart} ${inv.status}`.toLowerCase().includes(q));
  if (statusFilter) {
    if (statusFilter === "disputed") filtered = filtered.filter(inv => !!inv.dispute);
    else filtered = filtered.filter(inv => inv.status === statusFilter);
  }
  $("#archiveCount").textContent = `${filtered.length} invoice${filtered.length === 1 ? "" : "s"}${(q||statusFilter)?` / ${state.invoices.length}`:""}`;
  if (!filtered.length) {
    if (q || statusFilter) { root.innerHTML = `<div class="empty-state"><span>∅</span><p>No invoices match.</p></div>`; return; }
    root.innerHTML = `<div class="empty-state"><span>⌁</span><p>Generated invoices will land here.</p></div>`;
    return;
  }
  root.innerHTML = filtered.slice(0, 12).map((invoice) => {
    const isVoid = invoice.status === 'void';
    const versionBadge = invoice.version && invoice.version > 1 ? `<span class="muted" style="font-size:11px">v${invoice.version}</span>` : '';
    return `<article class="invoice-row"><div><div class="invoice-number">${esc(invoice.number)} ${versionBadge}</div><div class="invoice-client">${esc(invoice.client.name)}</div></div><div class="invoice-period">${formatDate(invoice.periodStart)} - ${formatDate(invoice.periodEnd)}</div><div><div class="invoice-total">${formatMoney(invoice.totalCents, invoice.currency)}</div><div class="invoice-status ${invoice.dispute ? "invoice-status-disputed" : (isVoid?"invoice-status-void":"")}">${isVoid ? "Void" : invoice.dispute ? "Disputed" : esc(invoice.status || "generated")}</div></div><div class="invoice-actions" style="flex-wrap:wrap;gap:6px"><button class="invoice-open" type="button" data-open-invoice="${esc(invoice.id)}">View</button><button type="button" data-edit-invoice="${esc(invoice.id)}">Edit</button><button type="button" data-versions-invoice="${esc(invoice.id)}">Versions</button>${isVoid ? `<button type="button" data-reissue-invoice="${esc(invoice.id)}">Reissue</button>` : `<button type="button" data-void-invoice="${esc(invoice.id)}">Void</button>`}<button type="button" data-notify-invoice="${esc(invoice.id)}" title="Email via Cloudflare Email beta">Notify</button><a class="invoice-download" href="/api/invoices/${encodeURIComponent(invoice.id)}/pdf?token=${encodeURIComponent(state.token)}" download>PDF ↓</a><button class="invoice-delete" type="button" data-delete-invoice="${esc(invoice.id)}" aria-label="Delete ${esc(invoice.number)}">Delete</button></div></article>`;
  }).join("");
  $$('[data-open-invoice]').forEach((button) => button.addEventListener("click", () => openInvoiceModal(button.dataset.openInvoice)));
  $$('[data-delete-invoice]').forEach((button) => button.addEventListener("click", () => deleteInvoice(button.dataset.deleteInvoice, button)));
  $$('[data-void-invoice]').forEach((button) => button.addEventListener("click", () => voidInvoiceAction(button.dataset.voidInvoice)));
  $$('[data-reissue-invoice]').forEach((button) => button.addEventListener("click", () => reissueInvoiceAction(button.dataset.reissueInvoice)));
  $$('[data-edit-invoice]').forEach((button) => button.addEventListener("click", () => openInvoiceEditModal(button.dataset.editInvoice)));
  $$('[data-versions-invoice]').forEach((button) => button.addEventListener("click", () => openVersionsModal(button.dataset.versionsInvoice)));
  $$('[data-notify-invoice]').forEach((button) => button.addEventListener("click", () => notifyInvoice(button.dataset.notifyInvoice, button)));
}



function renderSparkline(){
  const el=document.getElementById("revenueSparkline");
  const label=document.getElementById("revenueLabel");
  const invoices=[...state.invoices].filter(i=>i.status!=="void");
  if(!invoices.length){
    if(el) el.innerHTML='<span class="muted" style="font-size:11px">No revenue yet</span>';
    if(label) label.textContent="—";
    const mb=document.getElementById("revenueChartBars"); if(mb) mb.innerHTML='<span class="muted">No revenue yet</span>';
    const mt=document.getElementById("revenueChartTable"); if(mt) mt.innerHTML="";
    return;
  }
  const now=new Date(); const months=[];
  for(let i=5;i>=0;i--){ const d=new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-i, 1)); months.push({key:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`, label: d.toLocaleDateString('en-US',{month:'short', year:'2-digit'}), total:0}); }
  // For small tag, we just need total, not full sparkline
  // Multi-currency aware totals
  const byCur = new Map();
  for(const inv of invoices){ byCur.set(inv.currency, (byCur.get(inv.currency)||0)+Number(inv.totalCents||0)); }
  const primaryCur = [...byCur.entries()].sort((a,b)=> b[1]-a[1])[0]?.[0] || "CAD";
  const total6 = (()=>{ const m=new Map(months.map(x=>[x.key,{...x}])); for(const inv of invoices){ if(inv.currency!==primaryCur) continue; const k=(inv.issuedAt||"").slice(0,7); const mm=m.get(k); if(mm) mm.total+=Number(inv.totalCents||0); } return [...m.values()].reduce((s,x)=>s+x.total,0); })();
  if(label){
    if(byCur.size>1){
      const parts=[...byCur.entries()].sort((a,b)=>b[1]-a[1]).map(([cur, tot])=> formatMoney(tot, cur)).join(" + ");
      label.textContent = parts;
      label.title = `Primary ${primaryCur} 6mo: ${formatMoney(total6, primaryCur)}`;
    } else {
      label.textContent = total6 ? formatMoney(total6, primaryCur) : "—";
    }
  }
  // Render modal chart if present
  const modalBars=document.getElementById("revenueChartBars");
  const modalTable=document.getElementById("revenueChartTable");
  if(modalBars){
    // Build per-currency maps for modal
    const curTotals = new Map();
    for(const inv of invoices){ curTotals.set(inv.currency, (curTotals.get(inv.currency)||0)+Number(inv.totalCents||0)); }
    const primary = [...curTotals.entries()].sort((a,b)=> b[1]-a[1])[0]?.[0] || primaryCur;
    const map=new Map(months.map(m=>[m.key,{...m, total:0, byCur: new Map()}]));
    for(const inv of invoices){ const k=(inv.issuedAt||"").slice(0,7); const mm=map.get(k); if(mm){ mm.total+=Number(inv.totalCents||0); mm.byCur.set(inv.currency, (mm.byCur.get(inv.currency)||0)+Number(inv.totalCents||0)); } }
    const max=Math.max(...[...map.values()].map(m=>m.total),1);
    modalBars.innerHTML=[...map.values()].map(m=> {
      const h = Math.max(8, Math.round((m.total/max)*100));
      const bg = m.total ? "linear-gradient(180deg, #3b82f6, #1d4ed8)" : "rgba(255,255,255,0.08)";
      const tooltip = [...m.byCur.entries()].map(([c,tot])=> `${c} ${formatMoney(tot,c)}`).join(" + ") || formatMoney(0, primary);
      return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:0">
        <div title="${m.key}: ${tooltip}" style="width:100%; height:${h}px; background:${bg}; border-radius:6px; min-height:8px; border:1px solid ${m.total? "rgba(59,130,246,0.3)":"rgba(255,255,255,0.06)"}"></div>
        <span style="font-size:11px; color:var(--muted)">${m.label}</span>
        <span style="font-size:11px; font-weight:600; white-space:nowrap">${m.total ? [...m.byCur.entries()].map(([c,tot])=> formatMoney(tot,c)).join(" + ") : formatMoney(0, primary)}</span>
      </div>`;
    }).join("");
    if(modalTable){
      const revMonths=[...map.values()].slice().reverse();
      // Header per currency if multi
      if(curTotals.size>1){
        const curList=[...curTotals.keys()].sort();
        // Update table header to show per-currency columns
        const thead = modalTable.closest("table")?.querySelector("thead");
        if(thead) thead.innerHTML=`<tr><th>Month</th>${curList.map(c=>`<th style="text-align:right">${c}</th>`).join("")}<th style="text-align:right">Total</th></tr>`;
        modalTable.innerHTML=revMonths.map(m=> `<tr><td>${m.label}</td>${curList.map(c=> `<td style="text-align:right; font-variant-numeric:tabular-nums">${m.byCur.get(c)? formatMoney(m.byCur.get(c)||0,c) : "—"}</td>`).join("")}<td style="text-align:right; font-weight:600; font-variant-numeric:tabular-nums">${formatMoney(m.total, primary)}</td></tr>`).join("");
      } else {
        modalTable.innerHTML=revMonths.map(m=> `<tr><td>${m.label}</td><td style="text-align:right; font-variant-numeric:tabular-nums">${formatMoney(m.total, primary)}</td></tr>`).join("");
      }
    }
  }
  // Small sparkline no longer in DOM, so nothing to render there
}
function openRevenueModal(){ renderSparkline(); document.getElementById("revenueModal")?.classList.remove("hidden"); }


function updateSearchPreview(){
  const cq = ($("#clientSearch")?.value || "").trim().toLowerCase();
  const cRes = document.getElementById("clientSearchResults");
  if(cRes){
    if(!cq){ cRes.style.display="none"; cRes.innerHTML=""; }
    else {
      const filtered = state.clients.filter(c => `${c.name} ${c.email} ${c.githubRepos.join(" ")} ${c.billingModel}`.toLowerCase().includes(cq));
      cRes.style.display="block";
      cRes.innerHTML = filtered.length ? filtered.slice(0,8).map(c=> `<div style="padding:8px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><span><strong>${esc(c.name)}</strong><br/><span class="muted" style="font-size:12px">${esc(c.email)} · ${c.githubRepos.length} repos</span></span><button class="button button-secondary" style="font-size:12px;padding:4px 8px" data-id="${c.id}">Edit</button></div>`).join("") : `<div style="padding:12px" class="muted">No clients match “${esc(cq)}”.</div>`;
      // Fix the onclick to work: we need to actually bind after rendering
      setTimeout(()=>{ cRes.querySelectorAll("button[data-id]").forEach(btn=> btn.onclick=()=>{ const c=state.clients.find(x=>x.id===btn.dataset.id); if(c){ closeModal("clientSearchModal"); openClientModal(c); } }); },0);
    }
  }
  const iq = ($("#invoiceSearch")?.value || "").trim().toLowerCase();
  const statusFilter = $("#invoiceStatusFilter")?.value || "";
  const iRes = document.getElementById("invoiceSearchResults");
  if(iRes){
    if(!iq && !statusFilter){ iRes.style.display="none"; iRes.innerHTML=""; }
    else {
      let filtered = state.invoices;
      if(iq) filtered = filtered.filter(inv => `${inv.number} ${inv.client.name} ${inv.periodStart} ${inv.status}`.toLowerCase().includes(iq));
      if(statusFilter){ if(statusFilter==="disputed") filtered=filtered.filter(inv=>!!inv.dispute); else filtered=filtered.filter(inv=>inv.status===statusFilter); }
      iRes.style.display="block";
      iRes.innerHTML = filtered.length ? filtered.slice(0,8).map(inv=> `<div style="padding:8px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center"><span><strong>${esc(inv.number)}</strong> · ${esc(inv.client.name)}<br/><span class="muted" style="font-size:12px">${inv.periodStart} → ${inv.periodEnd} · ${esc(inv.status)}</span></span><button class="button button-secondary" style="font-size:12px;padding:4px 8px" data-id="${inv.id}">View</button></div>`).join("") : `<div style="padding:12px" class="muted">No invoices match.</div>`;
      setTimeout(()=>{ iRes.querySelectorAll("button[data-id]").forEach(btn=> btn.onclick=()=>{ closeModal("invoiceSearchModal"); openInvoiceModal(btn.dataset.id); }); },0);
    }
  }
}

function openBulkModal(){ $("#bulkJson").value=""; $("#bulkError").textContent=""; $("#bulkPreview").textContent=""; $("#bulkModal").classList.remove("hidden"); $("#bulkJson").focus(); }
async function submitBulk(event){
  event.preventDefault();
  let parsed; try{ parsed = JSON.parse($("#bulkJson").value); }catch(e){ $("#bulkError").textContent="Invalid JSON: "+e.message; return; }
  const clients = Array.isArray(parsed)? parsed : parsed.clients || [];
  if(!clients.length){ $("#bulkError").textContent="Provide a JSON array of clients."; return; }
  $("#bulkError").textContent="Importing…";
  try{
    const data = await api("/api/clients/bulk", {method:"POST", body:{clients}});
    $("#bulkError").textContent="";
    $("#bulkPreview").textContent = `Imported ${data.clients?.length||0}, errors ${data.errors?.length||0}` + (data.errors?.length? "\n"+JSON.stringify(data.errors,null,2):"");
    if(data.clients?.length){ await refreshClients(); toast(`Bulk imported ${data.clients.length}`); }
  }catch(e){ $("#bulkError").textContent=e.message||"Bulk failed"; }
}
function openDiscoverModal(){ $("#discoverQuery").value=""; $("#discoverResults").style.display="none"; $("#discoverResults").innerHTML=""; $("#discoverError").textContent=""; $("#discoverModal").classList.remove("hidden"); $("#discoverQuery").focus(); }
async function submitDiscover(event){
  event.preventDefault();
  const q=$("#discoverQuery").value.trim(); if(!q) return;
  $("#discoverError").textContent="Discovering…";
  try{
    const data = await api("/api/clients/discover", {method:"POST", body:{query:q}});
    const repos=data.repos||[];
    const el=$("#discoverResults"); el.style.display="block";
    if(!repos.length){ el.innerHTML=`<span class="muted">No repos found for "${esc(q)}"</span>`; }
    else {
      el.innerHTML = repos.slice(0,30).map(r=> `<label style="display:flex;gap:8px;padding:6px;border-bottom:1px solid var(--line);font-size:13px"><input type="checkbox" value="${esc(r)}" class="discover-check" /> ${esc(r)}</label>`).join("") + `<div style="margin-top:8px;display:flex;gap:8px"><button type="button" class="button button-primary" id="discoverAdd">Add selected to new client</button></div>`;
      $("#discoverAdd").onclick = async ()=>{
        const selected=[...el.querySelectorAll(".discover-check:checked")].map(c=>c.value);
        if(!selected.length){ toast("Select at least one repo"); return; }
        const name=prompt("Client name for "+selected.length+" repos:"); if(!name) return;
        try{ await api("/api/clients",{method:"POST", body:{name, email:"", address:"", githubRepos:selected, githubAuthor:"", currency:"USD", billingModel:"flat", paymentMethod:"wire", paymentTerms:"Due on receipt"}}); toast("Client created"); closeModal("discoverModal"); await refreshClients(); }catch(e){ toast(e.message); }
      };
    }
    $("#discoverError").textContent="";
  }catch(e){ $("#discoverError").textContent=e.message; }
}
function openTimeModal(){
  const clientId=$("#clientId").value;
  if(!clientId){ toast("Save client first"); return; }
  $("#timeJson").value='[{"date":"'+new Date().toISOString().slice(0,10)+'","hours":2,"description":"Work"}]';
  $("#timeError").textContent="";
  $("#timeModal").classList.remove("hidden");
}
async function submitTime(event){
  event.preventDefault();
  const clientId=$("#clientId").value; if(!clientId){ $("#timeError").textContent="No client"; return; }
  let entries; try{ entries=JSON.parse($("#timeJson").value); }catch(e){ $("#timeError").textContent="Invalid JSON"; return; }
  if(!Array.isArray(entries)) entries=entries.entries||[];
  try{ const data=await api(`/api/clients/${encodeURIComponent(clientId)}/time/import`,{method:"POST", body:{entries}}); toast(`Imported ${data.imported||0} entries`); closeModal("timeModal"); loadClientTime(clientId); }catch(e){ $("#timeError").textContent=e.message; }
}
async function voidInvoiceAction(id){
  if(!confirm("Void "+id+"?")) return;
  try{ await api(`/api/invoices/${encodeURIComponent(id)}/void`,{method:"POST"}); toast("Voided"); await refreshInvoices(); }catch(e){ toast(e.message); }
}
async function reissueInvoiceAction(id){
  try{ await api(`/api/invoices/${encodeURIComponent(id)}/reissue`,{method:"POST"}); toast("Reissued"); await refreshInvoices(); }catch(e){ toast(e.message); }
}
function openInvoiceEditModal(id){
  const inv=state.invoices.find(i=>i.id===id); if(!inv) return toast("Invoice not found");
  $("#invoiceEditForm").dataset.invoiceId=id;
  $("#editTitle").value=inv.summary.title||"";
  $("#editOverview").value=inv.summary.overview||"";
  $("#editHighlights").value=(inv.summary.highlights||[]).join("\n");
  $("#editDeliverables").value=(inv.summary.deliverables||[]).join("\n");
  $("#editTimeline").value=JSON.stringify(inv.summary.timeline||[],null,2);
  $("#editError").textContent="";
  $("#invoiceEditModal").classList.remove("hidden");
}
async function submitInvoiceEdit(event){
  event.preventDefault();
  const id=$("#invoiceEditForm").dataset.invoiceId; if(!id) return;
  let timeline; try{ timeline=$("#editTimeline").value.trim()? JSON.parse($("#editTimeline").value): undefined; }catch(e){ $("#editError").textContent="Invalid timeline JSON"; return; }
  const payload={ title:$("#editTitle").value.trim()||undefined, overview:$("#editOverview").value.trim()||undefined, highlights:$("#editHighlights").value.split("\n").map(s=>s.trim()).filter(Boolean), deliverables:$("#editDeliverables").value.split("\n").map(s=>s.trim()).filter(Boolean) };
  if(timeline) payload.timeline=timeline;
  try{ await api(`/api/invoices/${encodeURIComponent(id)}/summary`,{method:"PATCH", body:payload}); toast("Invoice updated"); closeModal("invoiceEditModal"); await refreshInvoices(); }catch(e){ $("#editError").textContent=e.message; }
}
async function openVersionsModal(id){
  $("#versionsList").innerHTML=`<span class="muted">Loading…</span>`;
  $("#versionsModal").classList.remove("hidden");
  try{ const data=await api(`/api/invoices/${encodeURIComponent(id)}/versions`); const v=data.versions||[]; if(!v.length) $("#versionsList").innerHTML=`<span class="muted">No prior versions.</span>`; else $("#versionsList").innerHTML=v.map(x=> `<div style="padding:6px;border-bottom:1px solid var(--line);font-size:13px"><strong>v${x.version}</strong> · ${esc(x.status)} · ${esc(x.createdAt||"")}</div>`).join(""); }catch(e){ $("#versionsList").innerHTML=`<span class="muted">${esc(e.message)}</span>`; }
}
async function refreshClients(){ try{ const d=await api("/api/bootstrap"); state.clients=d.clients||[]; renderClients(); }catch{} }
async function refreshInvoices(){ try{ const d=await api("/api/bootstrap"); state.invoices=d.invoices||[]; renderInvoices(); updateStats(); }catch{} }
async function loadOperators(){
  const el=$("#operatorList"); if(!el) return;
  try{ const d=await api("/api/operators"); const ops=d.operators||[]; if(!ops.length) el.innerHTML=`<span class="muted" style="font-size:12px">No operators yet.</span>`; else el.innerHTML=ops.map(o=> `<div style="display:flex;justify-content:space-between;padding:6px;border-bottom:1px solid var(--line);font-size:13px"><span>${esc(o.name)} <span class="muted">${esc(o.role)}</span></span><span class="muted">${esc(o.createdAt||"").slice(0,10)}</span></div>`).join(""); }catch(e){ el.innerHTML=`<span class="muted">${esc(e.message)}</span>`; }
}
async function createOperatorSubmit(event){
  event.preventDefault();
  const name=$("#operatorName").value.trim(); if(!name) return;
  const role=$("#operatorRole").value; const token=$("#operatorToken").value.trim()||undefined;
  try{ const data=await api("/api/operators",{method:"POST", body:{name, role, token}}); $("#operatorResult").textContent=`Created ${data.operator.name} — token: ${data.operator.token} — save it now!`; loadOperators(); }catch(e){ $("#operatorError").textContent=e.message; }
}


function openInvoiceModal(id) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice) return toast("Invoice not found.");
  state.openInvoiceId = id;
  const url = `/invoice/${encodeURIComponent(id)}?token=${encodeURIComponent(state.token)}`;
  const pdfUrl = `/api/invoices/${encodeURIComponent(id)}/pdf?token=${encodeURIComponent(state.token)}`;
  $("#invoiceModalTitle").textContent = invoice.number;
  $("#invoiceModalClient").textContent = `${invoice.client.name} · ${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`;
  $("#invoiceManualDescription").classList.toggle("hidden", !invoice.manualDescription);
  $("#invoiceManualDescriptionText").textContent = invoice.manualDescription || "";
  $("#invoiceFullPage").href = url;
  $("#invoiceDownload").href = pdfUrl;
  $("#invoiceFrame").src = url;
  $("#invoiceModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  $("#invoiceModal .close-button").focus();
}

function closeInvoiceModal() {
  state.openInvoiceId = null;
  $("#invoiceModal").classList.add("hidden");
  $("#invoiceFrame").src = "about:blank";
  $("#invoiceDeleteButton").disabled = false;
  $("#invoiceDeleteButton").textContent = "Delete invoice";
  document.body.classList.remove("modal-open");
}

async function deleteInvoice(id, button) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice || !window.confirm(`Delete ${invoice.number}? This permanently removes the invoice and its stored PDF.`)) return;
  if (button) setBusy(button, true, "Deleting...");
  try {
    await api(`/api/invoices/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.invoices = state.invoices.filter((item) => item.id !== id);
    if (state.openInvoiceId === id) closeInvoiceModal();
    renderInvoices();
    updateStats();
    toast(`${invoice.number} deleted.`);
  } catch (error) {
    if (button?.isConnected) setBusy(button, false, button.id === "invoiceDeleteButton" ? "Delete invoice" : "Delete");
    toast(error.message || "Could not delete invoice.");
  }
}

function renderPreview(invoice) {
  const root = $("#previewSummary");
  if (!invoice) {
    root.innerHTML = `<div class="empty-state"><span>✦</span><p>${state.source === "manual" ? "Your written summary will appear here." : "Your GitHub summary will appear here."}</p></div>`;
    $("#previewButton").textContent = "Preview summary";
    return;
  }
  const summary = invoice.summary || {};
  root.innerHTML = `<div class="summary-preview"><h3 class="preview-title">${esc(summary.title || "Services provided")}</h3><p class="preview-overview">${esc(summary.overview || "")}</p><p class="preview-activity"><span>Activity summary</span>${esc(summary.activitySummary || "")}</p><div class="preview-grid"><div><p class="preview-label">Highlights</p><ul>${(summary.highlights || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div><div><p class="preview-label">Timeline</p><ul>${(summary.timeline || []).map((entry) => `<li><strong>${esc(entry.period)}</strong> ${esc(entry.title)}</li>`).join("") || "<li>No dated activity</li>"}</ul></div></div></div>`;
}

function openPreviewModal() {
  if (!state.preview) return;
  renderPreviewEditor();
  $("#previewModal").classList.remove("hidden");
}

function closePreviewModal() { $("#previewModal").classList.add("hidden"); }

function renderPreviewEditor() {
  const summary = state.preview?.summary;
  if (!summary) return;
  $("#previewEditor").innerHTML = previewEditorHTML(summary);
  autosizeListInputs();
}

function autosizeListInputs() {
  document.querySelectorAll("#previewEditor textarea.preview-list-input").forEach((textarea) => {
    textarea.style.height = "auto";
    void textarea.offsetHeight;
    textarea.style.height = `${Math.max(34, textarea.scrollHeight + 2)}px`;
  });
}

function previewEditorHTML(summary) {
  const textField = (label, key, multiline, rows, placeholder) =>
    `<label class="field"><span>${label}</span>${multiline ? `<textarea class="preview-edit" data-scalar="${key}" rows="${rows}" placeholder="${placeholder || ""}">${esc(summary[key] || "")}</textarea>` : `<input class="preview-edit" data-scalar="${key}" value="${esc(summary[key] || "")}" />`}</label>`;
  const listSection = (title, key, hint) => {
    const items = summary[key] || [];
    return `<div class="form-section"><div class="form-section-heading"><h3>${title}</h3><p>${hint}</p></div>${items.length ? `<div class="preview-list">${items.map((item, index) => `<div class="preview-list-row"><textarea class="preview-edit preview-list-input" data-list="${key}" data-index="${index}" rows="1">${esc(item)}</textarea><button type="button" class="preview-list-remove" data-remove="${key}" data-index="${index}" aria-label="Remove ${title.toLowerCase()}">×</button></div>`).join("")}</div>` : ""}<button type="button" class="text-button preview-list-add" data-add="${key}">+ Add ${title.toLowerCase()}</button></div>`;
  };
  const timelineSection = () => {
    const entries = summary.timeline || [];
    return `<div class="form-section"><div class="form-section-heading"><h3>Timeline</h3><p>Chronological period entries shown on the work summary page.</p></div>${entries.length ? `<div class="preview-timeline">${entries.map((entry, index) => `<div class="preview-timeline-entry"><div class="preview-timeline-top"><input class="preview-edit preview-list-input" data-timeline="period" data-index="${index}" placeholder="Period" value="${esc(entry.period || "")}" /><textarea class="preview-edit preview-list-input" data-timeline="title" data-index="${index}" placeholder="Title" rows="1">${esc(entry.title || "")}</textarea><button type="button" class="preview-list-remove" data-remove="timeline" data-index="${index}" aria-label="Remove timeline entry">×</button></div><textarea class="preview-edit preview-list-input" data-timeline="detail" data-index="${index}" placeholder="Detail" rows="1">${esc(entry.detail || "")}</textarea></div>`).join("")}</div>` : ""}<button type="button" class="text-button preview-list-add" data-add="timeline">+ Add period</button></div>`;
  };
  return [
    textField("Invoice title", "title", false),
    textField("Overview", "overview", true, 3),
    textField("Activity summary", "activitySummary", true, 3),
    listSection("Highlights", "highlights", "Client-facing achievements, most important first."),
    listSection("Deliverables", "deliverables", "Shipped capabilities and substantial work products."),
    timelineSection(),
    textField("Notes for client", "notes", true, 2, "Thanks for your business — happy to answer any questions about the work."),
  ].join("");
}

function initPreviewEditor() {
  const editor = $("#previewEditor");
  if (!editor || editor.dataset.bound === "true") return;
  editor.dataset.bound = "true";
  editor.addEventListener("input", (event) => {
    const el = event.target;
    if (!el.classList?.contains("preview-edit")) return;
    const summary = state.preview?.summary;
    if (!summary) return;
    if (el.dataset.scalar) { summary[el.dataset.scalar] = el.value; return; }
    if (el.dataset.list) { (summary[el.dataset.list] || (summary[el.dataset.list] = []))[Number(el.dataset.index)] = el.value; return; }
    if (el.dataset.timeline && summary.timeline[Number(el.dataset.index)]) summary.timeline[Number(el.dataset.index)][el.dataset.timeline] = el.value;
    if (el.tagName === "TEXTAREA") autosizeListInputs();
  });
  editor.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const summary = state.preview?.summary;
    if (!summary) return;
    if (button.dataset.add) {
      if (button.dataset.add === "timeline") summary.timeline.push({ period: "", title: "", detail: "", commits: 0 });
      else (summary[button.dataset.add] || (summary[button.dataset.add] = [])).push("");
      renderPreviewEditor();
      return;
    }
    if (button.dataset.remove) {
      (summary[button.dataset.remove] || []).splice(Number(button.dataset.index), 1);
      renderPreviewEditor();
    }
  });
}

function updateStats() {
  try{ renderSparkline(); }catch{}
  $("#statClients").textContent = String(state.clients.filter((client) => client.active).length);
  const period = $("#statPeriod")?.value || "month";
  const range = statsRange(period, new Date());
  const matching = state.invoices.filter((invoice) => {
    const issuedAt = new Date(invoice.issuedAt || "");
    return Number.isFinite(issuedAt.getTime()) && issuedAt >= range.start && issuedAt < range.end;
  });
  const currency = matching[0]?.currency || state.invoices[0]?.currency || "USD";
  const total = matching.filter((invoice) => invoice.currency === currency).reduce((sum, invoice) => sum + Number(invoice.totalCents || 0), 0);
  $("#statTotal").textContent = formatMoney(total, currency);
  $("#statSync").textContent = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date());
}

function statsRange(period, now) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarterStart = month - (month % 3);
  const ranges = {
    month: { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) },
    "last-month": { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) },
    quarter: { start: new Date(year, quarterStart, 1), end: new Date(year, quarterStart + 3, 1) },
    "last-quarter": { start: new Date(year, quarterStart - 3, 1), end: new Date(year, quarterStart, 1) },
    year: { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) },
    "last-year": { start: new Date(year - 1, 0, 1), end: new Date(year, 0, 1) },
    all: { start: new Date(0), end: new Date(8640000000000000) },
  };
  return ranges[period] || ranges.month;
}

function populateClientSelect() {
  const select = $("#generatorClient");
  const current = select.value;
  select.innerHTML = `<option value="">Choose a client</option>${state.clients.filter((client) => client.active).map((client) => `<option value="${esc(client.id)}">${esc(client.name)}</option>`).join("")}`;
  if (state.clients.some((client) => client.id === current)) select.value = current;
  syncStyledSelect(select, true);
  updatePricingFields();
}

async function loadClientTime(clientId){
  const el = $("#clientTimeList");
  if(!el) return;
  el.innerHTML = `<span class="muted">Loading…</span>`;
  try{
    const data = await api(`/api/clients/${encodeURIComponent(clientId)}/time`);
    const entries = data.entries || [];
    if(!entries.length){ el.innerHTML = `<span class="muted">No time entries yet.</span>`; return; }
    el.innerHTML = entries.slice(0,8).map(e=> `<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:4px 0"><span>${esc(e.date)} · ${esc(e.description||'')}</span><strong>${Number(e.hours).toFixed(2)}h</strong></div>`).join("") + (entries.length>8? `<div class="muted">+${entries.length-8} more</div>`:"");
  }catch{ el.innerHTML = `<span class="muted">Could not load time.</span>`; }
}
function openClientModal(client) {
  $("#clientModalTitle").textContent = client ? "Edit client" : "Add a client";
  $("#clientId").value = client?.id || "";
  $("#clientName").value = client?.name || "";
  $("#clientContactFirstName").value = client?.contactFirstName || "";
  $("#clientContactLastName").value = client?.contactLastName || "";
  $("#clientEmail").value = client?.email || "";
  $("#clientPhone").value = client?.phone || "";
  $("#clientWebsite").value = client?.website || "";
  $("#clientAddress").value = client?.address || "";
  $("#clientRepos").value = (client?.githubRepos || []).join("\n");
  $("#clientAuthor").value = client?.githubAuthor || "";
  $("#clientProjectContext").value = client?.projectContext || "";
  $("#clientSummaryPriorities").value = client?.summaryPriorities || "";
  $("#clientCurrency").value = client?.currency || "USD";
  $("#clientBillingModel").value = client?.billingModel || "flat";
  $("#clientPaymentMethod").value = client?.paymentMethod || "wire";
  $("#clientTax").value = client?.taxRate || "";
  $("#clientCadence").value = client?.cadence || "manual";
  $("#clientPaymentDays").value = client?.paymentDays || "";
  $("#clientPaymentTerms").value = client?.paymentTerms || "Due on receipt";
  $("#clientPortalPassword").value = "";
  $("#clientPortalPassword").type = "password";
  resetPasswordToggle("clientPortalPassword");
  $("#clientTerms").value = client?.specialTerms || "";
  $("#clientError").textContent = "";
  syncAllStyledSelects();
  $("#clientModal").classList.remove("hidden");
  if(client && client.id) loadClientTime(client.id); else { const tl=$("#clientTimeList"); if(tl) tl.innerHTML=`<span class=\"muted\">Save client first, then import time.</span>`; }
}

async function saveClient(event) {
  event.preventDefault();
  const id = $("#clientId").value;
  const input = { id: id || undefined, name: $("#clientName").value.trim(), contactFirstName: $("#clientContactFirstName").value.trim(), contactLastName: $("#clientContactLastName").value.trim(), email: $("#clientEmail").value.trim(), phone: $("#clientPhone").value.trim(), website: $("#clientWebsite").value.trim(), address: $("#clientAddress").value.trim(), githubRepos: parseGithubRepositories($("#clientRepos").value), githubAuthor: $("#clientAuthor").value.trim(), projectContext: $("#clientProjectContext").value.trim(), summaryPriorities: $("#clientSummaryPriorities").value.trim(), currency: $("#clientCurrency").value, billingModel: $("#clientBillingModel").value, defaultRateCents: 0, taxRate: Number($("#clientTax").value || 0), cadence: $("#clientCadence").value, paymentMethod: $("#clientPaymentMethod").value, paymentDays: Number($("#clientPaymentDays").value || 0), paymentTerms: $("#clientPaymentTerms").value.trim(), portalPassword: $("#clientPortalPassword").value, specialTerms: $("#clientTerms").value.trim(), active: true };
  try {
    const data = await api(id ? `/api/clients/${encodeURIComponent(id)}` : "/api/clients", { method: id ? "PUT" : "POST", body: input });
    const index = state.clients.findIndex((client) => client.id === data.client.id);
    if (index === -1) state.clients.push(data.client); else state.clients[index] = data.client;
    invalidatePreview();
    closeModal("clientModal");
    render();
    toast("Client saved.");
  } catch (error) {
    $("#clientError").textContent = error.message || "Could not save client";
  }
}

function updatePricingFields() {
  const client = state.clients.find((item) => item.id === $("#generatorClient").value);
  const root = $("#pricingFields");
  if (!client) {
    root.classList.add("hidden");
    return;
  }
  root.classList.remove("hidden");
  const hourly = client.billingModel === "hourly";
  $("#pricingModelLabel").textContent = hourly ? "Hourly billing" : "Flat-fee billing";
  $("#pricingDefaultHint").textContent = hourly ? "Rate and hours are required for this invoice" : "Fee is required for this invoice";
  $("#flatPricingFields").classList.toggle("hidden", hourly);
  $("#hourlyPricingFields").classList.toggle("hidden", !hourly);
  $("#invoiceAmount").disabled = hourly;
  $("#invoiceRate").disabled = !hourly;
  $("#invoiceHours").disabled = !hourly;
  $("#pricingError").textContent = "";
}

function selectGeneratorClient() {
  $("#invoiceAmount").value = "";
  $("#invoiceRate").value = "";
  $("#invoiceHours").value = "";
  $("#invoiceDescription").value = "";
  updatePricingFields();
  invalidatePreview();
}

function readPricing() {
  const client = state.clients.find((item) => item.id === $("#generatorClient").value);
  if (!client) {
    toast("Choose a client first.");
    return null;
  }
  const error = $("#pricingError");
  error.textContent = "";
  const description = $("#invoiceDescription").value.trim();
  if (client.billingModel === "flat") {
    const amountCents = Math.round(Number($("#invoiceAmount").value || 0) * 100);
    if (amountCents <= 0) {
      error.textContent = "Enter the flat fee for this billing period before previewing.";
      return null;
    }
    return { model: "flat", amountCents, description };
  }
  const rateCents = Math.round(Number($("#invoiceRate").value || 0) * 100);
  const hours = Number($("#invoiceHours").value || 0);
  if (rateCents <= 0) {
    error.textContent = "Enter the hourly rate before previewing.";
    return null;
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    error.textContent = "Enter the billable hours before previewing.";
    return null;
  }
  return { model: "hourly", rateCents, hours, description };
}

function invalidatePreview() {
  if (!state.preview) return;
  state.preview = null;
  state.previewKey = "";
  state.previewRequest = null;
  $("#createButton").disabled = true;
  renderPreview(null);
}

async function removeClient(id) {
  const client = state.clients.find((item) => item.id === id);
  if (!client || !window.confirm(`Remove ${client.name}? Existing invoices will be preserved.`)) return;
  try { await api(`/api/clients/${encodeURIComponent(id)}`, { method: "DELETE" }); state.clients = state.clients.filter((item) => item.id !== id); render(); toast("Client removed."); } catch (error) { toast(error.message || "Could not remove client"); }
}

function openSettingsModal() {
  setTimeout(loadOperators, 0);
  const provider = state.provider || {};
  $("#providerBusiness").value = provider.businessName || "";
  $("#providerLogo").value = provider.logoUrl || "";
  $("#providerName").value = provider.providerName || "";
  $("#providerAddress").value = provider.address || "";
  $("#providerEmail").value = provider.email || "";
  $("#providerWebsite").value = provider.website || "";
  $("#providerTaxId").value = provider.taxId || "";
  $("#providerRemittance").value = provider.remittance || "";
  $("#settingsError").textContent = "";
  $("#settingsModal").classList.remove("hidden");
}

async function saveSettings(event) {
  event.preventDefault();
  const provider = { businessName: $("#providerBusiness").value.trim(), logoUrl: $("#providerLogo").value.trim(), providerName: $("#providerName").value.trim(), address: $("#providerAddress").value.trim(), email: $("#providerEmail").value.trim(), website: $("#providerWebsite").value.trim(), taxId: $("#providerTaxId").value.trim(), remittance: $("#providerRemittance").value.trim() };
  try { const data = await api("/api/settings", { method: "PUT", body: provider }); state.provider = data.provider; applyProviderBrand(); closeModal("settingsModal"); toast("Provider settings saved."); } catch (error) { $("#settingsError").textContent = error.message || "Could not save settings"; }
}

function setDefaultPeriod() { setPeriod("week"); }

function setPeriod(type) {
  const today = new Date();
  let start;
  let end;
  if (type === "month") {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  } else if (type === "current") {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    end = today;
  } else {
    const currentDay = today.getUTCDay() || 7;
    end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - currentDay));
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 6));
  }
  $("#periodStart").value = toDay(start);
  $("#periodEnd").value = toDay(end);
}

function showAuth() { $("#authGate").classList.remove("hidden"); }
function hideAuth() { $("#authGate").classList.add("hidden"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); }
function setBusy(button, busy, label) { button.disabled = busy; button.innerHTML = busy ? `${label} <span class="spinner">◌</span>` : label; }

function bindPasswordToggles() {
  $$('[data-password-toggle]').forEach((button) => button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    setPasswordToggleIcon(button, visible);
    button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${button.dataset.passwordToggle === "tokenInput" ? "admin token" : "client portal password"}`);
    button.setAttribute("aria-pressed", String(visible));
  }));
}

function resetPasswordToggle(id) {
  const button = document.querySelector(`[data-password-toggle="${id}"]`);
  if (!button) return;
  setPasswordToggleIcon(button, false);
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", id === "tokenInput" ? "Show admin token" : "Show client portal password");
}

function setPasswordToggleIcon(button, visible) {
  const icon = document.createElement("span");
  icon.className = "password-eye";
  icon.setAttribute("aria-hidden", "true");
  button.replaceChildren(icon);
  button.setAttribute("aria-pressed", String(visible));
}

let openStyledSelect = null;

function initStyledSelects() {
  $$('select').forEach(enhanceStyledSelect);
  document.addEventListener("click", () => closeStyledSelect());
}

function enhanceStyledSelect(select) {
  if (select.dataset.styled === "true") return syncStyledSelect(select, true);
  select.dataset.styled = "true";
  select.classList.add("styled-select-native");
  select.tabIndex = -1;

  const wrapper = document.createElement("div");
  wrapper.className = "styled-select";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "styled-select-button";
  button.setAttribute("role", "combobox");
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "styled-select-menu";
  menu.id = `${select.id || "select"}-menu`;
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  button.setAttribute("aria-controls", menu.id);

  select.before(wrapper);
  wrapper.append(select, button, menu);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (openStyledSelect === wrapper) closeStyledSelect();
    else openSelectMenu(wrapper);
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (openStyledSelect !== wrapper) openSelectMenu(wrapper);
    const choices = Array.from(menu.querySelectorAll(".styled-select-option:not(:disabled)"));
    const selected = menu.querySelector('[aria-selected="true"]');
    const target = event.key === "End" ? choices.at(-1) : event.key === "Home" ? choices[0] : selected || choices[0];
    target?.focus();
  });
  select.addEventListener("change", () => syncStyledSelect(select));
  select.addEventListener("invalid", () => button.focus());
  syncStyledSelect(select, true);
}

function syncAllStyledSelects() {
  $$('select').forEach((select) => syncStyledSelect(select, true));
}

function syncStyledSelect(select, rebuild = false) {
  if (!select || select.dataset.styled !== "true") return;
  const wrapper = select.closest(".styled-select");
  const button = wrapper?.querySelector(".styled-select-button");
  const menu = wrapper?.querySelector(".styled-select-menu");
  if (!button || !menu) return;
  const selected = select.options[select.selectedIndex] || select.options[0];
  button.textContent = selected?.textContent || "Choose an option";
  button.disabled = select.disabled;
  if (!rebuild) {
    menu.querySelectorAll(".styled-select-option").forEach((option, index) => option.setAttribute("aria-selected", String(index === select.selectedIndex)));
    return;
  }
  menu.innerHTML = "";
  Array.from(select.options).forEach((option, index) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "styled-select-option";
    choice.setAttribute("role", "option");
    choice.setAttribute("aria-selected", String(index === select.selectedIndex));
    choice.disabled = option.disabled;
    choice.textContent = option.textContent;
    choice.addEventListener("click", (event) => {
      event.stopPropagation();
      select.selectedIndex = index;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeStyledSelect();
      button.focus();
    });
    choice.addEventListener("keydown", (event) => moveSelectOptionFocus(event, menu, button));
    menu.append(choice);
  });
}

function openSelectMenu(wrapper) {
  closeStyledSelect();
  openStyledSelect = wrapper;
  wrapper.classList.add("open");
  wrapper.querySelector(".styled-select-menu").hidden = false;
  wrapper.querySelector(".styled-select-button").setAttribute("aria-expanded", "true");
}

function closeStyledSelect() {
  if (!openStyledSelect) return;
  openStyledSelect.classList.remove("open");
  openStyledSelect.querySelector(".styled-select-menu").hidden = true;
  openStyledSelect.querySelector(".styled-select-button").setAttribute("aria-expanded", "false");
  openStyledSelect = null;
}

function moveSelectOptionFocus(event, menu, button) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeStyledSelect();
    button.focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const choices = Array.from(menu.querySelectorAll(".styled-select-option:not(:disabled)"));
  const current = choices.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : event.key === "ArrowDown" ? Math.min(current + 1, choices.length - 1) : Math.max(current - 1, 0);
  choices[next]?.focus();
}

const DATE_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DATE_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
let activeDatePicker = null;

function initDatePickers() {
  const fields = $$(".date-input");
  if (!fields.length) return;

  const popup = document.createElement("div");
  popup.className = "date-popup";
  popup.hidden = true;
  popup.innerHTML =
    '<div class="date-popup-head">' +
    '<button type="button" class="date-popup-nav" data-nav="-1" aria-label="Previous month">‹</button>' +
    '<div class="date-popup-title"></div>' +
    '<button type="button" class="date-popup-nav" data-nav="1" aria-label="Next month">›</button>' +
    '</div>' +
    '<div class="date-popup-weekdays"></div>' +
    '<div class="date-popup-grid"></div>' +
    '<div class="date-popup-foot"><button type="button" class="date-popup-clear">Clear</button></div>';
  document.body.append(popup);

  const titleEl = popup.querySelector(".date-popup-title");
  const weekdaysEl = popup.querySelector(".date-popup-weekdays");
  const grid = popup.querySelector(".date-popup-grid");
  const clearButton = popup.querySelector(".date-popup-clear");
  let currentField = null;
  let viewDate = new Date();
  viewDate.setDate(1);

  function pad(value) { return (value < 10 ? "0" : "") + value; }
  function toISO(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function parseISO(value) { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
  function commit(value) {
    if (!currentField) return;
    currentField.value = value;
    currentField.dispatchEvent(new Event("input", { bubbles: true }));
    currentField.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function render() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    titleEl.textContent = `${DATE_MONTHS[month]} ${year}`;
    if (!weekdaysEl.childElementCount) DATE_WEEKDAYS.forEach((name) => weekdaysEl.append(Object.assign(document.createElement("span"), { textContent: name })));
    grid.innerHTML = "";
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = toISO(new Date());
    const selected = currentField?.value || "";
    for (let i = 0; i < firstWeekday; i++) grid.append(document.createElement("span"));
    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = `${year}-${pad(month + 1)}-${pad(day)}`;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "date-cell";
      cell.textContent = day;
      cell.dataset.date = dateISO;
      cell.setAttribute("aria-label", `${DATE_MONTHS[month]} ${day}, ${year}`);
      if (dateISO === today) cell.classList.add("today");
      if (dateISO === selected) cell.classList.add("selected");
      cell.addEventListener("click", () => { commit(cell.dataset.date); closeDatePicker(); });
      grid.append(cell);
    }
    clearButton.classList.toggle("show", Boolean(selected));
  }

  function openDatePicker(field) {
    currentField = field;
    const parsed = parseISO(field.value) || new Date();
    viewDate = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    render();
    popup.style.visibility = "hidden";
    popup.hidden = false;
    const height = popup.offsetHeight || 300;
    const width = popup.offsetWidth || 268;
    const rect = field.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.visibility = "";
  }

  function closeDatePicker() { popup.hidden = true; currentField = null; activeDatePicker = null; }

  popup.querySelectorAll(".date-popup-nav").forEach((button) => button.addEventListener("click", () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + Number(button.dataset.nav), 1);
    render();
  }));
  clearButton.addEventListener("click", () => { commit(""); closeDatePicker(); });

  fields.forEach((field) => {
    field.addEventListener("click", () => {
      if (activeDatePicker === field) { closeDatePicker(); return; }
      openDatePicker(field);
      activeDatePicker = field;
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDatePicker();
      if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); openDatePicker(field); activeDatePicker = field; }
    });
  });

  document.addEventListener("pointerdown", (event) => { if (!popup.hidden && !popup.contains(event.target)) closeDatePicker(); }, true);
  window.addEventListener("scroll", () => { if (!popup.hidden) closeDatePicker(); }, true);
  window.addEventListener("resize", () => { if (!popup.hidden) closeDatePicker(); });
}

async function api(path, options = {}) {
  const headers = {};
  if (options.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("visible"); window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => node.classList.remove("visible"), 3500); }
function formatMoney(cents, currency) { try { return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100); } catch { return `${currency} ${((Number(cents) || 0) / 100).toFixed(2)}`; } }
function parseGithubRepositories(value) { return String(value || "").replace(/(?=https?:\/\/(?:www\.)?github\.com\/)/gi, "\n").split(/[\s,]+/).map((repo) => repo.trim()).filter(Boolean); }
function paymentMethodLabel(method) { return method === "etransfer" ? "E-transfer" : method === "alternative" ? "Alternative" : "Wire transfer"; }

function contactName(client) { return [client?.contactFirstName, client?.contactLastName].map((part) => (part || "").trim()).filter(Boolean).join(" "); }
function formatDate(value) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
function toDay(date) { return date.toISOString().slice(0, 10); }
function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character); }
