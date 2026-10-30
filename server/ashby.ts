import { createHash } from "node:crypto";
import type { Job, Profile } from "./types.js";
import { scoreJob } from "./scoring.js";

interface AshbyPosting {
  title?: string;
  location?: string;
  department?: string;
  team?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl?: string;
  isListed?: boolean;
}

interface AshbyResponse {
  jobs: AshbyPosting[];
}

function displayCompany(board: string): string {
  return board.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

export async function fetchAshbyJobs(
  board: string,
  profile: Profile,
  withinHours: number,
  fetcher: typeof fetch = fetch,
): Promise<Job[]> {
  const response = await fetcher(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error(`Ashby board ${board} returned HTTP ${response.status}`);
  const payload = (await response.json()) as AshbyResponse;
  if (!Array.isArray(payload.jobs)) throw new Error(`Ashby board ${board} returned an invalid jobs response`);

  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;
  const now = new Date().toISOString();
  const company = displayCompany(board);

  return payload.jobs
    .filter((posting) => {
      const timestamp = posting.publishedAt ? Date.parse(posting.publishedAt) : NaN;
      return posting.isListed !== false && Number.isFinite(timestamp) && timestamp >= cutoff;
    })
    .filter((posting) => posting.title && posting.jobUrl && posting.publishedAt)
    .map((posting) => {
      const location = posting.location ?? "";
      const description = posting.descriptionPlain || plainText(posting.descriptionHtml ?? "");
      const id = createHash("sha256")
        .update(`${company}|${posting.title}|${location}`.toLowerCase())
        .digest("hex");
      return {
        id,
        source: "Ashby",
        company,
        title: posting.title!,
        location,
        description,
        url: posting.jobUrl!,
        postedAt: posting.publishedAt!,
        score: scoreJob({ title: posting.title!, description, location, company }, profile),
        status: "Found",
        discoveredAt: now,
        updatedAt: now,
      };
    });
}
