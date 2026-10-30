import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import {
  clickAndVerifyMockSubmission,
  createResumePdf,
  ApplicationFlow,
  prepareMockApplication,
  type ApplicantAnswers,
} from "./application.js";

test("fills and submits only the safe mock form after the missing answer is supplied", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <form>
        <label>First name <input name="firstName" required></label>
        <label>Last name <input name="lastName" required></label>
        <label>Email <input name="email" type="email" required></label>
        <label>Resume <input name="resume" type="file" required></label>
        <label>Why are you interested? <textarea name="reason" required></textarea></label>
        <button type="submit" aria-label="Submit application">Submit application</button>
        <p id="result"></p>
      </form>
      <script>
        document.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          document.querySelector("#result").textContent = "Application received. Thank you!";
        });
      </script>
    `);
    const profile: ApplicantAnswers = {
      fullName: "Jordan Lee",
      email: "jordan@example.com",
      phone: "555-0100",
      workAuthorization: "Authorized to work in the United States",
      locations: ["San Francisco"],
      salaryMin: null,
      salaryMax: null,
      coverLetter: "",
    };
    const resumePdf = await createResumePdf("Jordan Lee\nProduct Designer – Figma • accessibility");
    assert.equal(resumePdf.subarray(0, 4).toString(), "%PDF");
    const paused = await prepareMockApplication(page, profile, resumePdf);
    assert.equal(paused.state, "Needs input");
    assert.deepEqual(paused.missing, ["Why are you interested?"]);

    const prepared = await prepareMockApplication(page, profile, resumePdf, {
      "Why are you interested?": "My resume describes my product design experience.",
    });
    assert.equal(prepared.state, "Ready");
    assert.equal(await page.locator('[name="firstName"]').inputValue(), "Jordan");
    assert.equal(await page.locator('[name="lastName"]').inputValue(), "Lee");
    assert.equal(await page.locator('[name="email"]').inputValue(), "jordan@example.com");
    assert.equal(prepared.summary.fields.find((field) => field.kind === "resume")?.value, "tailored-resume.pdf");
    assert.equal(await clickAndVerifyMockSubmission(page), true);
  } finally {
    await browser.close();
  }
});

test("live application preparation is disabled by default", async () => {
  const flow = new ApplicationFlow(false);
  const result = await flow.prepare(
    { id: "job-id", source: "Greenhouse", title: "Designer", url: "https://boards.greenhouse.io/acme/jobs/1" },
    {
      fullName: "",
      email: "",
      phone: "",
      workAuthorization: "",
      locations: [],
      salaryMin: null,
      salaryMax: null,
      coverLetter: "",
    },
    { originalResume: "Source resume", tailoredResume: "Source resume", gaps: [], answers: [], coverLetter: "" },
    {},
  );
  assert.equal(result.state, "Needs input");
  assert.match(result.reason ?? "", /disabled/i);
});

test("only one application preparation can run for a job at a time", async () => {
  const flow = new ApplicationFlow(false);
  const job = { id: "job-id", source: "Greenhouse", title: "Designer", url: "https://boards.greenhouse.io/acme/jobs/1" };
  const profile: ApplicantAnswers = {
    fullName: "",
    email: "",
    phone: "",
    workAuthorization: "",
    locations: [],
    salaryMin: null,
    salaryMax: null,
    coverLetter: "",
  };
  const draft = { originalResume: "Source resume", tailoredResume: "Source resume", gaps: [], answers: [], coverLetter: "" };
  const results = await Promise.allSettled([
    flow.prepare(job, profile, draft, {}),
    flow.prepare(job, profile, draft, {}),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});
