export interface SubmissionState {
  confirmed: boolean;
  automationPaused: boolean;
  status: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  attemptState: string | null;
}

export function submissionBlockReason(state: SubmissionState): string | null {
  if (!state.confirmed) return "Final confirmation is required before submitting.";
  if (state.automationPaused) return "Automation is paused. Resume it before submitting.";
  if (!state.status || !state.approvedAt || state.status !== "Approved") {
    return "Only an explicitly approved application can be submitted.";
  }
  if (state.submittedAt) return "This application has already been submitted.";
  if (state.attemptState !== "Ready") {
    return "Only an approved, fully prepared application can be submitted.";
  }
  return null;
}
