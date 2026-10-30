import assert from "node:assert/strict";
import test from "node:test";
import { submissionBlockReason } from "./approval.js";

const readyState = {
  confirmed: true,
  automationPaused: false,
  status: "Approved",
  approvedAt: "2026-10-30T12:00:00.000Z",
  submittedAt: null,
  attemptState: "Ready",
};

test("submission is blocked unless it is approved, prepared, unpaused, and explicitly confirmed", () => {
  assert.equal(submissionBlockReason({ ...readyState, approvedAt: null, status: "Drafted" }), "Only an explicitly approved application can be submitted.");
  assert.equal(submissionBlockReason({ ...readyState, confirmed: false }), "Final confirmation is required before submitting.");
  assert.equal(submissionBlockReason({ ...readyState, automationPaused: true }), "Automation is paused. Resume it before submitting.");
  assert.equal(submissionBlockReason({ ...readyState, attemptState: "Needs input" }), "Only an approved, fully prepared application can be submitted.");
  assert.equal(submissionBlockReason({ ...readyState, attemptState: "Submitting" }), "Only an approved, fully prepared application can be submitted.");
  assert.equal(submissionBlockReason({ ...readyState, submittedAt: "2026-10-30T12:01:00.000Z" }), "This application has already been submitted.");
  assert.equal(submissionBlockReason(readyState), null);
});
