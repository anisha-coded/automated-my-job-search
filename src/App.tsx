import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Profile, Job } from "../server/types";

interface ProfileResponse {
  profile: Profile;
  resumeFilename: string | null;
  hasResume: boolean;
}

interface DashboardData {
  newMatchesToday: number;
  pendingReviews: number;
  submitted: number;
  responseRate: number | null;
  statuses: Array<{ status: string; count: number }>;
  configuredSources: number;
  postedWithinHours: number;
  lastRunAt: string | null;
  automationPaused: boolean;
}

interface DraftMaterial {
  originalResume: string;
  tailoredResume: string;
  gaps: string[];
  answers: Array<{ question: string; answer: string }>;
  coverLetter: string;
}

interface ApplicationField {
  label: string;
  value: string;
  kind: "text" | "select" | "resume" | "cover-letter";
}

interface ApplicationSummary {
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

interface ApplicationReview {
  state: string;
  summary: ApplicationSummary;
  resumeVersion?: string;
  updatedAt?: string;
  error?: string;
  message?: string;
  submitted?: boolean;
}

interface JobEvent {
  id: number;
  jobId: string;
  status: string;
  details: string;
  createdAt: string;
  company: string;
  title: string;
  url: string;
}

const blankDashboard: DashboardData = {
  newMatchesToday: 0,
  pendingReviews: 0,
  submitted: 0,
  responseRate: null,
  statuses: [],
  configuredSources: 0,
  postedWithinHours: 24,
  lastRunAt: null,
  automationPaused: false,
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "The request could not be completed.");
  return body as T;
}

const splitList = (value: string) =>
  value.split(",").map((part) => part.trim()).filter(Boolean);

function ProfileForm({
  initial,
  resumeFilename,
  onSaved,
  onCancel,
  onboarding = false,
}: {
  initial: Profile;
  resumeFilename: string | null;
  onSaved: (profile: Profile, filename: string | null) => void;
  onCancel?: () => void;
  onboarding?: boolean;
}) {
  const [profile, setProfile] = useState(initial);
  const [roles, setRoles] = useState(initial.targetRoles.join(", "));
  const [locations, setLocations] = useState(initial.locations.join(", "));
  const [excluded, setExcluded] = useState(initial.excludedCompanies.join(", "));
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [coverLetterText, setCoverLetterText] = useState(initial.coverLetterTemplate);
  const [experience, setExperience] = useState(
    initial.experience.map((item) => `${item.title} | ${item.company} | ${item.dates}`).join("\n"),
  );
  const [achievements, setAchievements] = useState(initial.achievements.join("\n"));
  const [resume, setResume] = useState<File | null>(null);
  const [coverLetter, setCoverLetter] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      let nextProfile = profile;
      let nextFilename = resumeFilename;
      if (resume || coverLetter) {
        const files = new FormData();
        if (resume) files.append("resume", resume);
        if (coverLetter) files.append("coverLetter", coverLetter);
        const result = await request<ProfileResponse & { parsed: { text: string } | null }>("/api/profile/resume", {
          method: "POST",
          body: files,
        });
        nextProfile = result.profile;
        nextFilename = result.resumeFilename;
      }

      const edited: Profile = {
        ...nextProfile,
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        targetRoles: splitList(roles),
        locations: splitList(locations),
        excludedCompanies: splitList(excluded),
        skills: resume && skills === initial.skills.join(", ")
          ? nextProfile.skills
          : skills.trim() ? splitList(skills) : [],
        experience: resume && experience === initial.experience.map((item) => `${item.title} | ${item.company} | ${item.dates}`).join("\n")
          ? nextProfile.experience
          : experience.trim()
          ? experience
              .split("\n")
              .map((line) => line.split("|").map((part) => part.trim()))
              .filter((parts) => parts.some(Boolean))
              .map(([title = "", company = "", dates = ""]) => ({ title, company, dates }))
          : [],
        achievements: resume && achievements === initial.achievements.join("\n")
          ? nextProfile.achievements
          : achievements.trim()
          ? achievements.split("\n").map((line) => line.trim()).filter(Boolean)
          : [],
        coverLetterTemplate:
          coverLetterText !== initial.coverLetterTemplate
            ? coverLetterText
            : nextProfile.coverLetterTemplate,
        salaryMin: profile.salaryMin,
        salaryMax: profile.salaryMax,
        minYearsExperience: profile.minYearsExperience,
        maxYearsExperience: profile.maxYearsExperience,
        workAuthorization: profile.workAuthorization,
      };
      await request<ProfileResponse>("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edited),
      });
      onSaved(edited, nextFilename);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="profile-form" onSubmit={submit}>
      <div className="form-heading">
        <div>
          <p className="eyebrow">{onboarding ? "A little context goes a long way" : "Your search profile"}</p>
          <h2>{onboarding ? "Let’s set up your search." : "Edit your profile"}</h2>
          <p className="muted">Your resume and preferences stay on this device.</p>
        </div>
        {!onboarding && onCancel && <button className="icon-button" type="button" onClick={onCancel} aria-label="Close">×</button>}
      </div>

      <section className="form-section">
        <h3>Start with your resume</h3>
        <p className="muted">We’ll use it to identify your skills and experience. PDF or DOCX, up to 10 MB.</p>
        {resumeFilename && !resume && <p className="file-note"><span className="file-check">✓</span> {resumeFilename} is saved locally</p>}
        <div className="file-fields">
          <label className="file-picker">
            <span>{resume ? resume.name : resumeFilename ? "Replace resume" : "Choose resume"}</span>
            <input type="file" required={!resumeFilename} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setResume(event.target.files?.[0] ?? null)} />
          </label>
          <label className="file-picker secondary-file">
            <span>{coverLetter?.name ?? "Optional cover letter template"}</span>
            <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setCoverLetter(event.target.files?.[0] ?? null)} />
          </label>
        </div>
      </section>

      <section className="form-section">
        <h3>Your details and search preferences</h3>
        <div className="form-grid">
          <label className="field">
            <span>Full name</span>
            <input autoComplete="name" value={profile.fullName} onChange={(event) => setProfile({ ...profile, fullName: event.target.value })} placeholder="Your name" />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} placeholder="you@example.com" />
          </label>
          <label className="field wide">
            <span>Phone <small>optional</small></span>
            <input type="tel" autoComplete="tel" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="Phone number" />
          </label>
          <label className="field wide">
            <span>Target roles <small>comma-separated</small></span>
            <input value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="Product Designer, UX Designer" />
          </label>
          <label className="field wide">
            <span>Preferred locations <small>comma-separated</small></span>
            <input value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="San Francisco, United States" />
          </label>
          <label className="field">
            <span>Work style</span>
            <select value={profile.remotePreference} onChange={(event) => setProfile({ ...profile, remotePreference: event.target.value as Profile["remotePreference"] })}>
              <option value="any">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </label>
          <label className="field">
            <span>Work authorization</span>
            <input value={profile.workAuthorization} onChange={(event) => setProfile({ ...profile, workAuthorization: event.target.value })} placeholder="e.g. Authorized to work in US" />
          </label>
          <label className="field">
            <span>Minimum salary <small>annual</small></span>
            <input type="number" min="0" value={profile.salaryMin ?? ""} onChange={(event) => setProfile({ ...profile, salaryMin: event.target.value ? Number(event.target.value) : null })} placeholder="$" />
          </label>
          <label className="field">
            <span>Maximum salary <small>annual</small></span>
            <input type="number" min="0" value={profile.salaryMax ?? ""} onChange={(event) => setProfile({ ...profile, salaryMax: event.target.value ? Number(event.target.value) : null })} placeholder="$" />
          </label>
          <label className="field">
          <span>Minimum years required by role</span>
            <input type="number" min="0" value={profile.minYearsExperience ?? ""} onChange={(event) => setProfile({ ...profile, minYearsExperience: event.target.value ? Number(event.target.value) : null })} placeholder="Any" />
          </label>
          <label className="field">
          <span>Maximum years required by role</span>
            <input type="number" min="0" value={profile.maxYearsExperience ?? ""} onChange={(event) => setProfile({ ...profile, maxYearsExperience: event.target.value ? Number(event.target.value) : null })} placeholder="Any" />
          </label>
          <label className="field wide">
            <span>Companies to exclude <small>comma-separated</small></span>
            <input value={excluded} onChange={(event) => setExcluded(event.target.value)} placeholder="Company names" />
          </label>
        </div>
      </section>

      <details className="form-section parsed-details">
        <summary>Review parsed skills and experience</summary>
        <div className="form-grid detail-fields">
          <label className="field wide">
            <span>Skills <small>comma-separated</small></span>
            <input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Figma, research, prototyping" />
          </label>
          <label className="field wide">
            <span>Experience <small>one role per line: title | company | dates</small></span>
            <textarea rows={3} value={experience} onChange={(event) => setExperience(event.target.value)} placeholder={"Product Designer | Acme | 2022–Present"} />
          </label>
          <label className="field wide">
            <span>Achievements <small>one per line</small></span>
            <textarea rows={3} value={achievements} onChange={(event) => setAchievements(event.target.value)} placeholder="Led a redesign that improved..." />
          </label>
          <label className="field wide">
            <span>Cover letter template <small>optional</small></span>
            <textarea rows={5} value={coverLetterText} onChange={(event) => setCoverLetterText(event.target.value)} placeholder="Add or edit your reusable cover letter template." />
          </label>
        </div>
      </details>

      {error && <p role="alert" className="error-message">{error}</p>}
      <div className="form-actions">
        {!onboarding && onCancel && <button type="button" className="button button-quiet" onClick={onCancel}>Cancel</button>}
        <button className="button button-primary" disabled={saving}>
          {saving ? "Saving…" : onboarding ? "Save profile & see matches" : "Save changes"}
          {!saving && <span aria-hidden="true"> →</span>}
        </button>
      </div>
    </form>
  );
}

function App() {
  const [profileState, setProfileState] = useState<ProfileResponse | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dashboard, setDashboard] = useState(blankDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [draftJob, setDraftJob] = useState<Job | null>(null);
  const [draft, setDraft] = useState<DraftMaterial | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [applicationReview, setApplicationReview] = useState<ApplicationReview | null>(null);
  const [manualAnswers, setManualAnswers] = useState<Record<string, string>>({});
  const [truthConfirmed, setTruthConfirmed] = useState(false);
  const [finalSendConfirmed, setFinalSendConfirmed] = useState(false);
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftCoverLetter, setDraftCoverLetter] = useState("");
  const [sending, setSending] = useState(false);
  const [jobEvents, setJobEvents] = useState<JobEvent[]>([]);
  const [alertsEnabled, setAlertsEnabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [profile, nextJobs, nextDashboard, nextEvents] = await Promise.all([
        request<ProfileResponse>("/api/profile"),
        request<Job[]>("/api/jobs"),
        request<DashboardData>("/api/dashboard"),
        request<JobEvent[]>("/api/applications"),
      ]);
      setProfileState(profile);
      setJobs(nextJobs);
      setDashboard(nextDashboard);
      setJobEvents(nextEvents);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const events = new EventSource("/events");
    events.addEventListener("jobs", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { inserted?: number; matches?: number };
      void refresh();
      if (alertsEnabled && payload.matches && Notification.permission === "granted") {
        new Notification("New high-fit jobs are ready", {
          body: `${payload.matches} new role${payload.matches === 1 ? "" : "s"} added to your review queue.`,
        });
      }
    });
    events.addEventListener("profile", () => void refresh());
    events.addEventListener("settings", () => void refresh());
    return () => events.close();
  }, [alertsEnabled, refresh]);

  const syncNow = async () => {
    setSyncing(true);
    setError("");
    try {
      await request("/api/jobs/sync", { method: "POST" });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not search for new jobs.");
    } finally {
      setSyncing(false);
    }
  };

  const openDraft = async (job: Job) => {
    setDraftJob(job);
    setDraft(null);
    setApplicationReview(null);
    setManualAnswers({});
    setTruthConfirmed(false);
    setFinalSendConfirmed(false);
    setEditingDraft(false);
    setDrafting(true);
    setError("");
    try {
      const method = job.status === "Found" ? "POST" : "GET";
      const material = await request<DraftMaterial>(`/api/jobs/${encodeURIComponent(job.id)}/draft`, { method });
      setDraft(material);
      setDraftText(material.tailoredResume);
      setDraftCoverLetter(material.coverLetter);
      if (job.attemptState) {
        const attempt = await request<ApplicationReview>(`/api/jobs/${encodeURIComponent(job.id)}/application`);
        setApplicationReview(attempt);
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare application materials.");
      setDraftJob(null);
    } finally {
      setDrafting(false);
    }
  };

  const saveDraftEdits = async () => {
    if (!draft || !draftJob) return;
    setDrafting(true);
    setError("");
    try {
      await request(`/api/jobs/${encodeURIComponent(draftJob.id)}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tailoredResume: draftText, coverLetter: draftCoverLetter }),
      });
      setDraft({ ...draft, tailoredResume: draftText, coverLetter: draftCoverLetter });
      setApplicationReview(null);
      setTruthConfirmed(false);
      setEditingDraft(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save your edits.");
    } finally {
      setDrafting(false);
    }
  };

  const approveAndPrepare = async () => {
    if (!draftJob || (!truthConfirmed && !applicationReview)) return;
    setDrafting(true);
    setError("");
    try {
      const prepared = await request<Omit<ApplicationReview, "error">>(
        `/api/jobs/${encodeURIComponent(draftJob.id)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmedTruthful: true, answers: manualAnswers }),
        },
      );
      setApplicationReview(prepared);
      setManualAnswers({});
      setFinalSendConfirmed(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare the application.");
    } finally {
      setDrafting(false);
    }
  };

  const submitApplication = async () => {
    if (!draftJob || !finalSendConfirmed) return;
    setSending(true);
    setError("");
    try {
      const result = await request<{ status: string; message: string; submitted: boolean }>(
        `/api/jobs/${encodeURIComponent(draftJob.id)}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        },
      );
      setApplicationReview((previous) => previous ? { ...previous, state: result.status, message: result.message, submitted: result.submitted } : previous);
      setFinalSendConfirmed(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit the application.");
    } finally {
      setSending(false);
    }
  };

  const changeJobStatus = async (job: Job, status: "Skipped" | "Saved for later" | "Interview" | "Rejected" | "Offer") => {
    try {
      await request(`/api/jobs/${encodeURIComponent(job.id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the application status.");
    }
  };

  const confirmSubmitted = async (job: Job) => {
    const confirmed = window.confirm("Only continue if you checked the original posting and verified that it received this application.");
    if (!confirmed) return;
    try {
      await request(`/api/jobs/${encodeURIComponent(job.id)}/confirm-submitted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record the verified submission.");
    }
  };

  const toggleAutomation = async () => {
    try {
      await request("/api/settings/automation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !dashboard.automationPaused }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change the automation setting.");
    }
  };

  const enableAlerts = async () => {
    if (!("Notification" in window)) {
      setError("Desktop notifications are not supported by this browser.");
      return;
    }
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission === "granted") setAlertsEnabled(true);
    else setError("Notification permission was not granted.");
  };

  const downloadDraft = () => {
    if (!draft || !draftJob) return;
    const file = new Blob([draft.tailoredResume], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draftJob.company}-${draftJob.title}-tailored-resume.txt`.replace(/[^a-z0-9._-]+/gi, "-");
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleProfileSaved = async (profile: Profile, filename: string | null) => {
    setProfileState({ profile, resumeFilename: filename, hasResume: Boolean(filename) });
    setEditingProfile(false);
    setLoading(true);
    try {
      await request("/api/jobs/sync", { method: "POST" });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your profile was saved, but searching failed.");
      setLoading(false);
    }
  };

  const freshnessCutoff = Date.now() - dashboard.postedWithinHours * 60 * 60 * 1000;
  const visibleJobs = jobs.filter(
    (job) =>
      ["Found", "Drafted", "Approved", "Needs input"].includes(job.status) &&
      Boolean(job.postedAt && Date.parse(job.postedAt) >= freshnessCutoff),
  );

  if (loading && !profileState) {
    return <main className="loading-screen"><div className="brand-mark">f.</div><p>Preparing your workspace…</p></main>;
  }

  if (!profileState) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">f.</div>
        <p role="alert">{error || "Could not connect to the local API."}</p>
        <button className="button button-outline" onClick={() => { setLoading(true); void refresh(); }}>Try again</button>
      </main>
    );
  }

  if (!profileState?.hasResume || editingProfile) {
    return (
      <main className={profileState?.hasResume ? "editor-screen" : "onboarding-screen"}>
        <a className="brand" href="/" aria-label="Fieldnote home"><span className="brand-mark">f.</span><span>fieldnote</span></a>
        <div className="editor-card">
          <ProfileForm
            initial={profileState?.profile ?? {
              targetRoles: [], locations: [], remotePreference: "any", salaryMin: null,
              salaryMax: null, minYearsExperience: null, maxYearsExperience: null,
              workAuthorization: "", excludedCompanies: [], skills: [], experience: [],
              achievements: [], coverLetterTemplate: "", fullName: "", email: "", phone: "",
            }}
            resumeFilename={profileState?.resumeFilename ?? null}
            onSaved={handleProfileSaved}
            onCancel={profileState?.hasResume ? () => setEditingProfile(false) : undefined}
            onboarding={!profileState?.hasResume}
          />
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Fieldnote home"><span className="brand-mark">f.</span><span>fieldnote</span></a>
        <p className="nav-label">WORKSPACE</p>
        <a className="nav-item active" href="#matches"><span className="nav-icon">⌂</span> Overview</a>
        <a className="nav-item" href="#matches"><span className="nav-icon">◷</span> New matches <span className="nav-count">{dashboard.pendingReviews}</span></a>
        <a className="nav-item" href="#tracker"><span className="nav-icon">▤</span> Application tracker</a>
        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <span className="privacy-icon">◈</span>
          <strong>Your data stays yours.</strong>
          <p>Resume and profile are stored on this device.</p>
        </div>
        <button className="nav-item settings-button" onClick={() => setEditingProfile(true)}><span className="nav-icon">⚙</span> Profile settings</button>
        <div className="sidebar-user"><span className="avatar">J</span><span><strong>My job search</strong><small>Personal workspace</small></span><span className="more">···</span></div>
      </aside>

      <main className="main-content" id="matches">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> Overview</div>
          <div className="topbar-right">
            <span className="live-indicator"><i /> Live updates on</span>
            <button className={`automation-toggle ${dashboard.automationPaused ? "paused" : ""}`} onClick={toggleAutomation} aria-pressed={dashboard.automationPaused}>
              {dashboard.automationPaused ? "Automation paused" : "Pause automation"}
            </button>
            {"Notification" in window && <button className="alerts-toggle" onClick={enableAlerts}>{alertsEnabled ? "Alerts on" : "Enable alerts"}</button>}
            <button className="avatar small-avatar" onClick={() => setEditingProfile(true)} aria-label="Edit profile">J</button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</p>
              <h1>A thoughtful search, <em>in motion.</em></h1>
              <p className="welcome-subtitle">A clear view of your next opportunity, without the noise.</p>
            </div>
            <button className="button button-outline" onClick={syncNow} disabled={syncing || dashboard.configuredSources === 0 || dashboard.automationPaused}>
              <span className="refresh-icon">{syncing ? "◌" : "↻"}</span> {syncing ? "Searching…" : "Refresh matches"}
            </button>
          </section>

          <section className="stats-grid" aria-label="Job search summary">
            <article className="stat-card stat-highlight">
              <div className="stat-top"><span>NEW MATCHES TODAY</span><span className="stat-icon">✳</span></div>
              <strong>{dashboard.newMatchesToday}</strong>
              <p>Scored above 7.0</p>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>PENDING REVIEW</span><span className="stat-icon muted-icon">◷</span></div>
              <strong>{dashboard.pendingReviews}</strong>
              <p>Ready when you are</p>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>APPLICATIONS SENT</span><span className="stat-icon muted-icon">↗</span></div>
              <strong>{dashboard.submitted}</strong>
              <p>Across your search</p>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>RESPONSE RATE</span><span className="stat-icon muted-icon">⌁</span></div>
              <strong>{dashboard.responseRate === null ? "—" : `${dashboard.responseRate}%`}</strong>
              <p>Once you start applying</p>
            </article>
          </section>

          {error && <div role="alert" className="banner-error"><span>Something needs your attention.</span> {error}</div>}

          <section className="matches-section">
            <div className="section-heading">
              <div>
                <div className="section-title-row"><h2>Review queue</h2><span className="count-pill">{visibleJobs.length}</span></div>
                <p>Strong-fit roles posted in the last {dashboard.postedWithinHours} hours.</p>
              </div>
              <button className="text-button" onClick={() => setEditingProfile(true)}>Tune your search <span>↗</span></button>
            </div>

            {visibleJobs.length > 0 ? (
              <div className="job-list">
                {visibleJobs.map((job, index) => (
                  <article className="job-card" key={job.id}>
                    <div className={`company-avatar company-${index % 4}`}>{job.company.slice(0, 1).toUpperCase()}</div>
                    <div className="job-main">
                      <div className="job-title-row">
                        <div>
                          <h3>{job.title}</h3>
                          <p className="company-line">{job.company} <span>·</span> {job.location || "Location not listed"}</p>
                        </div>
                        <a className="external-link" href={job.url} target="_blank" rel="noreferrer" aria-label={`Open ${job.title} posting`}>↗</a>
                      </div>
                      <p className="job-description">{job.description || "Open the original posting to see full role details."}</p>
                      <div className="job-state-row"><span className={`status-tag status-${job.status.toLowerCase().replaceAll(" ", "-")}`}>{job.status}</span>{job.status === "Needs input" && <span className="needs-input-note">Your answer is needed before continuing</span>}</div>
                      <div className="job-footer">
                        <span className="posted-time">{formatPostedAt(job.postedAt)}</span>
                        <span className="source-label"><span className="source-dot" /> {job.source}</span>
                        <span className="score-pill"><i>✳</i> {job.score.toFixed(1)} fit</span>
                        <button className="job-action" onClick={() => void openDraft(job)} disabled={dashboard.automationPaused}>{job.status === "Found" ? "Prepare materials" : "Review materials"} <span>→</span></button>
                        {job.status !== "Approved" && job.status !== "Needs input" && <button className="job-secondary-action" onClick={() => void changeJobStatus(job, "Saved for later")}>Save</button>}
                        {job.status !== "Approved" && job.status !== "Needs input" && <button className="job-secondary-action" onClick={() => void changeJobStatus(job, "Skipped")}>Skip</button>}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-art"><span>✳</span><span>↗</span><span>·</span></div>
                <h3>{dashboard.configuredSources === 0 ? "Connect your first job source" : "Your next match is on its way"}</h3>
                <p>{dashboard.configuredSources === 0
                  ? "Add public Greenhouse board slugs or Lever site names to your local setup. We’ll check for fresh roles every 30 minutes."
                  : dashboard.automationPaused ? "Automation is paused. Resume it when you’re ready to continue." : `We’re looking for roles posted in the last ${dashboard.postedWithinHours} hours.`}</p>
                {dashboard.configuredSources === 0 && <span className="setup-hint">Setup: add <code>GREENHOUSE_BOARDS=slug</code> or <code>LEVER_SITES=slug</code> to .env</span>}
                {dashboard.configuredSources > 0 && <button className="button button-outline empty-refresh" onClick={syncNow} disabled={syncing || dashboard.automationPaused}>{syncing ? "Searching…" : "Check again"}</button>}
              </div>
            )}
          </section>

          <section className="lower-grid">
            <article className="activity-card">
              <div className="section-title-row"><h2>Search activity</h2><span className={`activity-status ${dashboard.automationPaused ? "paused-activity" : ""}`}><i /> {dashboard.automationPaused ? "Paused" : dashboard.configuredSources > 0 ? "Active" : "Setup needed"}</span></div>
              <p>Latest from your search</p>
              <div className="activity-line">
                <span className="timeline-dot" />
                <div><strong>{dashboard.lastRunAt ? "Last job search completed" : "Your search is ready"}</strong><small>{dashboard.lastRunAt ? formatRelative(dashboard.lastRunAt) : "Search runs every 30 minutes"}</small></div>
              </div>
              <div className="activity-line">
                <span className="timeline-dot soft-dot" />
                <div><strong>{visibleJobs.length} high-fit roles</strong><small>Scored and filtered against your profile</small></div>
              </div>
            </article>
            <article className="next-card">
              <span className="next-kicker">A SEARCH THAT STAYS YOURS</span>
              <div className="next-icon">✎</div>
              <h3>Nothing goes out without your say-so.</h3>
              <p>Applications are prepared only after approval, shown back to you in a final preview, and sent only after a separate confirmation.</p>
              <span className="next-phase">{dashboard.automationPaused ? "GLOBAL KILL SWITCH · PAUSED" : "AUTOMATION · UNDER YOUR CONTROL"}</span>
            </article>
          </section>
          <section className="tracker-section" id="tracker">
            <div className="section-heading tracker-heading">
              <div><h2>Application tracker</h2><p>Every match and decision, in one place.</p></div>
              <span className="tracker-total">{jobs.length} tracked roles</span>
            </div>
            {jobs.length > 0 ? (
              <div className="tracker-list">
                {jobs.map((job) => (
                  <article className="tracker-row" key={job.id}>
                    <span className="tracker-dot" />
                    <div className="tracker-job"><strong>{job.title}</strong><small>{job.company} · {job.location || "Location not listed"}</small></div>
                    <span className={`status-tag status-${job.status.toLowerCase().replaceAll(" ", "-")}`}>{job.status}</span>
                    {job.status === "Needs input" && job.attemptState === "Unconfirmed" ? (
                      <button className="tracker-confirm" onClick={() => void confirmSubmitted(job)}>Verify submission</button>
                    ) : job.attemptState === "Submitted" ? (
                      <button className="tracker-link tracker-record" onClick={() => void openDraft(job)}>Submission log</button>
                    ) : job.status === "Submitted" || job.status === "Interview" ? (
                      <select aria-label={`Update status for ${job.title}`} value="" onChange={(event) => {
                        const nextStatus = event.target.value as "Interview" | "Rejected" | "Offer";
                        if (nextStatus) void changeJobStatus(job, nextStatus);
                      }}>
                        <option value="">Update…</option>
                        {job.status === "Submitted" && <option value="Interview">Interview</option>}
                        <option value="Rejected">Rejected</option>
                        <option value="Offer">Offer</option>
                      </select>
                    ) : <a className="tracker-link" href={job.url} target="_blank" rel="noreferrer">Posting ↗</a>}
                  </article>
                ))}
              </div>
            ) : (
              <div className="tracker-empty">Your application timeline will appear here as you review roles.</div>
            )}
            {jobEvents.length > 0 && (
              <details className="decision-history">
                <summary>Decision history <span>{jobEvents.length} events</span></summary>
                <div className="decision-events">
                  {jobEvents.slice(0, 12).map((event) => (
                    <div className="decision-event" key={event.id}>
                      <span className="event-marker" />
                      <div><strong>{event.status} · {event.title}</strong><small>{event.company} — {event.details}</small></div>
                      <time>{formatRelative(event.createdAt)}</time>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
          <footer className="page-footer"><span>Made for a more human job search.</span><span>Nothing is ever submitted without your approval.</span></footer>
        </div>
      </main>
      {draftJob && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraftJob(null); }}>
          <section className="draft-modal" role="dialog" aria-modal="true" aria-labelledby="draft-title">
            <header className="draft-modal-header">
              <div><p className="eyebrow">MATERIALS FOR {draftJob.company.toUpperCase()}</p><h2 id="draft-title">{draftJob.title}</h2></div>
              <button className="icon-button" onClick={() => setDraftJob(null)} aria-label="Close materials">×</button>
            </header>
            {drafting ? <div className="draft-loading">Preparing a source-grounded draft…</div> : draft && (
              <>
                <p className="draft-note"><span>✳</span> The system only reorders text from your uploaded resume. No employers, skills, dates, or achievements are added. Please check every detail.</p>
                {!editingDraft ? (
                  <>
                    <div className="diff-heading"><h3>Resume comparison</h3><span>Reordered lines are highlighted</span><button className="text-button" onClick={() => { setEditingDraft(true); setTruthConfirmed(false); }}>Edit materials</button></div>
                    <div className="resume-diff">
                      <ResumePane title="ORIGINAL RESUME" text={draft.originalResume} compare={draft.tailoredResume} />
                      <ResumePane title="TAILORED VERSION" text={draft.tailoredResume} compare={draft.originalResume} />
                    </div>
                  </>
                ) : (
                  <section className="draft-edit-fields">
                    <label className="field"><span>Tailored resume text</span><textarea rows={13} value={draftText} onChange={(event) => setDraftText(event.target.value)} /></label>
                    <label className="field"><span>Cover letter</span><textarea rows={8} value={draftCoverLetter} onChange={(event) => setDraftCoverLetter(event.target.value)} /></label>
                    <div className="draft-edit-actions"><button className="button button-quiet" onClick={() => setEditingDraft(false)}>Cancel edit</button><button className="button button-primary" onClick={() => void saveDraftEdits()} disabled={drafting}>Save edits</button></div>
                  </section>
                )}
                <section className="draft-subsection">
                  <h3>Potential gaps</h3>
                  {draft.gaps.length
                    ? <ul className="gap-list">{draft.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
                    : <p className="muted">No keyword gaps detected. Review the full requirements yourself.</p>}
                </section>
                <section className="draft-subsection">
                  <h3>Screening questions</h3>
                  <p className="draft-honesty">No screener questions are available in this public posting. When a question is available, unsupported answers will be marked <strong>NEEDS MY INPUT</strong> rather than guessed.</p>
                </section>
                <details className="draft-subsection cover-letter-preview">
                  <summary>Optional cover letter draft</summary>
                  <pre>{draft.coverLetter}</pre>
                </details>
                {!applicationReview && !editingDraft && (
                  <section className="approval-panel">
                    <label className="truth-check"><input type="checkbox" checked={truthConfirmed} onChange={(event) => setTruthConfirmed(event.target.checked)} /><span>I reviewed this material and confirm every resume fact is accurate and based on my experience.</span></label>
                    {dashboard.automationPaused && <p className="pause-explanation">Automation is paused. Resume it using the global control before preparing an application.</p>}
                    <div className="approval-actions">
                      <button className="button button-outline" onClick={downloadDraft}>Download tailored text</button>
                      <button className="button button-primary" onClick={() => void approveAndPrepare()} disabled={!truthConfirmed || drafting || dashboard.automationPaused}>Approve & prepare final preview</button>
                    </div>
                  </section>
                )}
                {applicationReview && <ApplicationPreview
                  review={applicationReview}
                  answers={manualAnswers}
                  onAnswerChange={(label, value) => setManualAnswers((previous) => ({ ...previous, [label]: value }))}
                  onPrepare={() => void approveAndPrepare()}
                  onSubmit={() => void submitApplication()}
                  onConfirmSend={setFinalSendConfirmed}
                  sendConfirmed={finalSendConfirmed}
                  sending={sending}
                  preparing={drafting}
                  paused={dashboard.automationPaused}
                  onEdit={() => { setApplicationReview(null); setEditingDraft(true); setTruthConfirmed(false); }}
                />}
                <footer className="draft-modal-footer"><p>Review each application. The final send always requires a second, explicit confirmation.</p><button className="button button-quiet" onClick={() => setDraftJob(null)}>Close</button></footer>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ResumePane({ title, text, compare }: { title: string; text: string; compare: string }) {
  const lines = text.split("\n");
  const comparisonPositions = new Map<string, number[]>();
  compare.split("\n").forEach((line, index) => {
    const positions = comparisonPositions.get(line) ?? [];
    positions.push(index);
    comparisonPositions.set(line, positions);
  });
  return (
    <article className="resume-diff-pane">
      <h4>{title}</h4>
      <div className="resume-diff-code">
        {lines.map((line, index) => {
          const positions = comparisonPositions.get(line);
          const otherIndex = positions?.shift();
          return <div key={`${index}-${line}`} className={`resume-line ${otherIndex !== index ? "changed-line" : ""}`}><span>{index + 1}</span><code>{line || " "}</code></div>;
        })}
      </div>
    </article>
  );
}

function ApplicationPreview({
  review,
  answers,
  onAnswerChange,
  onPrepare,
  onSubmit,
  onConfirmSend,
  sendConfirmed,
  sending,
  preparing,
  paused,
  onEdit,
}: {
  review: ApplicationReview;
  answers: Record<string, string>;
  onAnswerChange: (label: string, value: string) => void;
  onPrepare: () => void;
  onSubmit: () => void;
  onConfirmSend: (checked: boolean) => void;
  sendConfirmed: boolean;
  sending: boolean;
  preparing: boolean;
  paused: boolean;
  onEdit: () => void;
}) {
  const summary = review.summary ?? {
    posting: "Application",
    postingUrl: "",
    resumeFilename: "",
    resumeSha256: "",
    fields: [],
  };
  if (!Array.isArray(summary.fields)) summary.fields = [];
  const missing = summary.missing ?? [];
  const attentionRequired = review.state === "Needs input" || review.state === "Failed" || review.state === "Unconfirmed";

  return (
    <section className="application-preview">
      {review.state === "Submitted" ? (
        <div className="submission-result success-result">
          <strong>Application submitted</strong>
          <p>{review.message ?? "The application confirmation was detected."}</p>
          <details className="submission-record">
            <summary>Submission record</summary>
            <p>Resume version: <code>{review.resumeVersion ?? "Unavailable"}</code></p>
            <p>Recorded: {review.updatedAt ? new Date(review.updatedAt).toLocaleString() : "Unavailable"}</p>
            <p>Posting: <a href={summary.postingUrl} target="_blank" rel="noreferrer">{summary.posting} ↗</a></p>
            <div className="summary-fields">
              {summary.fields.map((field, index) => <div className="summary-field" key={`${field.label}-${index}`}><span>{field.label}</span><strong>{field.value || "Not provided"}</strong></div>)}
            </div>
          </details>
        </div>
      ) : attentionRequired ? (
        <div className="submission-result needs-result">
          <strong>{review.state === "Unconfirmed" ? "Submission needs verification" : "Paused for your input"}</strong>
          <p>{review.message ?? review.error ?? summary.reason ?? "We could not safely prepare this form. Nothing was guessed."}</p>
          {summary.postingUrl && <p><a className="preview-posting-link" href={summary.postingUrl} target="_blank" rel="noreferrer">Check the original posting ↗</a></p>}
          {review.state === "Unconfirmed" && <p className="pause-explanation">Do not retry yet. Check the original posting to confirm whether it received your application.</p>}
          {missing.length > 0 && review.state !== "Unconfirmed" && (
            <div className="missing-answers">
              <p>These questions are not answered in your profile. Add your own answer to continue:</p>
              {missing.map((label) => (
                <label className="field" key={label}>
                  <span>{label} <strong>NEEDS MY INPUT</strong></span>
                  <textarea rows={2} value={answers[label] ?? ""} onChange={(event) => onAnswerChange(label, event.target.value)} />
                </label>
              ))}
              <button className="button button-outline" onClick={onPrepare} disabled={preparing || missing.some((label) => !answers[label]?.trim()) || paused}>
                {preparing ? "Checking answers…" : "Use my answers & review form again"}
              </button>
            </div>
          )}
          {review.state === "Failed" && !missing.length && <button className="button button-outline retry-prepare" onClick={onPrepare} disabled={preparing || paused}>{preparing ? "Preparing…" : "Prepare the form again"}</button>}
          {review.state === "Needs input" && !missing.length && (
            <>
              <p className="manual-action-note">This site needs manual review. Open the posting to continue; no application was submitted.</p>
              <button className="button button-outline retry-prepare" onClick={onPrepare} disabled={preparing || paused}>{preparing ? "Checking…" : "Try preparing the form again"}</button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="preview-heading">
            <div><p className="eyebrow">FINAL APPLICATION PREVIEW</p><h3>Exactly what will be sent</h3></div>
            <span className="status-tag status-approved">Approved</span>
          </div>
          <p className="preview-posting"><a href={summary.postingUrl} target="_blank" rel="noreferrer">{summary.posting} · View posting ↗</a></p>
          <div className="submission-summary">
            <div className="summary-resume"><span>RESUME ATTACHMENT</span><strong>{summary.resumeFilename}</strong><small>SHA-256 · {summary.resumeSha256 || "not available"}</small></div>
            {summary.coverLetterFilename && <div className="summary-resume"><span>COVER LETTER ATTACHMENT</span><strong>{summary.coverLetterFilename}</strong><small>SHA-256 · {summary.coverLetterSha256 || "not available"}</small></div>}
            <div className="summary-fields">
              {summary.fields.map((field, index) => (
                <div className="summary-field" key={`${field.label}-${index}`}>
                  <span>{field.label}</span>
                  <strong>{field.value || "Not provided"}</strong>
                </div>
              ))}
            </div>
          </div>
          <button className="text-button preview-edit" onClick={onEdit}>Edit materials or answers before sending</button>
          <button className="text-button preview-edit" onClick={onPrepare} disabled={preparing || paused}>{preparing ? "Refreshing preview…" : "Refresh the prepared form"}</button>
          <label className="truth-check final-check"><input type="checkbox" checked={sendConfirmed} onChange={(event) => onConfirmSend(event.target.checked)} /><span>I reviewed the exact resume and answers above. Send this application now.</span></label>
          {paused && <p className="pause-explanation">Automation is paused. Resume it using the global control before sending.</p>}
          <button className="button button-primary send-button" onClick={onSubmit} disabled={!sendConfirmed || sending || paused}>
            {sending ? "Submitting…" : "Submit application"}
          </button>
        </>
      )}
    </section>
  );
}

function formatPostedAt(value: string | null): string {
  if (!value) return "Recently posted";
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3_600_000));
  if (hours < 1) return "Posted less than an hour ago";
  if (hours < 24) return `Posted ${hours}h ago`;
  return `Posted ${Math.floor(hours / 24)}d ago`;
}

function formatRelative(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  return `${Math.floor(minutes / 60)} hours ago`;
}

export default App;
