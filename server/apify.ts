import { createHash } from "node:crypto";
import type { Job, Profile } from "./types.js";
import { scoreJob } from "./scoring.js";

type ApifyRecord = Record<string, unknown>;

const fieldAliases = {
  title: ["title", "jobTitle", "job_title", "position", "text"],
  company: ["company", "companyName", "company_name", "employer", "hiringOrganization"],
  location: ["location", "jobLocation", "job_location", "locationName", "jobLocationName"],
  url: ["url", "jobUrl", "job_url", "link", "jobLink", "externalUrl", "applyUrl"],
  description: ["descriptionPlain", "descriptionText", "description", "jobDescription", "job_description"],
  postedAt: ["postedAt", "posted_at", "postedDate", "datePosted", "publishedAt", "published_at", "createdAt", "created_at", "date"],
} as const;

function findField(record: ApifyRecord, names: readonly string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && record[name] !== "") return record[name];
  }
  return undefined;
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as ApifyRecord;
    for (const key of ["name", "text", "value", "description"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
    const parts = [record.city, record.region, record.country].filter((part) => typeof part === "string");
    if (parts.length) return parts.join(", ");
  }
  return "";
}

function timestamp(value: unknown): number {
  if (typeof value === "number" || (typeof value === "string" && /^\d{10,13}$/.test(value.trim()))) {
    const numeric = Number(value);
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  if (typeof value !== "string") return NaN;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return date;
  const relative = value.match(/^\s*(\d+)\s+(minute|hour)s?\s+ago\s*$/i);
  if (relative) {
    const unitMs = relative[2]!.toLowerCase() === "hour" ? 60 * 60 * 1000 : 60 * 1000;
    return Date.now() - Number(relative[1]) * unitMs;
  }
  if (/^\s*(just now|today)\s*$/i.test(value)) return Date.now();
  return NaN;
}

function plainText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchApifyJobs(
  source: string,
  actorId: string,
  input: Record<string, unknown>,
  apiToken: string,
  profile: Profile,
  withinHours: number,
  fetcher: typeof fetch = fetch,
  maxItems = 500,
  maxTotalChargeUsd = 5,
): Promise<Job[]> {
  const url = new URL(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`,
  );
  url.searchParams.set("format", "json");
  url.searchParams.set("clean", "true");
  url.searchParams.set("timeout", "300");
  url.searchParams.set("maxItems", String(maxItems));
  url.searchParams.set("maxTotalChargeUsd", String(maxTotalChargeUsd));
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(310_000),
  });
  if (!response.ok) throw new Error(`${source} Apify actor ${actorId} returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error(`${source} Apify actor ${actorId} returned an invalid dataset`);

  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;
  const now = new Date().toISOString();
  const jobs: Job[] = [];
  let validRecords = 0;
  for (const item of payload) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as ApifyRecord;
    const title = text(findField(record, fieldAliases.title));
    const company = text(findField(record, fieldAliases.company));
    const location = text(findField(record, fieldAliases.location));
    const jobUrl = text(findField(record, fieldAliases.url));
    const posted = timestamp(findField(record, fieldAliases.postedAt));
    if (!title || !company || !jobUrl || !Number.isFinite(posted)) continue;
    validRecords += 1;
    if (posted < cutoff || posted > Date.now()) continue;

    const description = plainText(text(findField(record, fieldAliases.description)));
    const id = createHash("sha256")
      .update(`${company}|${title}|${location}`.toLowerCase())
      .digest("hex");
    jobs.push({
      id,
      source,
      company,
      title,
      location,
      description,
      url: jobUrl,
      postedAt: new Date(posted).toISOString(),
      score: scoreJob({ title, description, location, company }, profile),
      status: "Found",
      discoveredAt: now,
      updatedAt: now,
    });
  }
  if (payload.length > 0 && validRecords === 0) {
    throw new Error(`${source} Apify actor output did not include recognizable jobs with publication dates`);
  }
  return jobs;
}
