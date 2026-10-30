import assert from "node:assert/strict";
import test from "node:test";
import { scoreJob } from "./scoring.js";
import { emptyProfile } from "./types.js";

test("scores a close role by title, skills, and location", () => {
  const score = scoreJob(
    {
      title: "Senior Product Designer",
      description: "Figma, prototyping, accessibility",
      location: "Remote — United States",
      company: "Acme",
    },
    {
      ...emptyProfile,
      targetRoles: ["Product Designer"],
      skills: ["Figma", "prototyping"],
      remotePreference: "remote",
    },
  );
  assert.equal(score, 8);
});

test("excludes companies and does not award role points for unrelated titles", () => {
  const profile = { ...emptyProfile, targetRoles: ["Product Designer"], excludedCompanies: ["Acme"] };
  assert.equal(
    scoreJob({ title: "Engineer", description: "", location: "Remote", company: "Acme" }, profile),
    0,
  );
  assert.equal(
    scoreJob({ title: "Engineer", description: "", location: "Remote", company: "Other" }, profile),
    2,
  );
});

test("reduces fit when the experience requirement exceeds the selected range", () => {
  const job = {
    title: "Senior Product Designer",
    description: "Requires 4 years of experience. Figma and prototyping.",
    location: "Remote",
    company: "Other",
  };
  const profile = {
    ...emptyProfile,
    targetRoles: ["Product Designer"],
    skills: ["Figma", "prototyping"],
    maxYearsExperience: 5,
    remotePreference: "remote" as const,
  };
  assert.equal(scoreJob(job, profile), 8);
  assert.equal(scoreJob(job, { ...profile, maxYearsExperience: 3 }), 7);
});
