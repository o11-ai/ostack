import { OstackError } from "../../lib/errors.ts";

/** Shared mailbox providers; a lead's email domain here says nothing about their company. */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export function normalizeEmail(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OstackError("invalid_email", `Not an email address: ${value}`);
  }
  return email;
}

export function normalizeLinkedin(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new OstackError("invalid_linkedin", `Not a LinkedIn URL: ${value}`);
  }
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !path) {
    throw new OstackError("invalid_linkedin", `Not a LinkedIn profile URL: ${value}`);
  }
  return `https://www.linkedin.com${path}`;
}

export function normalizeDomain(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim().toLowerCase();
  let host: string;
  try {
    host = raw.includes("://") ? new URL(raw).hostname : raw.split("/")[0]!;
  } catch {
    throw new OstackError("invalid_domain", `Not a domain: ${value}`);
  }
  host = host.replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new OstackError("invalid_domain", `Not a domain: ${value}`);
  return host;
}

export function companyDomainFromEmail(email: string | null): string | null {
  const domain = email?.split("@")[1];
  return domain && !PERSONAL_EMAIL_DOMAINS.has(domain) ? domain : null;
}
