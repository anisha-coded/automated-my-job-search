# getThatjob

getThatjob is a local-first job search dashboard. It discovers recent public ATS postings, creates source-grounded application drafts, and keeps every review decision in one place. The application flow is gated: the user must approve the materials, inspect the final form summary, and separately confirm submission.

## Requirements and setup

- Node.js 20+
- npm
- Chromium for the local Playwright mock-form test

```sh
npm install
npx playwright install chromium
cp .env.example .env
# Add public Greenhouse board slugs and/or Lever site names to .env.
npm run dev
```

Open <http://127.0.0.1:5173>. The API listens only on `127.0.0.1:3001`. Keep the API process running for its 30-minute scheduler. `npm run build` type-checks and builds the frontend; `npm start` starts the API and `npm run preview` serves the built frontend.

On first use, upload a PDF or DOCX resume, optionally upload a cover-letter template, and set your search preferences and contact details. PDFs need selectable text; scanned-image OCR is not included. Parsing is local. The SQLite database at `.data/jobs.sqlite` stores the profile, extracted resume text, postings, drafts, application answers, and decisions. Search filters and scoring stay local; source requests do not include your profile. Applicant information is sent to an ATS only after your final confirmation and only when live automation is enabled.

## Job sources and scoring

The two initial pluggable connectors use public Greenhouse and Lever feeds:

```dotenv
GREENHOUSE_BOARDS=example-company,another-company
LEVER_SITES=example-company
POSTED_WITHIN_HOURS=24
SEARCH_INTERVAL_MINUTES=30
```

Use board/site identifiers you are permitted to monitor. Requests are sequential and low-frequency. Greenhouse freshness uses `updated_at`; Lever freshness uses `createdAt`. Matches are deduplicated by normalized company, title, and location, then sorted newest first. Failed runs are retried up to three times and logged without logging profile or resume content.

The 0–10 fit score uses title overlap, resume/profile skill overlap, location/work style, and disclosed or title-inferred experience requirements. Only scores **above 7** are surfaced. This is a conservative keyword heuristic, not a guarantee of qualification; review the full posting and potential gaps yourself.

## Truthful materials and review

- Tailored resume drafts are made only from lines in the uploaded resume, reordered by job relevance. The original and tailored text are shown side by side, with reordered lines highlighted.
- Potential skill and experience gaps are flagged rather than added to the resume.
- A short optional cover letter can reuse the user's template and relevant resume lines. The user can edit drafts and must confirm their accuracy before approval.
- On the ATS form, known answers are filled only from profile fields. Unsupported or unexpected questions show **NEEDS MY INPUT** and pause preparation.
- The final preview lists the posting, resume attachment and hash, visible application fields, and their exact values. A second explicit confirmation is required to submit.
- CAPTCHA, login walls, unsupported domains, unrecognized form fields, and ambiguous submit buttons stop the flow. The application is not guessed or auto-submitted in these cases.

Live ATS form preparation/submission is disabled by default. After checking that the applicable site's terms permit automation, set `ENABLE_BROWSER_APPLICATIONS=true` in the local `.env` and restart the API. Only Greenhouse and Lever ATS domains are allowlisted. Form compatibility varies; unsupported forms stay manual. The safe mock-form test never contacts a real site.

## Automation controls and notifications

- `SEARCH_INTERVAL_MINUTES` defaults to 30. The API process must remain running for scheduled searches.
- The dashboard can request local desktop notifications for new high-fit matches while its browser tab is open; permission is opt-in.
- The global **Pause automation** control stops scheduled/manual sync and blocks approval preparation and submission. It also closes any prepared browser page.
- There are no email credentials or third-party secrets in this project. Keep `.env` local; it is ignored by Git.

## Database and validation

SQLite migrations live in `server/migrations/` and are applied in order at API startup. The database and uploaded personal data are local and ignored by Git.

```sh
npm test
npm run build
```

Tests cover scoring, source freshness and deduplication, source-only resume drafting, submission approval gates, and Playwright filling/submitting against an isolated mock form.
