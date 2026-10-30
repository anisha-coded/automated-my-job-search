import assert from "node:assert/strict";
import test from "node:test";
import { createDraft } from "./drafting.js";
import { emptyProfile } from "./types.js";

test("tailored resume only reorders text from the original and reports uncovered skills", () => {
  const resume = [
    "Jordan Lee",
    "jordan@example.com",
    "",
    "SUMMARY",
    "Product designer who builds thoughtful digital experiences.",
    "",
    "EXPERIENCE",
    "Product Designer | Acme | 2021–Present",
    "Built a Figma design system used by four product teams.",
    "Led customer research and usability testing.",
    "",
    "EDUCATION",
    "Bachelor of Design | Example University",
  ].join("\n");
  const draft = createDraft(
    {
      title: "Senior Product Designer",
      company: "Example Co",
      description: "Figma, usability testing, prototyping, and 5 years of experience.",
    },
    { ...emptyProfile, fullName: "Jordan Lee", skills: ["Figma", "usability testing"], maxYearsExperience: 4 },
    resume,
  );
  assert.deepEqual(
    [...draft.tailoredResume.split("\n")].sort(),
    [...resume.split("\n")].sort(),
  );
  assert.ok(draft.gaps.some((gap) => gap.includes("prototyping")));
  assert.ok(draft.gaps.some((gap) => gap.includes("5 years")));
  assert.ok(draft.coverLetter.includes("Product Designer"));
});
