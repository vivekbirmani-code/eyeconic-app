# Deferred: Proctoring Data Deletion Cascade

**Status: DEFERRED / NOT IMPLEMENTED** (owner decision, 2026-10-24, Option A
retention). Recorded so the policy can be revisited deliberately.

## Background

The approved retention statement shown to students is:

> "Proctoring records are kept with your test records and are visible only
> to authorized administrators."

Investigation (2026-10-24) confirmed **no test-record deletion exists
anywhere**: `DELETE /api/quizzes/:id` is a soft delete (flags only);
attempts, guest leads, and proctoring records are never removed by any
route, script, or background job. The originally proposed wording —
"deleted when your test records are deleted" — would have promised an event
that cannot occur, so the shipped copy describes actual behavior.

## What a deletion cascade would need (when revisited)

- A definition of "test record deletion" (hard-delete concept that does not
  exist today; soft-deleted quizzes keep everything gradeable by design).
- Per-scope purge paths: for an attempt → its `ProctoringSession`,
  `ProctoringEvent`s, `ProctoringViolation`s, and the attempt's frozen
  `proctoringSnapshot`; for a lead → consents and all owned attempts'
  cascades; honoring the "one finalized attempt per person" audit history
  where required.
- An admin-triggered operation (endpoint + confirmation UX) rather than
  automatic deletion.
- **Backup caveat to disclose:** deleted data may persist in MongoDB Atlas
  platform backups for the backup retention window; the operation deletes
  live data only.
- Consent-copy update (new `consentTextVersion`) once the behavior exists.

## Interim policy

Records persist with their attempts (indefinite retention, admin-visible
only). No automatic deletion. If a deletion request arrives before this
feature is built, it is handled as a manual database operation by the
owner with appropriate care.
