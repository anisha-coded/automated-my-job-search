import cors from "cors";
import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { submissionBlockReason } from "./approval.js";
import { db } from "./db.js";
import { ApplicationFlow, type ApplicationSummary } from "./application.js";
import { createDraft, type DraftMaterial } from "./drafting.js";
import { fetchGreenhouseJobs } from "./greenhouse.js";
import { fetchLeverJobs } from "./lever.js";
import { parseResume } from "./parseResume.js";
import { emptyProfile, type Job, type Profile } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const withinHours = Number(process.env.POSTED_WITHIN_HOURS ?? 24);
const intervalMinutes = Number(process.env.SEARCH_INTERVAL_MINUTES ?? 30);
const boards = (process.env.GREENHOUSE_BOARDS ?? "")
  .split(",")
  .map((board) => board.trim())
  .filter(Boolean);
const leverSites = (process.env.LEVER_SITES ?? "")
  .split(",")
  .map((site) => site.trim())
  .filter(Boolean);
const applicationFlow = new ApplicationFlow();

app.use(cors({ origin: "http://127.0.0.1:5173" }));
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_request, file, callback) => {
    const supportedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (supportedTypes.includes(file.mimetype)) callback(null, true);
    else {
      const error = new Error("Only PDF and DOCX files are supported.");
      error.name = "UnsupportedMediaType";
      callback(error);
    }
  },
});

const profileSchema = z.object({
  fullName: z.string().default(""),
  email: z.string().email().or(z.literal("")).default(""),
  phone: z.string().default(""),
  targetRoles: z.array(z.string().trim().min(1)).default([]),
  locations: z.array(z.string().trim().min(1)).default([]),
  remotePreference: z.enum(["any", "remote", "hybrid", "onsite"]).default("any"),
  salaryMin: z.number().nullable().default(null),
  salaryMax: z.number().nullable().default(null),
  minYearsExperience: z.number().nullable().default(null),
  maxYearsExperience: z.number().nullable().default(null),
  workAuthorization: z.string().default(""),
  excludedCompanies: z.array(z.string().trim().min(1)).default([]),
  skills: z.array(z.string().trim().min(1)).default([]),
  experience: z.array(z.object({ title: z.string(), company: z.string(), dates: z.string() })).default([]),
  achievements: z.array(z.string()).default([]),
  coverLetterTemplate: z.string().default(""),
});

type ProfileRow = { data: string; resume_text: string; resume_filename: string | null };

function readProfile(): { profile: Profile; resumeFilename: string | null; hasResume: boolean } {
  const row = db.prepare("SELECT data, resume_text, resume_filename FROM profile WHERE id = 1").get() as
    | ProfileRow
    | undefined;
  return {
    profile: row ? profileSchema.parse(JSON.parse(row.data)) : emptyProfile,
    resumeFilename: row?.resume_filename ?? null,
    hasResume: Boolean(row?.resume_text),
  };
}

function saveProfile(profile: Profile, resumeText?: string, resumeFilename?: string): void {
  const previous = db.prepare("SELECT resume_text, resume_filename FROM profile WHERE id = 1").get() as
    | Pick<ProfileRow, "resume_text" | "resume_filename">
    | undefined;
  db.prepare(
    `INSERT INTO profile (id, data, resume_text, resume_filename, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data,
       resume_text = excluded.resume_text, resume_filename = excluded.resume_filename,
       updated_at = excluded.updated_at`,
  ).run(
    JSON.stringify(profile),
    resumeText ?? previous?.resume_text ?? "",
    resumeFilename ?? previous?.resume_filename ?? null,
    new Date().toISOString(),
  );
}

function sendUpdate(event: string, data: unknown): void {
  for (const client of clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const clients = new Set<Response>();
app.get("/events", (_request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  response.write("event: connected\ndata: {}\n\n");
  clients.add(response);
  response.on("close", () => clients.delete(response));
});

app.get("/api/health", (_request, response) => response.json({ ok: true }));

app.get("/api/profile", (_request, response) => response.json(readProfile()));

app.put("/api/profile", (request, response, next) => {
  const result = profileSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: "Profile details are invalid.", details: result.error.flatten() });
    return;
  }
  try {
    saveProfile(result.data);
    sendUpdate("profile", { updatedAt: new Date().toISOString() });
    response.json(readProfile());
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/profile/resume",
  upload.fields([{ name: "resume", maxCount: 1 }, { name: "coverLetter", maxCount: 1 }]),
  async (request, response, next) => {
    try {
      const files = request.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const resume = files?.resume?.[0];
      const coverLetter = files?.coverLetter?.[0];
      if (!resume && !coverLetter) {
        response.status(400).json({ error: "Choose a resume or cover letter template to upload." });
        return;
      }
      const parsed = resume ? await parseResume(resume.buffer, resume.mimetype, resume.originalname) : undefined;
      const parsedCover = coverLetter
        ? await parseResume(coverLetter.buffer, coverLetter.mimetype, coverLetter.originalname)
        : undefined;
      const { profile } = readProfile();
      const updatedProfile: Profile = {
        ...profile,
        skills: parsed?.skills ?? profile.skills,
        experience: parsed?.experience ?? profile.experience,
        achievements: parsed?.achievements ?? profile.achievements,
        coverLetterTemplate: parsedCover?.text ?? profile.coverLetterTemplate,
      };
      saveProfile(updatedProfile, parsed?.text, resume?.originalname);
      sendUpdate("profile", { updatedAt: new Date().toISOString() });
      response.json({ ...readProfile(), parsed: parsed ?? null });
    } catch (error) {
      next(error);
    }
  },
);

function mapJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    source: String(row.source),
    company: String(row.company),
    title: String(row.title),
    location: String(row.location),
    description: String(row.description),
    url: String(row.url),
    postedAt: row.posted_at ? String(row.posted_at) : null,
    score: Number(row.score),
    status: String(row.status),
    discoveredAt: String(row.discovered_at),
    updatedAt: String(row.updated_at),
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    attemptState: row.attempt_state ? String(row.attempt_state) : null,
  };
}

app.get("/api/jobs", (_request, response) => {
  const rows = db
    .prepare(`SELECT jobs.*, application_attempts.state AS attempt_state
      FROM jobs LEFT JOIN application_attempts ON application_attempts.job_id = jobs.id
      WHERE jobs.score > 7 ORDER BY jobs.posted_at DESC, jobs.discovered_at DESC`)
    .all() as Record<string, unknown>[];
  response.json(rows.map(mapJob));
});

function mapDraft(row: Record<string, unknown>): DraftMaterial {
  return {
    originalResume: String(row.original_resume),
    tailoredResume: String(row.tailored_resume),
    gaps: JSON.parse(String(row.gaps)) as string[],
    answers: JSON.parse(String(row.answers)) as Array<{ question: string; answer: string }>,
    coverLetter: String(row.cover_letter),
  };
}

app.get("/api/jobs/:id/draft", (request, response) => {
  const row = db.prepare("SELECT * FROM drafts WHERE job_id = ?").get(request.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    response.status(404).json({ error: "No materials have been drafted for this role yet." });
    return;
  }
  response.json({ ...mapDraft(row), updatedAt: row.updated_at });
});

app.post("/api/jobs/:id/draft", (request, response, next) => {
  try {
    if (isAutomationPaused()) {
      response.status(423).json({ error: "Automation is paused. Resume it before drafting application materials." });
      return;
    }
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(request.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!job) {
      response.status(404).json({ error: "This job could not be found." });
      return;
    }
    const attempt = db.prepare("SELECT state FROM application_attempts WHERE job_id = ?").get(request.params.id) as
      | { state: string }
      | undefined;
    if (job.submitted_at || job.approved_at || attempt?.state === "Submitting" || attempt?.state === "Unconfirmed") {
      response.status(409).json({ error: "This application cannot be redrafted in its current state." });
      return;
    }
    const storedResume = db.prepare("SELECT resume_text FROM profile WHERE id = 1").get() as
      | { resume_text: string }
      | undefined;
    if (!storedResume?.resume_text) {
      response.status(409).json({ error: "Upload a readable resume before drafting materials." });
      return;
    }
    const { profile } = readProfile();
    const material = createDraft(
      { title: String(job.title), company: String(job.company), description: String(job.description) },
      profile,
      storedResume.resume_text,
    );
    const now = new Date().toISOString();
    const resumeVersion = createHash("sha256").update(storedResume.resume_text).digest("hex");
    db.prepare(
      `INSERT INTO drafts (job_id, original_resume, tailored_resume, gaps, answers, cover_letter, resume_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET original_resume = excluded.original_resume,
         tailored_resume = excluded.tailored_resume, gaps = excluded.gaps, answers = excluded.answers,
         cover_letter = excluded.cover_letter, resume_version = excluded.resume_version, updated_at = excluded.updated_at`,
    ).run(
      request.params.id,
      material.originalResume,
      material.tailoredResume,
      JSON.stringify(material.gaps),
      JSON.stringify(material.answers),
      material.coverLetter,
      resumeVersion,
      now,
      now,
    );
    db.prepare("UPDATE jobs SET status = 'Drafted', updated_at = ? WHERE id = ?").run(now, request.params.id);
    recordJobEvent(request.params.id, "Drafted", `Materials drafted from resume ${resumeVersion.slice(0, 12)}.`, now);
    sendUpdate("jobs", { updated: request.params.id });
    response.json({ ...material, updatedAt: now });
  } catch (error) {
    next(error);
  }
});

app.put("/api/jobs/:id/draft", async (request, response, next) => {
  const result = z.object({
    tailoredResume: z.string().min(1).max(100_000),
    coverLetter: z.string().max(20_000),
  }).safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: "Draft materials are invalid.", details: result.error.flatten() });
    return;
  }
  try {
    const job = db.prepare("SELECT status, submitted_at FROM jobs WHERE id = ?").get(request.params.id) as
      | { status: string; submitted_at: string | null }
      | undefined;
    if (!job) {
      response.status(404).json({ error: "This job could not be found." });
      return;
    }
    if (job.submitted_at) {
      response.status(409).json({ error: "Submitted application materials cannot be changed." });
      return;
    }
    const previousAttempt = db.prepare("SELECT state, resume_version FROM application_attempts WHERE job_id = ?")
      .get(request.params.id) as { state: string; resume_version: string } | undefined;
    if (previousAttempt?.state === "Submitting" || previousAttempt?.state === "Unconfirmed") {
      response.status(409).json({ error: "This application cannot be edited while submission is in progress or unconfirmed." });
      return;
    }
    const now = new Date().toISOString();
    const updateDraft = db.transaction(() => {
      const update = db.prepare(
        "UPDATE drafts SET tailored_resume = ?, cover_letter = ?, updated_at = ? WHERE job_id = ?",
      ).run(result.data.tailoredResume, result.data.coverLetter, now, request.params.id);
      if (update.changes === 0) return false;
      db.prepare("UPDATE jobs SET status = 'Drafted', approved_at = NULL, updated_at = ? WHERE id = ?")
        .run(now, request.params.id);
      if (previousAttempt) saveAttempt(request.params.id, "Drafted", {}, previousAttempt.resume_version);
      recordJobEvent(request.params.id, "Drafted", "Materials edited by the user.", now);
      return true;
    });
    if (!updateDraft()) {
      response.status(404).json({ error: "Draft materials could not be found." });
      return;
    }
    await applicationFlow.close(request.params.id);
    sendUpdate("jobs", { updated: request.params.id });
    response.json({ updatedAt: now });
  } catch (error) {
    next(error);
  }
});

function isAutomationPaused(): boolean {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'automation_paused'").get() as
    | { value: string }
    | undefined;
  return row?.value === "1";
}

function recordJobEvent(jobId: string, status: string, details: string, timestamp = new Date().toISOString()): void {
  db.prepare("INSERT INTO job_events (job_id, status, details, created_at) VALUES (?, ?, ?, ?)")
    .run(jobId, status, details, timestamp);
}

function saveAttempt(
  jobId: string,
  state: string,
  summary: unknown,
  resumeVersion: string,
  error = "",
): void {
  db.prepare(
    `INSERT INTO application_attempts (job_id, state, summary, resume_version, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET state = excluded.state, summary = excluded.summary,
       resume_version = excluded.resume_version, error = excluded.error, updated_at = excluded.updated_at`,
  ).run(jobId, state, JSON.stringify(summary), resumeVersion, error, new Date().toISOString());
}

function applicantFrom(profile: Profile, coverLetter: string) {
  return {
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    workAuthorization: profile.workAuthorization,
    locations: profile.locations,
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    coverLetter,
  };
}

app.post("/api/jobs/:id/approve", async (request, response, next) => {
  const result = z.object({
    confirmedTruthful: z.literal(true),
    answers: z.record(z.string(), z.string()).default({}),
  }).safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: "Review the materials and confirm their accuracy before approval." });
    return;
  }
  if (isAutomationPaused()) {
    response.status(423).json({ error: "Automation is paused. Resume it before preparing an application." });
    return;
  }

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(request.params.id) as
    | Record<string, unknown>
    | undefined;
  const draftRow = db.prepare("SELECT * FROM drafts WHERE job_id = ?").get(request.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!job || !draftRow) {
    response.status(404).json({ error: "Create a draft for this job before approving it." });
    return;
  }
  if (Number(job.score) <= 7) {
    response.status(409).json({ error: "Only roles scoring above 7 can enter the review and application flow." });
    return;
  }
  if (job.status === "Submitted" || job.submitted_at) {
    response.status(409).json({ error: "This application has already been submitted." });
    return;
  }
  const previousAttempt = db.prepare("SELECT state FROM application_attempts WHERE job_id = ?").get(request.params.id) as
    | { state: string }
    | undefined;
  if (previousAttempt?.state === "Unconfirmed") {
    response.status(409).json({ error: "Submission status is unconfirmed. Verify the posting manually before any further action." });
    return;
  }
  if (previousAttempt?.state === "Submitting") {
    response.status(409).json({ error: "This application is already being submitted." });
    return;
  }

  const now = new Date().toISOString();
  if (!job.approved_at) {
    db.prepare("UPDATE jobs SET approved_at = ?, status = 'Approved', updated_at = ? WHERE id = ?")
      .run(now, now, request.params.id);
    recordJobEvent(request.params.id, "Approved", "User approved the reviewed application materials.", now);
  }

  try {
    const { profile } = readProfile();
    const mappedJob = mapJob(job);
    const material = mapDraft(draftRow);
    const prepared = await applicationFlow.prepare(
      { id: mappedJob.id, source: mappedJob.source, title: mappedJob.title, url: mappedJob.url },
      applicantFrom(profile, material.coverLetter),
      material,
      result.data.answers,
    );
    const summary = { ...prepared.summary, missing: prepared.missing, reason: prepared.reason ?? "" };
    const state = prepared.state === "Ready" ? "Ready" : "Needs input";
    saveAttempt(request.params.id, state, summary, String(draftRow.resume_version || draftRow.created_at));
    if (prepared.state === "Needs input") {
      db.prepare("UPDATE jobs SET status = 'Needs input', updated_at = ? WHERE id = ?").run(new Date().toISOString(), request.params.id);
      recordJobEvent(request.params.id, "Needs input", prepared.reason ?? "Application form needs review.");
    } else {
      db.prepare("UPDATE jobs SET status = 'Approved', updated_at = ? WHERE id = ?").run(new Date().toISOString(), request.params.id);
      recordJobEvent(request.params.id, "Approved", "Application form prepared for final review.");
    }
    sendUpdate("jobs", { updated: request.params.id });
    response.json({ state, summary, missing: prepared.missing, reason: prepared.reason ?? "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The application form could not be prepared.";
    const failedSummary: ApplicationSummary = {
      posting: String(job.title),
      postingUrl: String(job.url),
      resumeFilename: "tailored-resume.pdf",
      resumeSha256: "",
      fields: [],
      missing: [],
      reason: message,
    };
    saveAttempt(request.params.id, "Failed", failedSummary, String(draftRow.resume_version || draftRow.created_at), message);
    db.prepare("UPDATE jobs SET status = 'Needs input', updated_at = ? WHERE id = ?").run(new Date().toISOString(), request.params.id);
    recordJobEvent(request.params.id, "Needs input", `Application preparation failed: ${message}`);
    sendUpdate("jobs", { updated: request.params.id });
    next(error);
  }
});

app.post("/api/jobs/:id/submit", async (request, response, next) => {
  const job = db.prepare("SELECT status, approved_at, submitted_at FROM jobs WHERE id = ?").get(request.params.id) as
    | { status: string; approved_at: string | null; submitted_at: string | null }
    | undefined;
  const attempt = db.prepare("SELECT state, summary, resume_version FROM application_attempts WHERE job_id = ?").get(request.params.id) as
    | { state: string; summary: string; resume_version: string }
    | undefined;
  if (!job || !attempt) {
    response.status(409).json({ error: "The application is not prepared for submission." });
    return;
  }
  const blockReason = submissionBlockReason({
    confirmed: request.body?.confirm === true,
    automationPaused: isAutomationPaused(),
    status: job?.status ?? null,
    approvedAt: job?.approved_at ?? null,
    submittedAt: job?.submitted_at ?? null,
    attemptState: attempt?.state ?? null,
  });
  if (blockReason) {
    response.status(blockReason.includes("paused") ? 423 : blockReason.includes("confirmation") ? 400 : 409).json({ error: blockReason });
    return;
  }

  try {
    const claimed = db.prepare(
      "UPDATE application_attempts SET state = 'Submitting', updated_at = ? WHERE job_id = ? AND state = 'Ready'",
    ).run(new Date().toISOString(), request.params.id);
    if (claimed.changes !== 1) {
      response.status(409).json({ error: "This application is already being submitted or is no longer ready." });
      return;
    }
    const outcome = await applicationFlow.submit(request.params.id);
    const status = outcome.submitted ? "Submitted" : "Needs input";
    const now = new Date().toISOString();
    const summary = JSON.parse(attempt.summary) as ApplicationSummary & { missing?: string[]; reason?: string };
    saveAttempt(
      request.params.id,
      outcome.submitted ? "Submitted" : outcome.uncertain ? "Unconfirmed" : "Needs input",
      summary,
      attempt.resume_version,
      outcome.submitted ? "" : outcome.message,
    );
    db.prepare("UPDATE jobs SET status = ?, submitted_at = ?, updated_at = ? WHERE id = ?")
      .run(status, outcome.submitted ? now : null, now, request.params.id);
    recordJobEvent(request.params.id, status, outcome.message, now);
    sendUpdate("jobs", { updated: request.params.id });
    response.json({ status, message: outcome.message, submitted: outcome.submitted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Submission did not complete.";
    saveAttempt(request.params.id, "Failed", JSON.parse(attempt.summary), attempt.resume_version, message);
    recordJobEvent(request.params.id, "Needs input", `Submission failed: ${message}`);
    next(error);
  }
});

app.post("/api/jobs/:id/confirm-submitted", (request, response) => {
  if (request.body?.confirm !== true) {
    response.status(400).json({ error: "Confirm only after verifying the application on the original posting." });
    return;
  }
  const job = db.prepare("SELECT status, submitted_at FROM jobs WHERE id = ?").get(request.params.id) as
    | { status: string; submitted_at: string | null }
    | undefined;
  const attempt = db.prepare("SELECT state, summary, resume_version FROM application_attempts WHERE job_id = ?").get(request.params.id) as
    | { state: string; summary: string; resume_version: string }
    | undefined;
  if (!job || !attempt || job.status !== "Needs input" || attempt.state !== "Unconfirmed" || job.submitted_at) {
    response.status(409).json({ error: "Only an unconfirmed submission can be manually verified." });
    return;
  }
  const now = new Date().toISOString();
  saveAttempt(request.params.id, "Submitted", JSON.parse(attempt.summary), attempt.resume_version);
  db.prepare("UPDATE jobs SET status = 'Submitted', submitted_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, request.params.id);
  recordJobEvent(request.params.id, "Submitted", "User manually verified the application on the original posting.", now);
  sendUpdate("jobs", { updated: request.params.id });
  response.json({ status: "Submitted", submittedAt: now });
});

app.patch("/api/jobs/:id/status", async (request, response, next) => {
  const result = z.object({
    status: z.enum(["Skipped", "Saved for later", "Interview", "Rejected", "Offer"]),
  }).safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: "That status change is not allowed." });
    return;
  }
  const job = db.prepare(
    `SELECT jobs.status, jobs.submitted_at, application_attempts.state AS attempt_state
     FROM jobs LEFT JOIN application_attempts ON application_attempts.job_id = jobs.id
     WHERE jobs.id = ?`,
  ).get(request.params.id) as
    | { status: string; submitted_at: string | null; attempt_state: string | null }
    | undefined;
  if (!job) {
    response.status(404).json({ error: "This job could not be found." });
    return;
  }
  if (job.attempt_state === "Submitting") {
    response.status(409).json({ error: "The application status cannot change while submission is in progress." });
    return;
  }
  if (job.attempt_state === "Unconfirmed") {
    response.status(409).json({ error: "Verify the unconfirmed submission before changing its status." });
    return;
  }
  if (["Submitted", "Interview", "Rejected", "Offer"].includes(job.status) && ["Skipped", "Saved for later"].includes(result.data.status)) {
    response.status(409).json({ error: "Submitted applications cannot be skipped or saved for later." });
    return;
  }
  if (["Interview", "Rejected", "Offer"].includes(result.data.status) && !["Submitted", "Interview"].includes(job.status)) {
    response.status(409).json({ error: "Only submitted applications can move to a response status." });
    return;
  }
  try {
    const now = new Date().toISOString();
    db.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?").run(result.data.status, now, request.params.id);
    recordJobEvent(request.params.id, result.data.status, `Status changed to ${result.data.status}.`, now);
    if (["Skipped", "Saved for later"].includes(result.data.status)) {
      await applicationFlow.close(request.params.id);
    }
    sendUpdate("jobs", { updated: request.params.id });
    response.json({ status: result.data.status, updatedAt: now });
  } catch (error) {
    next(error);
  }
});

app.get("/api/applications", (_request, response) => {
  const rows = db.prepare(
    `SELECT e.id, e.job_id AS jobId, e.status, e.details, e.created_at AS createdAt,
      j.company, j.title, j.url
     FROM job_events e JOIN jobs j ON j.id = e.job_id
     ORDER BY e.created_at DESC LIMIT 100`,
  ).all();
  response.json(rows);
});

app.get("/api/jobs/:id/application", (request, response) => {
  const row = db.prepare("SELECT state, summary, error, resume_version AS resumeVersion, updated_at AS updatedAt FROM application_attempts WHERE job_id = ?")
    .get(request.params.id) as { state: string; summary: string; error: string; resumeVersion: string; updatedAt: string } | undefined;
  if (!row) {
    response.status(404).json({ error: "No application attempt exists for this role." });
    return;
  }
  response.json({ ...row, summary: JSON.parse(row.summary) });
});

app.get("/api/settings", (_request, response) => {
  response.json({ automationPaused: isAutomationPaused() });
});

app.put("/api/settings/automation", async (request, response, next) => {
  const result = z.object({ paused: z.boolean() }).safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: "Provide a true or false pause setting." });
    return;
  }
  db.prepare("UPDATE app_settings SET value = ? WHERE key = 'automation_paused'").run(result.data.paused ? "1" : "0");
  if (result.data.paused) {
    try {
      await applicationFlow.closeAll();
    } catch (error) {
      next(error);
      return;
    }
  }
  sendUpdate("settings", { automationPaused: result.data.paused });
  response.json({ automationPaused: result.data.paused });
});

app.get("/api/dashboard", (_request, response) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = db
    .prepare("SELECT COUNT(*) AS count FROM jobs WHERE discovered_at >= ? AND score > 7")
    .get(today.toISOString()) as { count: number };
  const pending = db
    .prepare("SELECT COUNT(*) AS count FROM jobs WHERE score > 7 AND posted_at >= ? AND status IN ('Found', 'Drafted', 'Approved', 'Needs input')")
    .get(new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString()) as { count: number };
  const statuses = db.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status").all();
  const submitted = db
    .prepare("SELECT COUNT(*) AS count FROM jobs WHERE submitted_at IS NOT NULL")
    .get() as { count: number };
  const responses = db
    .prepare("SELECT COUNT(*) AS count FROM jobs WHERE status IN ('Interview', 'Rejected', 'Offer')")
    .get() as { count: number };
  const latestRun = db.prepare("SELECT value FROM app_settings WHERE key = 'last_run_at'").get() as
    | { value: string }
    | undefined;
  const configuredSources = boards.length + leverSites.length;
  response.json({
    newMatchesToday: todayCount.count,
    pendingReviews: pending.count,
    submitted: submitted.count,
    responseRate: submitted.count === 0 ? null : Math.round((responses.count / submitted.count) * 100),
    statuses,
    configuredSources,
    postedWithinHours: withinHours,
    lastRunAt: latestRun?.value ?? lastRunAt,
    automationPaused: isAutomationPaused(),
  });
});

let lastRunAt: string | null = null;
let running = false;

async function syncJobs(): Promise<number> {
  if (isAutomationPaused()) return 0;
  if (running) return 0;
  running = true;
  let inserted = 0;
  let newMatches = 0;
  try {
    const { profile } = readProfile();
    const sources = [
      ...boards.map((board) => () => fetchGreenhouseJobs(board, profile, withinHours)),
      ...leverSites.map((site) => () => fetchLeverJobs(site, profile, withinHours)),
    ];
    for (const loadSource of sources) {
      const jobs = await loadSource();
      const upsert = db.prepare(
        `INSERT INTO jobs (id, source, company, title, location, description, url, posted_at, score, status, discovered_at, updated_at)
         VALUES (@id, @source, @company, @title, @location, @description, @url, @postedAt, @score, @status, @discoveredAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET description = excluded.description,
           posted_at = excluded.posted_at, score = excluded.score, updated_at = excluded.updated_at`,
      );
      const applyJob = db.transaction((items: Job[]) => {
        for (const job of items) {
          const isNew = !db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(job.id);
          upsert.run(job);
          if (isNew) {
            inserted += 1;
            recordJobEvent(job.id, "Found", `New ${job.source} posting discovered.`);
            if (job.score > 7) newMatches += 1;
          }
        }
      });
      applyJob(jobs);
    }
    lastRunAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('last_run_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(lastRunAt);
    if (inserted > 0) sendUpdate("jobs", { inserted, matches: newMatches });
    return inserted;
  } finally {
    running = false;
  }
}

async function syncWithRetry(): Promise<void> {
  if (isAutomationPaused()) return;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await syncJobs();
      return;
    } catch (error) {
      console.error(`Job search attempt ${attempt}/3 failed:`, error);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
}

app.post("/api/jobs/sync", async (_request, response, next) => {
  if (isAutomationPaused()) {
    response.status(423).json({ error: "Automation is paused. Resume it before searching." });
    return;
  }
  try {
    const inserted = await syncJobs();
    response.json({ inserted, lastRunAt });
  } catch (error) {
    next(error);
  }
});

const errorHandler = (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error("API request failed:", message);
  const status =
    error instanceof multer.MulterError || (error instanceof Error && error.name === "UnsupportedMediaType")
      ? 400
      : 500;
  response.status(status).json({ error: message });
};
app.use(errorHandler);

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Local job search API listening on http://127.0.0.1:${port}`);
  void syncWithRetry();
});
const timer = setInterval(() => void syncWithRetry(), intervalMinutes * 60 * 1000);
timer.unref();
server.on("close", () => clearInterval(timer));
