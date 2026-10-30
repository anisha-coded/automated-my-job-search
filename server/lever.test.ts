import assert from "node:assert/strict";
import test from "node:test";
import { fetchLeverJobs } from "./lever.js";
import { fetchGreenhouseJobs } from "./greenhouse.js";
import { emptyProfile } from "./types.js";

test("Lever source applies freshness filtering and deduplicates with Greenhouse IDs", async () => {
  const createdAt = Date.now() - 30 * 60 * 1000;
  const profile = { ...emptyProfile, targetRoles: ["Product Designer"], skills: ["Figma", "prototyping"] };
  const greenhouseFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        jobs: [{
          id: 1,
          title: "Product Designer",
          updated_at: new Date(createdAt).toISOString(),
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          content: "<p>Figma and prototyping</p>",
          location: { name: "Remote" },
        }],
      }),
      { status: 200 },
    );
  const leverFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify([{
        id: "lever-id",
        text: "Product Designer",
        createdAt,
        hostedUrl: "https://jobs.lever.co/acme/1",
        descriptionPlain: "Figma and prototyping",
        categories: { location: "Remote" },
      }]),
      { status: 200 },
    );
  const greenhouse = await fetchGreenhouseJobs("acme", profile, 24, greenhouseFetch);
  const lever = await fetchLeverJobs("acme", profile, 24, leverFetch);
  assert.equal(lever.length, 1);
  assert.equal(lever[0]?.source, "Lever");
  assert.equal(lever[0]?.id, greenhouse[0]?.id);
});
