import { createHash } from "node:crypto";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DraftMaterial } from "./drafting.js";

export interface ApplicationField {
  label: string;
  value: string;
  kind: "text" | "select" | "resume" | "cover-letter";
}

export interface ApplicationSummary {
  posting: string;
  postingUrl: string;
  resumeFilename: string;
  resumeSha256: string;
  coverLetterFilename?: string;
  coverLetterSha256?: string;
  fields: ApplicationField[];
  missing?: string[];
  reason?: string;
}

export interface PrepareResult {
  state: "Ready" | "Needs input";
  summary: ApplicationSummary;
  missing: string[];
  reason?: string;
}

export interface ApplicantAnswers {
  fullName: string;
  email: string;
  phone: string;
  workAuthorization: string;
  locations: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  coverLetter: string;
}

interface FormField {
  label: string;
  type: string;
  tag: string;
  accept: string;
  required: boolean;
  options: string[];
}

const activeSessions = new Map<string, { browser: Browser; page?: Page; timer?: NodeJS.Timeout }>();
const fileName = "tailored-resume.pdf";
const coverLetterFileName = "cover-letter.pdf";

export async function createResumePdf(text: string): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const lineHeight = 14;
  const margin = 52;
  const pageSize: [number, number] = [612, 792];
  let page = document.addPage(pageSize);
  let y = pageSize[1] - margin;
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const words = rawLine.split(/\s+/);
    let line = "";
    const wrapped: string[] = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) > pageSize[0] - margin * 2 && line) {
        wrapped.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    wrapped.push(line);
    for (const wrappedLine of wrapped) {
      if (y < margin) {
        page = document.addPage(pageSize);
        y = pageSize[1] - margin;
      }
      if (wrappedLine) {
        page.drawText(wrappedLine, { x: margin, y, size: fontSize, font, color: rgb(0.13, 0.17, 0.14) });
      }
      y -= lineHeight;
    }
  }
  return Buffer.from(await document.save());
}

function isAllowedHost(url: string, source: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    const roots = source === "Greenhouse" ? ["greenhouse.io"] : source === "Lever" ? ["lever.co"] : [];
    return roots.some((root) => host === root || host.endsWith(`.${root}`));
  } catch {
    return false;
  }
}

function applicantValue(label: string, profile: ApplicantAnswers): string | null {
  const normalized = label.toLowerCase();
  if (/\b(first|given)\s+name\b/.test(normalized)) return profile.fullName.trim().split(/\s+/)[0] || null;
  if (/\b(last|family|surname)\s+name\b/.test(normalized)) {
    const parts = profile.fullName.trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : null;
  }
  if (/e-?mail/.test(normalized)) return profile.email || null;
  if (/phone|telephone|mobile/.test(normalized)) return profile.phone || null;
  if (/full name|your name/.test(normalized)) return profile.fullName || null;
  if (/work authorization|authorized to work|visa sponsorship/.test(normalized)) {
    return profile.workAuthorization || null;
  }
  if (/desired salary|salary expectation|compensation/.test(normalized)) {
    return profile.salaryMin !== null && profile.salaryMax !== null
      ? `${profile.salaryMin}-${profile.salaryMax}`
      : null;
  }
  if (/\blocation\b|city|country/.test(normalized)) {
    return profile.locations.length === 1 ? profile.locations[0]! : null;
  }
  if (/cover letter|letter of interest/.test(normalized)) return profile.coverLetter || null;
  return null;
}

async function getApplicationForm(page: Page) {
  const forms = page.locator("form");
  const formCount = await forms.count();
  let firstForm: { form: Locator; fields: Locator } | null = null;
  for (let index = 0; index < formCount; index += 1) {
    const form = forms.nth(index);
    const fields = form.locator("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select");
    if ((await fields.count()) === 0) continue;
    if (!firstForm) firstForm = { form, fields };
    if ((await form.locator('input[type="file"]').count()) > 0) return { form, fields };
  }
  return firstForm;
}

async function fillApplicationForm(
  page: Page,
  profile: ApplicantAnswers,
  resumePdf: Buffer,
  coverLetterPdf: Buffer,
  posting: { title: string; url: string },
  suppliedAnswers: Record<string, string>,
): Promise<PrepareResult> {
  const form = await getApplicationForm(page);
  const summary: ApplicationSummary = {
    posting: posting.title,
    postingUrl: posting.url,
    resumeFilename: fileName,
    resumeSha256: createHash("sha256").update(resumePdf).digest("hex"),
    fields: [],
  };
  if (coverLetterPdf.length > 0) {
    summary.coverLetterFilename = coverLetterFileName;
    summary.coverLetterSha256 = createHash("sha256").update(coverLetterPdf).digest("hex");
  }
  if (!form) {
    return {
      state: "Needs input",
      summary,
      missing: [],
      reason: "No recognizable application form was found. Review the posting manually.",
    };
  }

  const descriptors = (await form.fields.evaluateAll((elements) =>
    elements.map((element) => {
      const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const label =
        Array.from(field.labels ?? []).map((item) => item.textContent?.trim() ?? "").filter(Boolean).join(" ") ||
        field.getAttribute("aria-label") ||
        field.getAttribute("placeholder") ||
        field.getAttribute("name") ||
        field.id ||
        "Unlabeled application field";
      return {
        label,
        type: field instanceof HTMLInputElement ? field.type.toLowerCase() : field.tagName.toLowerCase(),
        tag: field.tagName.toLowerCase(),
        accept: field instanceof HTMLInputElement ? field.accept : "",
        required: field.required || field.getAttribute("aria-required") === "true",
        options:
          field instanceof HTMLSelectElement
            ? Array.from(field.options).map((option) => option.textContent?.trim() ?? "").filter(Boolean)
            : [],
      };
    }),
  )) as FormField[];
  const missing: string[] = [];

  for (let index = 0; index < descriptors.length; index += 1) {
    const field = descriptors[index]!;
    const locator = form.fields.nth(index);
    const label = field.label.trim();

    if (field.type === "file") {
      if (/resume|curriculum vitae|\bcv\b/i.test(label)) {
        if (field.accept && !/pdf|\*/i.test(field.accept)) {
          missing.push(label);
          summary.fields.push({ label, value: "NEEDS MY INPUT — PDF is not accepted by this form", kind: "text" });
        } else {
          await locator.setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: resumePdf });
          summary.fields.push({ label: label || "Resume attachment", value: fileName, kind: "resume" });
        }
      } else if (/cover letter|letter of interest/i.test(label) && coverLetterPdf.length > 0) {
        await locator.setInputFiles({ name: coverLetterFileName, mimeType: "application/pdf", buffer: coverLetterPdf });
        summary.fields.push({ label, value: `${coverLetterFileName}\n${profile.coverLetter}`, kind: "cover-letter" });
      } else {
        missing.push(label);
        summary.fields.push({ label, value: "NEEDS MY INPUT", kind: "text" });
      }
      continue;
    }

    if (field.type === "checkbox" || field.type === "radio") {
      missing.push(label);
      summary.fields.push({ label, value: "NEEDS MY INPUT", kind: "text" });
      continue;
    }

    const supplied = suppliedAnswers[label]?.trim();
    const value = supplied || applicantValue(label, profile);
    if (!value) {
      missing.push(label);
      summary.fields.push({ label, value: "NEEDS MY INPUT", kind: field.tag === "select" ? "select" : "text" });
      continue;
    }

    if (field.tag === "select") {
      const option = field.options.find((item) => item.toLowerCase() === value.toLowerCase());
      if (!option) {
        missing.push(label);
        summary.fields.push({ label, value: "NEEDS MY INPUT", kind: "select" });
        continue;
      }
      await locator.selectOption({ label: option });
      summary.fields.push({ label, value: option, kind: "select" });
    } else {
      await locator.fill(value);
      summary.fields.push({ label, value, kind: "text" });
    }
  }

  return { state: missing.length === 0 ? "Ready" : "Needs input", summary, missing };
}

export async function prepareMockApplication(
  page: Page,
  profile: ApplicantAnswers,
  resumePdf: Buffer,
  answers: Record<string, string> = {},
): Promise<PrepareResult> {
  return fillApplicationForm(
    page,
    profile,
    resumePdf,
    Buffer.alloc(0),
    { title: "Safe mock role", url: "http://127.0.0.1/mock-form" },
    answers,
  );
}

export async function clickAndVerifyMockSubmission(page: Page): Promise<boolean> {
  const submit = page.getByRole("button", { name: /submit application/i });
  if ((await submit.count()) !== 1) return false;
  await submit.click();
  return /application received|thank you/i.test(await page.locator("body").innerText());
}

async function challengeDetected(page: Page, text: string): Promise<boolean> {
  if (/captcha|recaptcha|hcaptcha|verify (?:that )?you(?:'re| are) human/i.test(text)) return true;
  if (page.frames().some((frame) => /captcha/i.test(frame.url()))) return true;
  return (await page.locator('[class*="captcha" i], [id*="captcha" i]').count()) > 0;
}

export class ApplicationFlow {
  private readonly preparing = new Set<string>();

  constructor(private readonly liveEnabled = process.env.ENABLE_BROWSER_APPLICATIONS === "true") {}

  async prepare(
    job: { id: string; source: string; title: string; url: string },
    profile: ApplicantAnswers,
    draft: DraftMaterial,
    answers: Record<string, string>,
  ): Promise<PrepareResult> {
    if (this.preparing.has(job.id)) throw new Error("Application preparation is already in progress for this role.");
    this.preparing.add(job.id);
    try {
      return await this.prepareOnce(job, profile, draft, answers);
    } finally {
      this.preparing.delete(job.id);
    }
  }

  private async prepareOnce(
    job: { id: string; source: string; title: string; url: string },
    profile: ApplicantAnswers,
    draft: DraftMaterial,
    answers: Record<string, string>,
  ): Promise<PrepareResult> {
    await this.close(job.id);
    const emptySummary: ApplicationSummary = {
      posting: job.title,
      postingUrl: job.url,
      resumeFilename: fileName,
      resumeSha256: "",
      fields: [],
    };
    if (!isAllowedHost(job.url, job.source)) {
      return {
        state: "Needs input",
        summary: emptySummary,
        missing: [],
        reason: "This site's application flow is not enabled. Continue manually; no page was opened.",
      };
    }
    if (!this.liveEnabled) {
      return {
        state: "Needs input",
        summary: emptySummary,
        missing: [],
        reason: "Live browser applications are disabled. Verify the site's terms, then enable them in local configuration or apply manually.",
      };
    }

    const resumePdf = await createResumePdf(draft.tailoredResume);
    const coverLetterPdf = draft.coverLetter ? await createResumePdf(draft.coverLetter) : Buffer.alloc(0);
    const browser = await chromium.launch({ headless: true });
    const timer = setTimeout(() => {
      void this.close(job.id).catch((error: unknown) => {
        console.error("Could not close expired application page:", error instanceof Error ? error.message : "unknown error");
      });
    }, 15 * 60 * 1000);
    timer.unref();
    activeSessions.set(job.id, { browser, timer });
    try {
      const page = await browser.newPage();
      activeSessions.set(job.id, { browser, page, timer });
      page.setDefaultTimeout(12_000);
      await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!isAllowedHost(page.url(), job.source)) {
        await this.close(job.id);
        return {
          state: "Needs input",
          summary: emptySummary,
          missing: [],
          reason: "The posting redirected outside its supported ATS domain. No information was submitted.",
        };
      }

      let text = (await page.locator("body").innerText()).slice(0, 40_000);
      if (await challengeDetected(page, text)) {
        await this.close(job.id);
        return { state: "Needs input", summary: emptySummary, missing: [], reason: "A CAPTCHA was detected. Complete the application manually." };
      }
      if (/sign in to apply|log in to apply|login required|sign in to continue/i.test(text)) {
        await this.close(job.id);
        return { state: "Needs input", summary: emptySummary, missing: [], reason: "A login wall was detected. Continue the application manually." };
      }

      let form = await getApplicationForm(page);
      if (!form) {
        const applyLinks = page.getByRole("link", { name: /^apply(?: now)?$/i });
        const applyButtons = page.getByRole("button", { name: /^apply(?: now)?$/i });
        if ((await applyLinks.count()) === 1) await applyLinks.click();
        else if ((await applyButtons.count()) === 1) await applyButtons.click();
        else {
          await this.close(job.id);
          return {
            state: "Needs input",
            summary: emptySummary,
            missing: [],
            reason: "No clear Apply action or application form was found. Review the posting manually.",
          };
        }
        text = (await page.locator("body").innerText()).slice(0, 40_000);
        if (await challengeDetected(page, text)) {
          await this.close(job.id);
          return { state: "Needs input", summary: emptySummary, missing: [], reason: "A CAPTCHA appeared. Complete the application manually." };
        }
        if (/sign in to apply|log in to apply|login required|sign in to continue/i.test(text)) {
          await this.close(job.id);
          return { state: "Needs input", summary: emptySummary, missing: [], reason: "A login wall appeared. Continue the application manually." };
        }
        if (!isAllowedHost(page.url(), job.source)) {
          await this.close(job.id);
          return { state: "Needs input", summary: emptySummary, missing: [], reason: "The Apply action opened an unsupported domain. No information was submitted." };
        }
        form = await getApplicationForm(page);
      }

      const result = await fillApplicationForm(
        page,
        profile,
        resumePdf,
        coverLetterPdf,
        { title: job.title, url: job.url },
        answers,
      );
      if (!result.summary.fields.some((field) => field.kind === "resume")) {
        await this.close(job.id);
        return {
          ...result,
          state: "Needs input",
          reason: "No clearly labeled resume upload field was found. Review the posting manually.",
        };
      }
      const submit = form?.form.getByRole("button", { name: /submit application/i });
      if (!submit || (await submit.count()) !== 1) {
        await this.close(job.id);
        return {
          ...result,
          state: "Needs input",
          reason: "No single unambiguous Submit Application button was found. Review the posting manually.",
        };
      }
      if (result.state !== "Ready") {
        await this.close(job.id);
        return {
          ...result,
          reason: "The form contains a new or incomplete question. Add your answer below; nothing has been submitted.",
        };
      }
      return result;
    } catch (error) {
      await this.close(job.id);
      throw error;
    }
  }

  async submit(jobId: string): Promise<{ submitted: boolean; uncertain: boolean; message: string }> {
    const session = activeSessions.get(jobId);
    if (!session?.page) throw new Error("The prepared application page expired. Approve and prepare it again before submitting.");
    let submitTriggered = false;
    try {
      const form = await getApplicationForm(session.page);
      if (!form) return { submitted: false, uncertain: false, message: "The application form changed before submission. Review it manually." };
      const submit = form.form.getByRole("button", { name: /submit application/i });
      if ((await submit.count()) !== 1) {
        return { submitted: false, uncertain: false, message: "There is no single unambiguous Submit Application button. Review the form manually." };
      }
      submitTriggered = true;
      await submit.click({ timeout: 15_000 });
      await session.page.waitForTimeout(800);
      const content = (await session.page.locator("body").innerText()).slice(0, 40_000);
      const submitted =
        /application (?:has been )?received|thank you for applying|application submitted|successfully applied/i.test(content) ||
        /\/(?:confirmation|success)(?:\/|$|\?)/i.test(new URL(session.page.url()).pathname);
      return {
        submitted,
        uncertain: !submitted,
        message: submitted
          ? "The application confirmation was detected."
          : "The form was submitted, but no confirmation could be verified. Check the posting before retrying.",
      };
    } catch (error) {
      if (!submitTriggered) throw error;
      return {
        submitted: false,
        uncertain: true,
        message: "The submit action may have reached the site, but its result could not be verified. Check the posting before retrying.",
      };
    } finally {
      await this.close(jobId);
    }
  }

  async close(jobId: string): Promise<void> {
    const session = activeSessions.get(jobId);
    if (!session) return;
    activeSessions.delete(jobId);
    if (session.timer) clearTimeout(session.timer);
    await session.browser.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...activeSessions.keys()].map((jobId) => this.close(jobId)));
  }
}
