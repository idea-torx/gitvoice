#!/usr/bin/env python3
"""Gitvoice agent CLI — lets any AI agent (Hermes, Claude Code, Codex, OpenCode, …) operate Gitvoice.

Auth: admin secret via $GITVOICE_ADMIN_TOKEN (any platform) or macOS Keychain
(service=gitvoice-admin). POST /api/auth {password} -> 30-day token, cached in
~/.hermes/state/gitvoice-token.json (or $XDG_STATE_HOME on non-macOS).

Every HTTP surface the app exposes has a command here. `--base URL` is a global flag and
must come before the subcommand (default: prod).

Instance:
  status | setup | auth [--force] | reset-password | recover --recovery-code --new-password
  settings | settings-update [--business-name] [--provider-name] [--address] [--email] [--website]
                             [--tax-id] [--remittance] [--logo-url] [--accent-color] [--font-family]
                             [--header-style classic|modern|minimal]
  operators | operator-add --name [--role admin|operator] [--token]

Clients (--name is the company billed; --first-name/--last-name are the person addressed at it):
  clients | discover --query "..." | bulk-import --file F
  client-add --name "Acme Inc." --email a@b.c [--first-name] [--last-name] [--phone] [--address]
             [--website] [--currency CAD] [--payment-method etransfer|wire|alternative]
             [--model hourly|flat] [--rate-cents N] [--portal-password]
  client-update --id ID [same flags] [--active true|false]
  client-delete --id ID --yes
  time --client-id ID | time-import --client-id ID --file F

Invoices (omit --desc to summarize the client's GitHub activity instead):
  preview --client ID --start YYYY-MM-DD --end YYYY-MM-DD [--desc "..."] [--source github|manual]
          [--hours N] [--rate-cents N] [--amount-cents N] [--title] [--overview] [--highlight]
          [--deliverable] [--next-step] [--summary-file F]
  create  [same flags] --yes
  list | get ID [--html] [--out F] | pdf ID [--out F] | versions --id ID
  summary-patch --id ID [--title] [--overview] [--highlight] [--deliverable] [--next-step] [--summary-file F]
  void --id ID | reissue --id ID | invoice-delete --id ID --yes
  notify --id ID --yes        (emails the invoice to the client)

Client portal / ops:
  portal-clients | portal-login --client-id ID --password ... | portal-invoices
  portal-invoice --id ID [--pdf] [--out F] | portal-dispute --id ID --reason "..." --yes
  backup [--out DIR] | watch [--interval N] [--out DIR]
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

KEYCHAIN_SERVICE = "gitvoice-admin"
KEYCHAIN_ACCOUNT = "leofelix"
STATE_DIR = os.path.expanduser("~/.hermes/state")
TOKEN_CACHE = os.path.join(STATE_DIR, "gitvoice-token.json")
DEFAULT_BASE = "https://invoicer-pro.ideatorx.workers.dev"


def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def keychain_secret():
    """Admin token resolution: GITVOICE_ADMIN_TOKEN env var (cross-platform) → macOS Keychain."""
    env_token = os.environ.get("GITVOICE_ADMIN_TOKEN")
    if env_token:
        return env_token
    r = subprocess.run(
        ["security", "find-generic-password", "-a", KEYCHAIN_ACCOUNT,
         "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True, text=True)
    if r.returncode != 0:
        die("No admin token found. Set GITVOICE_ADMIN_TOKEN (env) or add it to Keychain:\n"
            "  security add-generic-password -U -a leofelix -s gitvoice-admin -w 'YOUR_TOKEN'")
    return r.stdout.strip()


# Cloudflare's bot rules 403 the default Python-urllib user-agent (error 1010).
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139 Safari/537.36"


def request(base, path, method="GET", token=None, payload=None, timeout=120):
    url = base.rstrip("/") + path
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    last_err = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode()
                return resp.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read().decode() if hasattr(e, "read") else ""
            try:
                detail = json.loads(raw)
            except Exception:
                detail = {"raw": raw[:300]}
            return e.code, detail
        except Exception as e:  # network/timeout hiccups — retry once
            last_err = e
            time.sleep(2)
    die(f"request failed after retry: {last_err}")


def request_bytes(base, path, token=None, timeout=60):
    """Fetch raw bytes (for PDF downloads). Raises on HTTP error."""
    url = base.rstrip("/") + path
    headers = {"User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        ct = resp.headers.get("content-type", "")
        data = resp.read()
        if "json" in ct:
            return None, json.loads(data.decode())
        return data, None


def auth(base, force=False):
    if not force and os.path.exists(TOKEN_CACHE):
        cached = json.load(open(TOKEN_CACHE))
        if cached.get("base") == base and cached.get("expiresAt", 0) > time.time() + 300:
            return cached["token"]
    status, data = request(base, "/api/auth", method="POST", payload={"password": keychain_secret()})
    token = (data or {}).get("token")
    if status != 200 or not token:
        die(f"auth failed (HTTP {status}): {data}")
    os.makedirs(STATE_DIR, exist_ok=True)
    # token TTL is 30 days from issue
    json.dump({"base": base, "token": token, "expiresAt": time.time() + 29 * 86400},
              open(TOKEN_CACHE, "w"))
    os.chmod(TOKEN_CACHE, 0o600)
    print(f"auth ok (token cached until +29d, base={base})")
    return token


def require_auth(base):
    return auth(base)


def cmd_auth(args):
    auth(args.base, force=True)


def cmd_logout(args):
    """Revokes the cached session server-side, then drops it locally."""
    if os.path.exists(TOKEN_CACHE):
        token = json.load(open(TOKEN_CACHE)).get("token")
        request(args.base, "/api/auth/logout", method="POST", token=token, payload={})
        os.remove(TOKEN_CACHE)
    print("signed out")


def cmd_clients(args):
    token = require_auth(args.base)
    status, boot = request(args.base, "/api/bootstrap", token=token)
    if status != 200:
        die(f"bootstrap failed (HTTP {status}): {boot}")
    clients = boot.get("clients", [])
    if not clients:
        print("no clients")
        return
    print(f"{'ID':<40} {'NAME':<28} {'MODEL':<12} {'CURRENCY':<8} RATE_CENTS")
    for c in clients:
        print(f"{c.get('id',''):<40} {c.get('name',''):<28} {c.get('billingModel',''):<12} {c.get('currency',''):<8} {c.get('defaultRateCents',''):<8} {'active' if c.get('active') else 'INACTIVE'}")


def resolve_client_id(base, token, value):
    """Resolve an exact case-insensitive client name or accept a client ID."""
    status, boot = request(base, "/api/bootstrap", token=token)
    if status != 200:
        die(f"bootstrap failed (HTTP {status}): {boot}")
    exact = [c for c in boot.get("clients", []) if c.get("id") == value or c.get("name", "").casefold() == value.casefold()]
    if len(exact) == 1:
        return exact[0]["id"]
    if len(exact) > 1:
        die(f"ambiguous client name: {value!r}; use the client ID")
    die(f"client not found: {value!r}; run `clients` to list clients")


def build_body(args, client_id=None):
    pricing = None
    if getattr(args, "hours", None) is not None or getattr(args, "rate_cents", None) is not None or getattr(args, "amount_cents", None) is not None:
        pricing = {}
        if getattr(args, "amount_cents", None) is not None:
            pricing = {"model": "flat", "amountCents": args.amount_cents}
        else:
            pricing = {"model": "hourly", "rateCents": args.rate_cents or 0}
            if getattr(args, "hours", None) is not None:
                pricing["hours"] = args.hours
    body = {
        "clientId": client_id or args.client,
        "periodStart": args.start,
        "periodEnd": args.end,
        "pricing": pricing,
    }
    # No --desc (or --source github) means the worker summarizes the client's GitHub activity itself.
    if getattr(args, "source", None) != "github" and getattr(args, "desc", None):
        body["source"] = "manual"
        body["description"] = args.desc
    override = summary_override_from(args)
    if override:
        body["summaryOverride"] = override
    return body


def add_summary_override_args(p):
    p.add_argument("--title")
    p.add_argument("--overview")
    p.add_argument("--highlight", action="append", help="repeatable")
    p.add_argument("--deliverable", action="append", help="repeatable")
    p.add_argument("--next-step", action="append", help="repeatable")
    p.add_argument("--summary-file", help="JSON SummaryOverride (title/overview/highlights/deliverables/nextSteps/timeline)")


def summary_override_from(args):
    """SummaryOverride body from --summary-file plus the discrete --title/--overview/--highlight/... flags."""
    override = {}
    if getattr(args, "summary_file", None):
        loaded = json.load(open(args.summary_file))
        override.update(loaded.get("summary") if isinstance(loaded.get("summary"), dict) else loaded)
    for dest, key in (("title", "title"), ("overview", "overview"), ("highlight", "highlights"),
                      ("deliverable", "deliverables"), ("next_step", "nextSteps")):
        value = getattr(args, dest, None)
        if value:
            override[key] = value
    return override


def cmd_preview(args):
    token = require_auth(args.base)
    client_id = resolve_client_id(args.base, token, args.client)
    status, data = request(args.base, "/api/preview", method="POST", token=token, payload=build_body(args, client_id))
    if status != 200:
        die(f"preview failed (HTTP {status}): {data}")
    inv = data.get("invoice", {})
    print(json.dumps({
        "client": inv.get("client", {}).get("name"),
        "periodStart": inv.get("periodStart"),
        "periodEnd": inv.get("periodEnd"),
        "subtotalCents": inv.get("subtotalCents"),
        "taxCents": inv.get("taxCents"),
        "totalCents": inv.get("totalCents"),
        "currency": inv.get("currency"),
        "summary": inv.get("summary"),
    }, indent=2, default=str))
    # cache the draft so `create` can reuse pricing+summary without regenerating
    os.makedirs(STATE_DIR, exist_ok=True)
    json.dump({"base": args.base, **build_body(args, client_id), "draft": inv},
              open(os.path.join(STATE_DIR, "gitvoice-draft.json"), "w"))
    os.chmod(os.path.join(STATE_DIR, "gitvoice-draft.json"), 0o600)
    print("\n[draft cached — run create with the same args to finalize]")


def cmd_create(args):
    if not args.yes:
        die("create requires --yes (financial action). Run `preview` first to review the draft.")
    token = require_auth(args.base)
    client_id = resolve_client_id(args.base, token, args.client)
    # Direct create: the worker generates the summary and short-circuits with
    # existing:true if the period is already invoiced (no LLM call for dupes).
    status, created = request(args.base, "/api/invoices", method="POST", token=token, payload=build_body(args, client_id))
    if status not in (200, 201):
        die(f"create failed (HTTP {status}): {created}")
    inv2 = (created or {}).get("invoice", {})
    existing = (created or {}).get("existing")
    print(json.dumps({
        "status": "existing-period" if existing else "created",
        "id": inv2.get("id"),
        "number": inv2.get("number"),
        "client": inv2.get("client", {}).get("name"),
        "period": f"{inv2.get('periodStart')} → {inv2.get('periodEnd')}",
        "total": f"{inv2.get('currency')} {inv2.get('totalCents', 0) / 100:.2f}",
        "pdf": f"{args.base.rstrip('/')}/api/invoices/{inv2.get('id')}/pdf",
    }, indent=2))


def cmd_get(args):
    token = require_auth(args.base)
    if args.html:
        body, err = request_bytes(args.base, f"/invoice/{args.id}", token=token)
        if body is None:
            die(f"get --html failed: {err}")
        if args.out:
            open(args.out, "wb").write(body)
            print(f"saved {len(body)} bytes → {os.path.abspath(args.out)}")
        else:
            print(body.decode("utf-8", "replace"))
        return
    status, data = request(args.base, f"/api/invoices/{args.id}", token=token)
    if status != 200:
        die(f"get failed (HTTP {status}): {data}")
    print(json.dumps(data, indent=2, default=str))


def cmd_list(args):
    token = require_auth(args.base)
    status, data = request(args.base, "/api/invoices", token=token)
    if status != 200:
        die(f"list failed (HTTP {status}): {data}")
    invoices = data if isinstance(data, list) else data.get("invoices", [])
    if not invoices:
        print("no invoices")
        return
    for inv in invoices:
        print(f"{inv.get('number',''):<12} {str(inv.get('client',{}).get('name','')):<24} "
              f"{str(inv.get('periodStart',''))[:10]} → {str(inv.get('periodEnd',''))[:10]}  "
              f"{inv.get('currency','')} {inv.get('totalCents',0)/100:>10.2f}  {inv.get('status','')}  {inv.get('id','')}")


PAYMENT_METHODS = ["etransfer", "wire", "alternative"]

# argparse dest -> ClientInput key, for every field client-update can override.
CLIENT_FIELD_FLAGS = [
    ("name", "name"), ("first_name", "contactFirstName"), ("last_name", "contactLastName"),
    ("email", "email"), ("phone", "phone"), ("address", "address"), ("website", "website"),
    ("github_repo", "githubRepos"), ("github_author", "githubAuthor"),
    ("project_context", "projectContext"), ("summary_priorities", "summaryPriorities"),
    ("currency", "currency"), ("payment_method", "paymentMethod"), ("payment_days", "paymentDays"),
    ("payment_terms", "paymentTerms"), ("cadence", "cadence"), ("billing_day", "billingDay"),
    ("tax_rate", "taxRate"), ("special_terms", "specialTerms"),
    ("model", "billingModel"), ("rate_cents", "defaultRateCents"), ("active", "active"),
]


def cmd_client_add(args):
    token = require_auth(args.base)
    payload = {
        "name": args.name, "email": args.email, "address": args.address or "",
        "contactFirstName": args.first_name or "", "contactLastName": args.last_name or "",
        "phone": args.phone or "", "website": args.website or "",
        "githubRepos": args.github_repo or [], "githubAuthor": args.github_author or "",
        "projectContext": args.project_context or "", "summaryPriorities": args.summary_priorities or "",
        "currency": args.currency,
        "billingModel": args.model, "defaultRateCents": args.rate_cents,
        "taxRate": args.tax_rate, "cadence": args.cadence, "billingDay": args.billing_day,
        "paymentMethod": args.payment_method,
        "paymentDays": args.payment_days, "paymentTerms": args.payment_terms,
        "specialTerms": args.special_terms, "active": True,
        "metadata": metadata_from(args.meta),
    }
    if getattr(args, "portal_password", None):
        payload["portalPassword"] = args.portal_password
    status, data = request(args.base, "/api/clients", method="POST", token=token, payload=payload)
    if status != 200:
        die(f"client-add failed (HTTP {status}): {data}")
    print(json.dumps(data, indent=2, default=str))


def client_payload_from(c):
    """Build a full ClientInput body from a bootstrap client record (upsert = full replace)."""
    return {
        "name": c.get("name", ""), "email": c.get("email", ""), "address": c.get("address", ""),
        "contactFirstName": c.get("contactFirstName", ""), "contactLastName": c.get("contactLastName", ""),
        "phone": c.get("phone", ""), "website": c.get("website", ""),
        "githubRepos": c.get("githubRepos", []), "githubAuthor": c.get("githubAuthor", ""),
        "projectContext": c.get("projectContext", ""), "summaryPriorities": c.get("summaryPriorities", ""),
        "currency": c.get("currency", "USD"), "billingModel": c.get("billingModel", "hourly"),
        "defaultRateCents": c.get("defaultRateCents", 0), "defaultHours": c.get("defaultHours") or 0,
        "billingDay": c.get("billingDay", 1), "taxRate": c.get("taxRate", 0),
        "cadence": c.get("cadence", "manual"), "paymentMethod": c.get("paymentMethod", "wire"),
        "paymentDays": c.get("paymentDays", 0), "paymentTerms": c.get("paymentTerms", "Due on receipt"),
        "specialTerms": c.get("specialTerms", ""), "active": c.get("active", True),
        # Carried forward: the upsert is a full replace, so omitting this erases the client's metadata.
        "metadata": c.get("metadata") or {},
    }


def metadata_from(pairs, existing=None):
    """`--meta key=value` pairs merged onto whatever the client already carries."""
    merged = dict(existing or {})
    for pair in pairs or []:
        key, sep, value = pair.partition("=")
        if not sep or not key.strip():
            die(f"--meta expects key=value, got {pair!r}")
        merged[key.strip()] = value.strip()
    return merged


def cmd_client_update(args):
    token = require_auth(args.base)
    status, boot = request(args.base, "/api/bootstrap", token=token)
    if status != 200:
        die(f"bootstrap failed (HTTP {status}): {boot}")
    target = next((c for c in boot.get("clients", []) if c.get("id") == args.id or c.get("name", "").casefold() == args.id.casefold()), None)
    if not target:
        die(f"client not found: {args.id!r}; run `clients` to list clients")
    client_id = target["id"]
    payload = client_payload_from(target)
    for dest, key in CLIENT_FIELD_FLAGS:
        value = getattr(args, dest, None)
        if value is not None:
            payload[key] = value
    payload["metadata"] = metadata_from(args.meta, payload.get("metadata"))
    if getattr(args, "portal_password", None):
        payload["portalPassword"] = args.portal_password
    status, data = request(args.base, f"/api/clients/{client_id}", method="PUT", token=token, payload=payload)
    if status != 200:
        die(f"client-update failed (HTTP {status}): {data}")
    c = data.get("client", data)
    print(json.dumps({"id": c.get("id"), "name": c.get("name"), "email": c.get("email"),
                      "contact": " ".join(x for x in (c.get("contactFirstName"), c.get("contactLastName")) if x),
                      "phone": c.get("phone"), "website": c.get("website"),
                      "currency": c.get("currency"), "paymentMethod": c.get("paymentMethod"),
                      "model": c.get("billingModel"), "rateCents": c.get("defaultRateCents"),
                      "active": c.get("active")}, indent=2))


def cmd_client_delete(args):
    if not args.yes:
        die("client-delete requires --yes (destructive).")
    token = require_auth(args.base)
    status, data = request(args.base, f"/api/clients/{args.id}", method="DELETE", token=token)
    if status != 200:
        die(f"client-delete failed (HTTP {status}): {data}")
    print(json.dumps({"deleted": args.id, "ok": data.get("ok")}, indent=2))


def cmd_setup(args):
    """First-time setup: admin password + provider profile. Returns the one-time recovery code."""
    token = require_auth(args.base)  # ADMIN_TOKEN works pre-onboarding
    provider = None
    if any([args.business_name, args.provider_name, args.address, args.email,
            args.website, args.tax_id, args.remittance, args.logo_url is not None]):
        provider = {
            "businessName": args.business_name or "",
            "providerName": args.provider_name or "",
            "address": args.address or "",
            "email": args.email or "",
            "website": args.website or "",
            "taxId": args.tax_id or "",
            "remittance": args.remittance or "",
        }
        if args.logo_url is not None:
            provider["logoUrl"] = args.logo_url
    status, data = request(args.base, "/api/setup", method="POST", token=token,
                           payload={"password": args.admin_password, "provider": provider})
    if status != 200:
        die(f"setup failed (HTTP {status}): {data}")
    print(json.dumps({
        "status": "onboarded",
        "recoveryCode": data.get("recoveryCode"),
        "token": bool(data.get("token")),
    }, indent=2))
    print("\n⚠️  SAVE THIS RECOVERY CODE — it is shown ONCE: "
          f"{data.get('recoveryCode')}")


def cmd_settings_get(args):
    token = require_auth(args.base)
    status, boot = request(args.base, "/api/bootstrap", token=token)
    if status != 200:
        die(f"bootstrap failed (HTTP {status}): {boot}")
    print(json.dumps(boot.get("provider", {}), indent=2, default=str))


def cmd_settings_update(args):
    token = require_auth(args.base)
    status, boot = request(args.base, "/api/bootstrap", token=token)
    if status != 200:
        die(f"bootstrap failed (HTTP {status}): {boot}")
    p = boot.get("provider", {}) or {}
    if args.business_name is not None: p["businessName"] = args.business_name
    if args.provider_name is not None: p["providerName"] = args.provider_name
    if args.address is not None: p["address"] = args.address
    if args.email is not None: p["email"] = args.email
    if args.website is not None: p["website"] = args.website
    if args.tax_id is not None: p["taxId"] = args.tax_id
    if args.remittance is not None: p["remittance"] = args.remittance
    if args.logo_url is not None: p["logoUrl"] = args.logo_url
    theme = dict(p.get("theme") or {})
    if args.accent_color is not None: theme["accentColor"] = args.accent_color
    if args.font_family is not None: theme["fontFamily"] = args.font_family
    if args.header_style is not None: theme["headerStyle"] = args.header_style
    if theme:
        p["theme"] = theme
    status, data = request(args.base, "/api/settings", method="PUT", token=token, payload=p)
    if status != 200:
        die(f"settings-update failed (HTTP {status}): {data}")
    print(json.dumps(data.get("provider", data), indent=2, default=str))


def cmd_pdf(args):
    token = require_auth(args.base)
    data, err = request_bytes(args.base, f"/api/invoices/{args.id}/pdf", token=token)
    if data is None:
        die(f"pdf failed: {err}")
    out = args.out or f"INV-{args.id[:8]}.pdf"
    with open(out, "wb") as f:
        f.write(data)
    print(f"saved {len(data)} bytes → {os.path.abspath(out)}")


def cmd_invoice_delete(args):
    if not args.yes:
        die("invoice-delete requires --yes (destructive).")
    token = require_auth(args.base)
    status, data = request(args.base, f"/api/invoices/{args.id}", method="DELETE", token=token)
    if status != 200:
        die(f"invoice-delete failed (HTTP {status}): {data}")
    print(json.dumps({"deleted": args.id, "ok": data.get("ok")}, indent=2))


def cmd_backup(args):
    """Full agent backup: bootstrap JSON + every invoice's PDF."""
    import datetime
    token = require_auth(args.base)
    os.makedirs(args.out, exist_ok=True)
    status, boot = request(args.base, "/api/bootstrap", token=token)
    if status != 200:
        die(f"bootstrap failed (HTTP {status}): {boot}")
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = os.path.join(args.out, f"gitvoice-backup-{stamp}.json")
    with open(json_path, "w") as f:
        json.dump(boot, f, indent=2, default=str)
    manifest = []
    pdf_ok = pdf_fail = 0
    for inv in boot.get("invoices", []):
        inv_id = inv.get("id")
        if not inv_id:
            continue
        number = str(inv.get("number") or inv_id[:8]).replace("/", "-")
        try:
            data, err = request_bytes(args.base, f"/api/invoices/{inv_id}/pdf", token=token)
            if data is None:
                pdf_fail += 1
                manifest.append({"number": number, "id": inv_id, "pdf": f"SKIPPED: {err}"})
                continue
            pdf_path = os.path.join(args.out, f"{number}.pdf")
            with open(pdf_path, "wb") as f:
                f.write(data)
            pdf_ok += 1
            manifest.append({"number": number, "id": inv_id, "pdf": pdf_path})
        except Exception as e:
            pdf_fail += 1
            manifest.append({"number": number, "id": inv_id, "pdf": f"ERROR: {e}"})
    print(json.dumps({
        "json": json_path,
        "invoices": len(boot.get("invoices", [])),
        "pdfs_saved": pdf_ok,
        "pdfs_skipped": pdf_fail,
        "manifest": manifest,
    }, indent=2))


def cmd_portal_clients(args):
    status, data = request(args.base, "/api/portal/clients")
    if status != 200:
        die(f"portal-clients failed (HTTP {status}): {data}")
    print(f"provider: {data.get('provider', {}).get('businessName')}")
    for c in data.get("clients", []):
        print(f"{c.get('id',''):<40} {c.get('name','')}")


def portal_token_path():
    return os.path.join(STATE_DIR, "gitvoice-portal-token.json")


def cmd_portal_login(args):
    status, data = request(args.base, "/api/portal/auth", method="POST",
                           payload={"clientId": args.client_id, "password": args.password})
    if status != 200:
        die(f"portal-login failed (HTTP {status}): {data}")
    token = data.get("token")
    os.makedirs(STATE_DIR, exist_ok=True)
    json.dump({"base": args.base, "clientId": args.client_id, "token": token},
              open(portal_token_path(), "w"))
    os.chmod(portal_token_path(), 0o600)
    print(json.dumps({"client": data.get("client", {}).get("name"), "token": bool(token)}, indent=2))


def require_portal_token(base):
    if os.path.exists(portal_token_path()):
        cached = json.load(open(portal_token_path()))
        if cached.get("base") == base:
            return cached["token"]
    die("not logged into the portal for this base. Run `portal-login --client-id ID --password ...` first.")


def cmd_portal_invoices(args):
    token = require_portal_token(args.base)
    status, data = request(args.base, "/api/portal/invoices", token=token)
    if status != 200:
        die(f"portal-invoices failed (HTTP {status}): {data}")
    print(f"client: {data.get('client', {}).get('name')}")
    for inv in data.get("invoices", []):
        print(f"{inv.get('number',''):<12} {str(inv.get('periodStart',''))[:10]} → {str(inv.get('periodEnd',''))[:10]}  "
              f"{inv.get('currency','')} {inv.get('totalCents',0)/100:>10.2f}  {inv.get('status','')}  {inv.get('id','')}")




def cmd_watch(args):
    """Poll list and backup every --interval seconds."""
    token = require_auth(args.base)
    interval = int(getattr(args, "interval", 60) or 60)
    out = getattr(args, "out", None) or getattr(args, "out_dir", None) or "~/Backups/gitvoice-watch"
    print(f"watching {args.base} every {interval}s → {out} (Ctrl+C to stop)")
    try:
        while True:
            status, data = request(args.base, "/api/invoices", token=token)
            count = len((data or {}).get("invoices", []))
            print(f"[{time.strftime('%H:%M:%S')}] invoices: {count}")
            # trigger backup if --backup flag
            if getattr(args, "backup", False):
                try:
                    cmd_backup(type("A", (), {"base": args.base, "out": out})())
                except Exception as e:
                    print(f"backup error: {e}")
            time.sleep(interval)
    except KeyboardInterrupt:
        print("watch stopped")

def cmd_bulk_import(args):
    token = require_auth(args.base)
    rows = json.load(open(args.file))
    if not isinstance(rows, list):
        rows = rows.get("clients") or rows.get("data") or []
    status, data = request(args.base, "/api/clients/bulk", method="POST", token=token, payload={"clients": rows})
    print(json.dumps(data or {"status": status}, indent=2))

def cmd_discover(args):
    token = require_auth(args.base)
    status, data = request(args.base, "/api/clients/discover", method="POST", token=token, payload={"query": args.query})
    print(json.dumps(data or {"status": status}, indent=2))

def cmd_void(args):
    token = require_auth(args.base)
    status, data = request(args.base, f"/api/invoices/{args.id}/void", method="POST", token=token)
    print(json.dumps(data or {"status": status}, indent=2))

def cmd_reissue(args):
    token = require_auth(args.base)
    status, data = request(args.base, f"/api/invoices/{args.id}/reissue", method="POST", token=token)
    print(json.dumps(data or {"status": status}, indent=2))

def cmd_time_import(args):
    token = require_auth(args.base)
    entries = json.load(open(args.file))
    if isinstance(entries, dict):
        entries = entries.get("entries") or entries.get("data") or []
    status, data = request(args.base, f"/api/clients/{args.client_id}/time/import", method="POST", token=token, payload={"entries": entries})
    print(json.dumps(data or {"status": status}, indent=2))

def cmd_operators(args):
    token = require_auth(args.base)
    status, data = request(args.base, "/api/operators", token=token)
    print(json.dumps(data or {"status": status}, indent=2))


def cmd_operator_add(args):
    token = require_auth(args.base)
    payload = {"name": args.name, "role": args.role}
    if args.token:
        payload["token"] = args.token
    status, data = request(args.base, "/api/operators", method="POST", token=token, payload=payload)
    if status not in (200, 201):
        die(f"operator-add failed (HTTP {status}): {data}")
    # The operator's token is only ever returned here — it is stored hashed.
    print(json.dumps(data or {}, indent=2))


def cmd_time(args):
    token = require_auth(args.base)
    status, data = request(args.base, f"/api/clients/{args.client_id}/time", token=token)
    if status != 200:
        die(f"time failed (HTTP {status}): {data}")
    print(json.dumps(data or {}, indent=2, default=str))


def cmd_versions(args):
    token = require_auth(args.base)
    status, data = request(args.base, f"/api/invoices/{args.id}/versions", token=token)
    if status != 200:
        die(f"versions failed (HTTP {status}): {data}")
    print(json.dumps(data or {}, indent=2, default=str))


def cmd_notify(args):
    if not args.yes:
        die("notify requires --yes (emails the invoice to the client).")
    token = require_auth(args.base)
    status, data = request(args.base, f"/api/invoices/{args.id}/notify", method="POST", token=token)
    if status != 200:
        die(f"notify failed (HTTP {status}): {data}")
    print(json.dumps(data or {}, indent=2))


def cmd_mark_paid(args):
    """Record an e-transfer/wire payment. Omit --amount-cents to settle the remaining balance."""
    token = require_auth(args.base)
    payload = {"reference": args.reference or "", "channel": args.channel}
    if args.amount_cents is not None:
        payload["amountCents"] = args.amount_cents
    if args.paid_at:
        payload["paidAt"] = args.paid_at
    status, data = request(args.base, f"/api/invoices/{args.id}/paid", method="POST", token=token, payload=payload)
    if status != 200:
        die(f"mark-paid failed (HTTP {status}): {data}")
    inv = (data or {}).get("invoice", data) or {}
    print(json.dumps({"id": inv.get("id"), "number": inv.get("number"), "status": inv.get("status"),
                      "totalCents": inv.get("totalCents"), "amountPaidCents": inv.get("amountPaidCents"),
                      "balanceCents": inv.get("balanceCents"), "paidAt": inv.get("paidAt")}, indent=2, default=str))


def cmd_outstanding(args):
    token = require_auth(args.base)
    status, data = request(args.base, "/api/outstanding", token=token)
    if status != 200:
        die(f"outstanding failed (HTTP {status}): {data}")
    if args.json:
        print(json.dumps(data or {}, indent=2, default=str))
        return
    invoices = (data or {}).get("invoices", [])
    if not invoices:
        print("nothing outstanding")
        return
    for inv in invoices:
        print(f"{inv.get('number',''):<12} {str(inv.get('client','')):<24} "
              f"{inv.get('currency','')} {inv.get('balanceCents',0)/100:>10.2f}  "
              f"due {str(inv.get('dueAt',''))[:10]}  {inv.get('bucket',''):<8} {inv.get('id','')}")
    for currency, totals in ((data or {}).get("totals", {})).items():
        print(f"\n{currency} owed {totals.get('total',0)/100:.2f}  "
              f"(current {totals.get('current',0)/100:.2f} · 1-30 {totals.get('1-30',0)/100:.2f} · "
              f"31-60 {totals.get('31-60',0)/100:.2f} · 60+ {totals.get('60+',0)/100:.2f})")


def cmd_notes(args):
    token = require_auth(args.base)
    client_id = resolve_client_id(args.base, token, args.client_id)
    status, data = request(args.base, f"/api/clients/{client_id}/notes", token=token)
    if status != 200:
        die(f"notes failed (HTTP {status}): {data}")
    print(json.dumps(data or {}, indent=2, default=str))


def cmd_note_add(args):
    token = require_auth(args.base)
    client_id = resolve_client_id(args.base, token, args.client_id)
    status, data = request(args.base, f"/api/clients/{client_id}/notes", method="POST", token=token,
                           payload={"body": args.body, "author": args.author or ""})
    if status not in (200, 201):
        die(f"note-add failed (HTTP {status}): {data}")
    print(json.dumps(data or {}, indent=2, default=str))


def cmd_summary_patch(args):
    override = summary_override_from(args)
    if args.desc is not None:
        override["description"] = args.desc
    if not override:
        die("summary-patch needs at least one of --desc/--title/--overview/--highlight/--deliverable/--next-step/--summary-file.")
    token = require_auth(args.base)
    status, data = request(args.base, f"/api/invoices/{args.id}/summary", method="PATCH", token=token, payload=override)
    if status != 200:
        die(f"summary-patch failed (HTTP {status}): {data}")
    inv = (data or {}).get("invoice", {})
    print(json.dumps({"id": inv.get("id"), "number": inv.get("number"),
                      "version": inv.get("version"), "summary": inv.get("summary")}, indent=2, default=str))


def cmd_status(args):
    status, data = request(args.base, "/api/status")
    if status != 200:
        die(f"status failed (HTTP {status}): {data}")
    health_status, health = request(args.base, "/api/health")
    print(json.dumps({**(data or {}), "health": (health or {}).get("ok", health_status == 200)}, indent=2))


def cmd_recover(args):
    status, data = request(args.base, "/api/auth/recover", method="POST",
                           payload={"recoveryCode": args.recovery_code, "password": args.new_password})
    if status != 200:
        die(f"recover failed (HTTP {status}): {data}")
    print(json.dumps({"ok": True, "recoveryCode": data.get("recoveryCode")}, indent=2))


def cmd_portal_invoice(args):
    """The client's own view of one invoice — HTML by default, PDF with --pdf."""
    token = require_portal_token(args.base)
    path = f"/portal/invoices/{args.id}/pdf" if args.pdf else f"/portal/invoices/{args.id}"
    body, err = request_bytes(args.base, path, token=token)
    if body is None:
        die(f"portal-invoice failed: {err}")
    out = args.out or (f"INV-{args.id[:8]}.pdf" if args.pdf else None)
    if out:
        open(out, "wb").write(body)
        print(f"saved {len(body)} bytes → {os.path.abspath(out)}")
    else:
        print(body.decode("utf-8", "replace"))


def cmd_portal_dispute(args):
    if not args.yes:
        die("portal-dispute requires --yes (files a dispute on the invoice).")
    token = require_portal_token(args.base)
    status, data = request(args.base, f"/portal/invoices/{args.id}/dispute", method="POST",
                           token=token, payload={"reason": args.reason})
    if status not in (200, 201):
        die(f"portal-dispute failed (HTTP {status}): {data}")
    print(json.dumps(data or {}, indent=2, default=str))


def cmd_reset_password(args):
    base = args.base
    # Use adminToken directly without prior auth
    token = args.admin_token or keychain_secret()
    status, data = request(base, "/api/auth/reset", method="POST", payload={"adminToken": token, "password": args.new_password})
    if status != 200:
        die(f"reset failed (HTTP {status}): {data}")
    print(json.dumps({"ok": True, "recoveryCode": data.get("recoveryCode"), "token": bool(data.get("token"))}, indent=2))

def main():
    p = argparse.ArgumentParser(description="Gitvoice agent CLI")
    p.add_argument("--base", default=DEFAULT_BASE, help="worker base URL (default: prod)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("auth").add_argument("--force", action="store_true")
    sub.add_parser("logout")
    sub.add_parser("clients")

    se = sub.add_parser("setup")
    se.add_argument("--admin-password", required=True)
    se.add_argument("--business-name")
    se.add_argument("--provider-name")
    se.add_argument("--address")
    se.add_argument("--email")
    se.add_argument("--website")
    se.add_argument("--tax-id")
    se.add_argument("--remittance")
    se.add_argument("--logo-url")

    sub.add_parser("settings")
    su = sub.add_parser("settings-update")
    for name in ("--business-name", "--provider-name", "--address", "--email",
                 "--website", "--tax-id", "--remittance", "--logo-url",
                 "--accent-color", "--font-family"):
        su.add_argument(name)
    su.add_argument("--header-style", choices=["classic", "modern", "minimal"])

    pdd = sub.add_parser("pdf")
    pdd.add_argument("id")
    pdd.add_argument("--out")

    ide = sub.add_parser("invoice-delete")
    ide.add_argument("--id", required=True)
    ide.add_argument("--yes", action="store_true")

    bk = sub.add_parser("backup")
    bk.add_argument("--out", default=os.path.expanduser("~/Backups/gitvoice"))

    sub.add_parser("portal-clients")
    pl = sub.add_parser("portal-login")
    pl.add_argument("--client-id", required=True)
    pl.add_argument("--password", required=True)
    sub.add_parser("portal-invoices")
    w = sub.add_parser("watch")
    w.add_argument("--interval", type=int, default=60, help="poll interval seconds")
    w.add_argument("--out", default=os.path.expanduser("~/Backups/gitvoice-watch"))
    w.add_argument("--backup", action="store_true", help="run backup each interval")

    bi = sub.add_parser("bulk-import")
    bi.add_argument("--file", required=True, help="JSON file with array of clients")

    di = sub.add_parser("discover")
    di.add_argument("--query", required=True, help="GitHub org or user to scan")

    vo = sub.add_parser("void")
    vo.add_argument("--id", required=True)

    rp = sub.add_parser("reset-password")
    rp.add_argument("--admin-token")
    rp.add_argument("--new-password", required=True)
    re = sub.add_parser("reissue")
    re.add_argument("--id", required=True)

    ti = sub.add_parser("time-import")
    ti.add_argument("--client-id", required=True)
    ti.add_argument("--file", required=True, help="JSON file with time entries")

    sub.add_parser("operators")
    oa = sub.add_parser("operator-add")
    oa.add_argument("--name", required=True)
    oa.add_argument("--role", choices=["admin", "operator"], default="operator")
    oa.add_argument("--token", help="omit to have the worker mint one (shown once)")

    sub.add_parser("status")

    rc = sub.add_parser("recover")
    rc.add_argument("--recovery-code", required=True)
    rc.add_argument("--new-password", required=True)

    tl = sub.add_parser("time")
    tl.add_argument("--client-id", required=True)

    vs = sub.add_parser("versions")
    vs.add_argument("--id", required=True)

    nt = sub.add_parser("notify")
    nt.add_argument("--id", required=True)
    nt.add_argument("--yes", action="store_true")

    mp = sub.add_parser("mark-paid")
    mp.add_argument("--id", required=True)
    mp.add_argument("--amount-cents", type=int, help="omit to settle the full remaining balance")
    mp.add_argument("--reference", help="e-transfer confirmation, wire reference, cheque number")
    mp.add_argument("--channel", default="manual", help="etransfer, wire, cheque, …")
    mp.add_argument("--paid-at", help="ISO timestamp; defaults to now")

    ou = sub.add_parser("outstanding")
    ou.add_argument("--json", action="store_true")

    no = sub.add_parser("notes")
    no.add_argument("--client-id", required=True, help="client ID or exact name")

    na = sub.add_parser("note-add")
    na.add_argument("--client-id", required=True, help="client ID or exact name")
    na.add_argument("--body", required=True)
    na.add_argument("--author")

    sp = sub.add_parser("summary-patch")
    sp.add_argument("--id", required=True)
    sp.add_argument("--desc", help="replace the manual work description (pass \"\" to clear it)")
    add_summary_override_args(sp)

    pi = sub.add_parser("portal-invoice")
    pi.add_argument("--id", required=True)
    pi.add_argument("--pdf", action="store_true", help="fetch the PDF instead of the HTML")
    pi.add_argument("--out")

    pd = sub.add_parser("portal-dispute")
    pd.add_argument("--id", required=True)
    pd.add_argument("--reason", required=True)
    pd.add_argument("--yes", action="store_true")

    ca = sub.add_parser("client-add")
    ca.add_argument("--name", required=True, help="company billed on the invoice")
    ca.add_argument("--email", required=True)
    ca.add_argument("--first-name", help="person addressed at the company")
    ca.add_argument("--last-name")
    ca.add_argument("--phone")
    ca.add_argument("--address")
    ca.add_argument("--website")
    ca.add_argument("--github-repo", action="append", help="repeatable")
    ca.add_argument("--github-author")
    ca.add_argument("--project-context")
    ca.add_argument("--summary-priorities")
    ca.add_argument("--currency", default="CAD")
    ca.add_argument("--payment-method", choices=PAYMENT_METHODS, default="wire")
    ca.add_argument("--payment-days", type=int, default=0)
    ca.add_argument("--payment-terms", default="Due on receipt")
    ca.add_argument("--cadence", default="manual")
    ca.add_argument("--billing-day", type=int, default=1)
    ca.add_argument("--tax-rate", type=float, default=0)
    ca.add_argument("--special-terms", default="")
    ca.add_argument("--model", choices=["hourly", "flat"], default="hourly")
    ca.add_argument("--rate-cents", type=int, default=0)
    ca.add_argument("--portal-password")
    ca.add_argument("--meta", action="append", help="key=value, repeatable; agent-set fields never shown on the invoice")
    cu = sub.add_parser("client-update")
    cu.add_argument("--id", required=True)
    cu.add_argument("--name", help="company billed on the invoice")
    cu.add_argument("--email")
    cu.add_argument("--first-name", help="person addressed at the company")
    cu.add_argument("--last-name")
    cu.add_argument("--phone")
    cu.add_argument("--address")
    cu.add_argument("--website")
    cu.add_argument("--github-repo", action="append", help="repeatable")
    cu.add_argument("--github-author")
    cu.add_argument("--project-context")
    cu.add_argument("--summary-priorities")
    cu.add_argument("--currency")
    cu.add_argument("--payment-method", choices=PAYMENT_METHODS)
    cu.add_argument("--payment-days", type=int)
    cu.add_argument("--payment-terms")
    cu.add_argument("--cadence")
    cu.add_argument("--billing-day", type=int)
    cu.add_argument("--tax-rate", type=float)
    cu.add_argument("--special-terms")
    cu.add_argument("--model", choices=["hourly", "flat"])
    cu.add_argument("--rate-cents", type=int)
    cu.add_argument("--active", type=lambda s: s.lower() in ("1", "true", "yes"))
    cu.add_argument("--portal-password")
    cu.add_argument("--meta", action="append", help="key=value, repeatable; merged onto existing metadata")
    cd = sub.add_parser("client-delete")
    cd.add_argument("--id", required=True)
    cd.add_argument("--yes", action="store_true")
    for cmd in ("preview", "create"):
        ip = sub.add_parser(cmd)
        for name in ("--client", "--start", "--end"):
            ip.add_argument(name, required=True)
        ip.add_argument("--desc", help="manual work description; omit to summarize the client's GitHub activity")
        ip.add_argument("--source", choices=["github", "manual"], help="default: manual when --desc is given, else github")
        ip.add_argument("--hours", type=float)
        ip.add_argument("--rate-cents", type=int)
        ip.add_argument("--amount-cents", type=int)
        add_summary_override_args(ip)
        if cmd == "create":
            ip.add_argument("--yes", action="store_true")
    ge = sub.add_parser("get")
    ge.add_argument("id")
    ge.add_argument("--html", action="store_true", help="print the rendered invoice HTML instead of JSON")
    ge.add_argument("--out", help="with --html, write to this file")
    sub.add_parser("list")

    args = p.parse_args()
    fn = {"auth": cmd_auth, "logout": cmd_logout, "clients": cmd_clients, "client-add": cmd_client_add,
          "client-update": cmd_client_update, "client-delete": cmd_client_delete,
          "setup": cmd_setup, "settings": cmd_settings_get, "settings-update": cmd_settings_update,
          "preview": cmd_preview, "create": cmd_create, "get": cmd_get, "pdf": cmd_pdf,
          "list": cmd_list, "invoice-delete": cmd_invoice_delete, "backup": cmd_backup,
          "portal-clients": cmd_portal_clients, "portal-login": cmd_portal_login,
          "portal-invoices": cmd_portal_invoices,
          "watch": cmd_watch, "bulk-import": cmd_bulk_import, "discover": cmd_discover,
          "reset-password": cmd_reset_password,
          "void": cmd_void, "reissue": cmd_reissue, "time-import": cmd_time_import,
          "operators": cmd_operators, "operator-add": cmd_operator_add,
          "status": cmd_status, "recover": cmd_recover, "time": cmd_time,
          "versions": cmd_versions, "notify": cmd_notify,
          "mark-paid": cmd_mark_paid, "outstanding": cmd_outstanding,
          "notes": cmd_notes, "note-add": cmd_note_add,
          "summary-patch": cmd_summary_patch, "portal-dispute": cmd_portal_dispute,
          "portal-invoice": cmd_portal_invoice}[args.cmd]
    fn(args)


if __name__ == "__main__":
    main()
