import { mkdir, writeFile } from "node:fs/promises";
import { renderInvoiceHtml } from "../dist/src/invoice.js";

const commits = Array.from({ length: 24 }, (_, index) => ({
  sha: `sample-${index}`,
  repo: "acme/product",
  message: index % 3 === 0 ? `feat: ship workflow ${index + 1}` : index % 3 === 1 ? `fix: tighten validation ${index + 1}` : `refactor: simplify state ${index + 1}`,
  date: `2026-04-${String(28 - Math.floor(index / 4)).padStart(2, "0")}T12:00:00Z`,
  author: "octocat",
  url: "https://github.com/acme/product",
  additions: 30 + index,
  deletions: 8,
  files: ["src/app.ts", "src/styles.css"],
}));

const invoice = {
  id: "sample-invoice",
  number: "INV-2026-0002",
  status: "generated",
  provider: { businessName: "Gitvoice", providerName: "Jane Doe", address: "123 Main St.\nSpringfield, IL 62704\nUnited States.", email: "billing@example.com", website: "", taxId: "", remittance: "International wire transfer or direct deposit details available on request.", logoUrl: "" },
  client: { id: "acme", name: "Acme Inc.", email: "billing@acme.example", address: "456 Market St\nSan Francisco, CA 94105\nUnited States.", githubRepos: ["acme/product"], githubAuthor: "", cadence: "monthly", billingDay: 1, billingModel: "flat", defaultRateCents: 400000, currency: "USD", paymentMethod: "wire", paymentTerms: "Due on receipt", paymentDays: 0, specialTerms: "Phase two retainer", taxRate: 0, active: true },
  periodStart: "2026-04-01",
  periodEnd: "2026-04-28",
  issuedAt: "2026-04-28T12:00:00Z",
  dueAt: "2026-04-28T12:00:00Z",
  currency: "USD",
  subtotalCents: 400000,
  taxCents: 0,
  totalCents: 400000,
  pricing: { model: "flat", amountCents: 400000, description: "Flat project fee" },
  summary: { title: "Phase Two: Platform delivery", overview: "A focused delivery period across the client portal and the supporting AI stack.", activitySummary: "24 commits changed 22 files (+1000 / -190) across 1 repository. Contributor: octocat.", highlights: ["Web development", "Collaborative asset development", "Imagery and video production", "AI-based stack integration"], deliverables: ["Client portal workflows", "Responsive interface refinements", "Content and media support"], nextSteps: [], timeline: [{ period: "Apr 1 - Apr 7", title: "Foundation work", detail: "Set up the client portal structure and initial workflow components.", commits: 7 }, { period: "Apr 8 - Apr 14", title: "Feature work", detail: "Shipped workflow updates and expanded validation coverage.", commits: 6 }, { period: "Apr 15 - Apr 21", title: "Improvements work", detail: "Refined state handling and tightened the interface behavior.", commits: 6 }, { period: "Apr 22 - Apr 28", title: "Delivery work", detail: "Completed the final workflow pass and prepared the portal for review.", commits: 5 }], source: "fallback" },
  activity: { commits, repositories: ["acme/product"], additions: 1000, deletions: 190, filesChanged: 22, contributors: ["octocat"] },
};

await mkdir("output/pdf", { recursive: true });
await writeFile("output/sample-invoice.html", renderInvoiceHtml(invoice));
console.log("Wrote output/sample-invoice.html");
