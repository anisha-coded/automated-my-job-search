import { createHash } from "node:crypto";
import type { Profile, Job } from "./types.js";
import { scoreJob } from "./scoring.js";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  descriptionPlain?: string;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
  };
}

function displayCompany(site: string): string {
  return site.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function fetchLeverJobs(
  site: string,
  profile: Profile,
  withinHours: number,
  fetcher: typeof fetch = fetch,
): Promise<Job[]> {
  const response = await fetcher(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Lever site ${site} returned HTTP ${response.status}`);
  const postings = (await response.json()) as LeverPosting[];
  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;
  const now = new Date().toISOString();
  const company = displayCompany(site);

  return postings
    .filter((posting) => typeof posting.createdAt === "number" && posting.createdAt >= cutoff)
    .map((posting) => {
      const location = posting.categories?.location ?? "";
      const description = posting.descriptionPlain ?? "";
      const id = createHash("sha256")
        .update(`${company}|${posting.text}|${location}`.toLowerCase())
        .digest("hex");
      return {
        id,
        source: "Lever",
        company,
        title: posting.text,
        location,
        description,
        url: posting.hostedUrl,
        postedAt: new Date(posting.createdAt!).toISOString(),
        score: scoreJob({ title: posting.text, description, location, company }, profile),
        status: "Found",
        discoveredAt: now,
        updatedAt: now,
      };
    });
}
