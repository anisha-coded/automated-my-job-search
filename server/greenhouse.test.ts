import assert from "node:assert/strict";
import test from "node:test";
import { fetchGreenhouseJobs } from "./greenhouse.js";
import { emptyProfile } from "./types.js";

test("keeps recent Greenhouse jobs and scores them against the profile", async () => {
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        jobs: [
          {
            id: 1,
            title: "Product Designer",
            updated_at: recent,
            absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
            content: "<p>Figma and prototyping</p>",
            location: { name: "Remote" },
          },
          {
            id: 2,
            title: "Product Designer",
            updated_at: old,
            absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
            content: "Figma and prototyping",
            location: { name: "Remote" },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const jobs = await fetchGreenhouseJobs(
    "acme-inc",
    { ...emptyProfile, targetRoles: ["Product Designer"], skills: ["Figma", "prototyping"], remotePreference: "remote" },
    24,
    fetcher,
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.company, "Acme Inc");
  assert.equal(jobs[0]?.score, 8);
});
