import { createHash } from "node:crypto";
import type { Profile, Job } from "./types.js";
import { scoreJob } from "./scoring.js";

interface GreenhousePosting {
  id: number;
  title: string;
  updated_at?: string;
  absolute_url: string;
  content?: string;
  location?: { name?: string };
  departments?: Array<{ name: string }>;
}

interface GreenhouseResponse {
  jobs: GreenhousePosting[];
}

export async function fetchGreenhouseJobs(
  boardSlug: string,
  profile: Profile,
  withinHours: number,
  fetcher: typeof fetch = fetch,
): Promise<Job[]> {
  const response = await fetcher(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardSlug)}/jobs?content=true`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error(`Greenhouse board ${boardSlug} returned HTTP ${response.status}`);
  const payload = (await response.json()) as GreenhouseResponse;
  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;
  const now = new Date().toISOString();

  return payload.jobs
    .filter((posting) => {
      const timestamp = posting.updated_at ? Date.parse(posting.updated_at) : NaN;
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    })
    .map((posting) => {
      const company = boardSlug
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
      const location = posting.location?.name ?? "";
      const description = posting.content?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? "";
      const id = createHash("sha256")
        .update(`${company}|${posting.title}|${location}`.toLowerCase())
        .digest("hex");
      return {
        id,
        source: "Greenhouse",
        company,
        title: posting.title,
        location,
        description,
        url: posting.absolute_url,
        postedAt: posting.updated_at ?? null,
        score: scoreJob({ title: posting.title, description, location, company }, profile),
        status: "Found",
        discoveredAt: now,
        updatedAt: now,
      };
    });
}
