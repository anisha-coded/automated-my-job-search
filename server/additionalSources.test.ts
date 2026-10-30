import assert from "node:assert/strict";
import test from "node:test";
import { fetchApifyJobs } from "./apify.js";
import { fetchAshbyJobs } from "./ashby.js";
import { emptyProfile } from "./types.js";

test("Ashby connector filters by published date and maps public board postings", async () => {
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const fetcher: typeof fetch = async (input) => {
    assert.match(String(input), /api\.ashbyhq\.com\/posting-api\/job-board\/acme/);
    return new Response(JSON.stringify({
      jobs: [
        {
          title: "Product Designer",
          location: "Remote",
          descriptionHtml: "<p>Figma &amp; prototyping</p>",
          publishedAt: recent,
          jobUrl: "https://jobs.ashbyhq.com/acme/job-1",
        },
        {
          title: "Product Designer",
          location: "Remote",
          publishedAt: old,
          jobUrl: "https://jobs.ashbyhq.com/acme/job-2",
        },
        {
          title: "Product Designer",
          location: "Remote",
          publishedAt: recent,
          jobUrl: "https://jobs.ashbyhq.com/acme/job-3",
          isListed: false,
        },
      ],
    }), { status: 200 });
  };
  const jobs = await fetchAshbyJobs(
    "acme",
    { ...emptyProfile, targetRoles: ["Product Designer"], skills: ["Figma", "prototyping"], remotePreference: "remote" },
    24,
    fetcher,
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.source, "Ashby");
  assert.equal(jobs[0]?.company, "Acme");
  assert.equal(jobs[0]?.description, "Figma & prototyping");
  assert.equal(jobs[0]?.score, 8);
});

test("Apify connector sends its token privately and normalizes recent jobs", async () => {
  const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("maxItems"), "500");
    assert.equal(url.searchParams.get("maxTotalChargeUsd"), "5");
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-token");
    assert.deepEqual(JSON.parse(String(init?.body)), { searchQuery: "product designer" });
    return new Response(JSON.stringify([
      {
        title: "Product Designer",
        companyName: "Acme",
        location: { city: "Remote" },
        job_url: "https://example.com/jobs/1",
        postedAt: recent,
        description: "<p>Figma and prototyping</p>",
      },
      {
        title: "Product Designer",
        companyName: "Acme",
        location: "Remote",
        job_url: "https://example.com/jobs/2",
        postedAt: old,
      },
      {
        title: "Product Designer",
        companyName: "Acme",
        location: "Remote",
        job_url: "https://example.com/jobs/3",
      },
    ]), { status: 200 });
  };
  const jobs = await fetchApifyJobs(
    "LinkedIn",
    "provider~job-search",
    { searchQuery: "product designer" },
    "secret-token",
    { ...emptyProfile, targetRoles: ["Product Designer"], skills: ["Figma", "prototyping"], remotePreference: "remote" },
    24,
    fetcher,
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.source, "LinkedIn");
  assert.equal(jobs[0]?.score, 8);
  assert.match(jobs[0]?.description ?? "", /Figma and prototyping/);
});

test("Apify connector fails clearly when actor dataset shape is unsupported", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify([{ id: "unknown" }]), { status: 200 });
  await assert.rejects(
    fetchApifyJobs("Indeed", "provider~actor", {}, "token", emptyProfile, 24, fetcher),
    /did not include recognizable jobs with publication dates/,
  );
});
