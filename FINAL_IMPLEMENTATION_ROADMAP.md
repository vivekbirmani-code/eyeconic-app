# Eyeconic Mentorship App
## Final Implementation Roadmap — Engineering Master Plan

| | |
|---|---|
| **Document Type** | Engineering Implementation Roadmap |
| **Audience** | Engineering Leadership · Product · QA · DevOps |
| **Prepared From** | Implementation Status & Completion Report v3.0 (30 July 2026) |
| **Roadmap Date** | 4 August 2026 |
| **Product** | Eyeconic Mentorship Platform (NEET / MBBS) |
| **Primary Platform** | Mobile Application |
| **Supporting Platforms** | Backend Services · Web Admin Console (secondary) |
| **Document Version** | 1.0 |
| **Purpose** | Single executable master plan for remaining work to production-ready release |

---

> **Source-of-truth note:** This roadmap derives unfinished work exclusively from the Implementation Status & Completion Report. Items not stated in the report but recommended as enterprise production practice are explicitly labelled **[Recommended Practice]** and are separable from report-mandated work.

---

# 1. Executive Summary

### Current Implementation State

Eyeconic is a role-based mentorship platform (Admin / Mentor / Student / Free User) whose **core product capability is already delivered** on the primary mobile application and shared backend. Authentication, user/mentor management, real-time group communication, audio calling, question bank, full quiz lifecycle, assignments, analytics, notifications (core), dashboards (core), and file uploads are **implemented and operational**.

The Secondary Web Admin Console exists as a supporting surface for selected admin quiz operations; it is **not** the primary product.

### Approximate Completion Level

| Indicator | Value | Interpretation |
| --------- | ----- | -------------- |
| **Overall Feature Completion** | **~72%** | Primary progress KPI — majority of planned product capability delivered |
| **Launch Readiness** | **Production Hardening In Progress** | Separate maturity track; not the same as feature % |
| **Project Health** | **On Track (Amber)** | Strong delivery with a defined launch-prep backlog |
| **Estimated remaining to mobile launch baseline** | **6–10 engineering weeks** | High-priority + medium-priority launch path |

### Overall Project Maturity

The project is in **Late Feature Development → Production Hardening**. This is a **maturity and launch-preparation stage**, not an early build stage. Twelve major milestones (Foundation through Notifications/Uploads, plus secondary admin foundations) are achieved. Remaining work is polish on live modules, hardening, QA, release verification, and selected secondary/future items.

### Remaining Engineering Effort (from report)

| Scope | Approximate Effort |
| ----- | ------------------ |
| High Priority (Launch Path) | ~3–5 engineering weeks |
| Medium Priority | ~2–3 engineering weeks |
| Production baseline (mobile launch-ready) | **6–10 engineering weeks** |
| Full long-term product vision | Additional backlog beyond launch |

### Current Development Focus

1. Close remaining partial features on the primary mobile platform  
2. Complete production hardening and quality preparation for launch  
3. Advance selected secondary admin-console improvements where they support operations  
4. Finalise release / store readiness checklist  

### What This Roadmap Achieves

This document reorganises every unfinished item from the status report into **logical engineering phases** with enough detail that a new engineering team can execute phase-by-phase without re-reading the status report. It defines current state, remaining work, functional/technical requirements, dependencies, acceptance criteria, priorities, estimates, risks, and a master execution checklist.

---

# 2. Guiding Principles

Every implementation task in this roadmap **must** follow enterprise-level engineering practices. These principles apply to mobile, backend, and secondary admin console work alike.

| Principle | Expectation |
| --------- | ----------- |
| **Production-ready architecture** | Changes must fit the existing mobile + backend + realtime foundation; no throwaway paths for launch-critical work. |
| **Scalable implementation** | Designs must tolerate growth in users, groups, quizzes, and notification volume without redesign of core flows. |
| **Modular design** | Features should be isolated by domain (auth, quiz, calls, notifications, settings) with clear boundaries. |
| **Maintainability** | Prefer clear structure, consistent patterns with existing codebase, and avoid one-off special cases. |
| **Clean code** | Readable, reviewable changes; no unrelated refactors mixed into feature work. |
| **Security first** | AuthN/AuthZ, input validation, secrets hygiene, and least-privilege access are non-negotiable for launch. |
| **Proper validation** | Client and server validation for all user inputs, imports, and role-gated actions. |
| **Error handling** | User-visible failures must be actionable; server errors must be logged with correlation context. |
| **Logging** | Structured operational logs for auth, payments-adjacent paths (future), quiz attempts, calls, and push delivery. |
| **Performance** | Dashboards, quiz attempt, chat, and call flows must remain responsive at current and near-term scale. |
| **Accessibility** | Interactive surfaces should support readable contrast, focus/order where applicable, and clear labels. |
| **Testing** | Critical paths require automated and/or formal manual coverage before launch gate. |
| **Documentation** | Release checklists, env vars, and operational runbooks updated when behaviour changes. |
| **Consistent UX** | Polish items must align with existing role-aware mobile patterns; no divergent interaction models. |
| **Backward compatibility** | Do not break existing sessions, attempt data, quiz shares, or push registrations when shipping polish. |

---

# 3. Engineering Phases — Overview

Remaining work is organised into nine phases. Phases 1–4 and 8 are on the **launch-critical path**. Phases 5–7 strengthen product completeness around launch or immediately after. Phase 9 is explicitly **post-launch / future**.

| Phase | Name | Launch Relationship | Approx. Timing (from report) |
| ----- | ---- | ------------------- | ---------------------------- |
| **1** | Critical Feature Completion | **Launch Blocker / P0** | Near-term (within High Priority 3–5 weeks) |
| **2** | Production Hardening | **Launch Blocker / P0** | Next after / parallel with polish |
| **3** | Quality Assurance Baseline | **Launch Blocker / P0** | Launch prep |
| **4** | Performance & Operational Monitoring | **Launch Requirement / P1** | Developing → planned |
| **5** | Settings & Profile Completion | **Launch Requirement / P1–P2** | Mid-term (~2–3 weeks medium bucket) |
| **6** | Free-User Experience Uplift | **Launch Requirement / P2** | Mid-term |
| **7** | Engagement Polish (Notifications, Calls, Dashboard KPIs) | **Launch Requirement / P1** | Mid-term |
| **8** | Secondary Admin Console Completion | **Launch Support / P1–P2** | Near-term selected gaps; broader chat later |
| **9** | Launch Readiness & Release | **Launch Gate / P1** | After hardening + critical polish |
| **10** | Future Expansion | **Post-launch / P3** | Scope-dependent thereafter |

> Phase numbering in detailed sections below uses a consolidated **Phase 1–9** structure matching the requested engineering breakdown, with Future Expansion as Phase 9.

**Consolidated phase map used in this document:**

1. **Phase 1** — Critical Feature Completion  
2. **Phase 2** — Production Hardening  
3. **Phase 3** — Quality Assurance  
4. **Phase 4** — Performance Optimization  
5. **Phase 5** — Settings & Profile Completion  
6. **Phase 6** — Free User Experience  
7. **Phase 7** — Secondary Admin Console Completion  
8. **Phase 8** — Launch Readiness  
9. **Phase 9** — Future Expansion  

**Cross-cutting note:** Notification routing, audio call reliability, and dashboard KPI enrichment are medium-priority launch-path items. They are detailed primarily under **Phase 1 (where near-term)** and **Phase 4 / engagement subsections**, and also appear in the Master Checklist so nothing is lost. Free-user and Settings remain dedicated phases per report structure.

---

# 4. Phase 1 — Critical Feature Completion

## Objective

Close remaining **partial / polish** gaps on already-delivered mobile modules so core assessment and mentorship behaviours are consistent, unambiguous, and launch-safe.

## Why This Phase Exists

The report identifies these as **P0 Critical Feature Closure** and **High Priority (Launch Path)** items. Foundations exist; unfinished edge behaviour (retest rules, guest results, mentor quiz clarity) creates user confusion and support risk if shipped unfinished.

## Features Included

1. Retest lifecycle polish  
2. Guest quiz result presentation  
3. Mentor quiz experience clarity  
4. Audio call reliability (initial reliability pass — continued in mid-term)  
5. Notification routing / open-from-notification navigation (start; may complete mid-term)  
6. Dashboard KPI enrichment (start; mid-term completion acceptable)  
7. Selected secondary admin-console gaps that unblock operations (cross-link to Phase 7)

---

## Feature 1.1 — Retest Lifecycle Polish

| Attribute | Value |
| --------- | ----- |
| **Priority** | Critical |
| **Estimate** | Medium |
| **Dependencies** | Existing retest request & approval flows (delivered) |
| **Risk** | Medium — incorrect rules can allow unfair retakes or block legitimate ones |
| **Impact** | High — assessment integrity and student/mentor trust |

### Current State

Request + approve is available. Quiz platform already includes retest request & decision.

### Remaining Work

Establish and enforce **consistent retake rules** across the full retest lifecycle (request → decision → retake attempt → results).

### Functional Requirements

- Define and document when a student may request a retest.  
- Define mentor/admin approval/rejection outcomes and what each unlocks.  
- After approval, student must be able to start a retake under the agreed rules (attempt count, score handling, visibility).  
- Rejected requests must show clear status and not allow retake.  
- Behaviour must be consistent across student, mentor, and admin views of the same quiz/attempt.  

### Technical Requirements

- Align client UI states with server-authoritative retest status.  
- Ensure retake attempts are distinguishable from original attempts in results/analytics where the product already surfaces attempts.  
- No silent dual-active attempts if rules disallow them.  

### Backend Changes

- Review and harden retest state machine (pending / approved / rejected / consumed).  
- Enforce retake eligibility server-side (never trust client-only flags).  
- Ensure attempt creation endpoints reject invalid retakes with clear error codes.  

### Frontend Changes (Mobile)

- Consistent status labels and CTAs on quiz/result screens.  
- Clear messaging for pending approval, approved (start retake), rejected.  
- Prevent dead-end UI where approval exists but start-retake is unclear.  

### API Requirements

- Stable status fields on quiz/attempt/retest resources.  
- Explicit error responses for ineligible retake attempts.  

### Database Changes

- Confirm existing retest/attempt records support rule enforcement; add fields only if current schema cannot express eligibility/consumed state (prefer extending existing model).  

### UI Changes

- Unified status presentation across student and mentor surfaces.  
- Avoid conflicting copy (“Request again” vs “Retake available”) for the same state.  

### Validation

- Role checks on approve/reject.  
- Idempotent approval (double-approve must not create duplicate entitlements).  

### Error Handling

- Network failure during request/approve must not leave ambiguous local-only state.  
- Show recoverable errors with retry where safe.  

### Security

- Only authorised mentor/admin roles can approve/reject.  
- Students cannot self-approve or forge retake tokens.  

### Performance Considerations

- Status reads should use existing quiz/attempt fetches; avoid N+1 on list screens.  

### Edge Cases

- Student requests while approval already pending.  
- Approval after quiz share/expiry rules (if any exist in product).  
- Concurrent approve + student attempt start.  
- Mentor viewing retest for quizzes they did not create (respect existing assignment/role rules).  

### User Experience Expectations

Students and mentors should always know: **can I retake, why not, and what happens next?**

### Testing Requirements

- Manual + automated critical-path tests for request → approve → retake → results.  
- Negative tests: reject, unauthenticated, wrong role.  

### Definition of Done

- [ ] Retake rules documented and implemented consistently on mobile + API  
- [ ] Server rejects ineligible retakes  
- [ ] UI states match API for all retest statuses  
- [ ] Critical-path QA signed off  
- [ ] Analytics/results still correctly attribute original vs retake attempts  

---

## Feature 1.2 — Guest Quiz Result Presentation

| Attribute | Value |
| --------- | ----- |
| **Priority** | Critical |
| **Estimate** | Medium |
| **Dependencies** | Guest/public attempt links (attempt/submit live at ~75% module) |
| **Risk** | Medium — public-facing UX; incorrect scoring display damages trust |
| **Impact** | High — acquisition / share-link conversion |

### Current State

Guest / Public Quiz module is **In Progress (~75%)**. Attempt and submit are live; **clear outcome presentation is pending**.

### Remaining Work

Deliver a clear **post-submit results experience** for guest/public attempts.

### Functional Requirements

- After guest submit, show outcome (score/percentage and/or pass-fail as product rules dictate).  
- Present readable summary of performance appropriate for an unauthenticated or lightly authenticated guest context.  
- Indicate whether detailed review (answers/solutions) is allowed for guests; if not, explain clearly.  
- Handle expired/invalid share links with a clear message (no blank screens).  

### Technical Requirements

- Results screen must consume the same authoritative scoring as authenticated flows where applicable.  
- Guest session/token constraints must still apply after submit.  

### Backend Changes

- Ensure public attempt submit returns (or exposes) sufficient result payload for presentation.  
- Do not leak mentor-only or student PII in public result responses.  

### Frontend Changes (Mobile / public attempt surface)

- Dedicated result presentation UI after guest submit.  
- Loading, error, and empty states for failed result fetch.  

### API Requirements

- Public result endpoint or submit response includes score summary fields needed by UI.  
- Auth scope limited to guest attempt token.  

### Database Changes

- Prefer existing attempt/result storage; no new domain unless report gaps require it (none stated beyond presentation).  

### UI Changes

- Clear headline result, supporting summary, and next-step CTA (e.g., close / try another if allowed).  
- Consistent branding with existing quiz attempt UI.  

### Validation

- Guest token validity on result fetch.  
- Attempt must be submitted before results render.  

### Error Handling

- Submit succeeded but result fetch failed → show retry without forcing double-submit.  

### Security

- No exposure of other users’ attempts.  
- Rate-limit public endpoints **[Recommended Practice]** if not already present.  

### Performance Considerations

- Result payload should be lightweight for public links.  

### Edge Cases

- Double-submit / refresh after submit.  
- Network drop between submit and results screen.  
- Quiz configured with zero questions or unexpected empty result set.  

### User Experience Expectations

A guest finishing a shared quiz immediately understands their outcome without logging in (unless product requires login for detailed review).

### Testing Requirements

- End-to-end guest link → attempt → submit → results.  
- Invalid/expired link tests.  

### Definition of Done

- [ ] Guest post-submit results screen shipped and clear  
- [ ] Score/outcome matches server calculation  
- [ ] No PII leakage in public responses  
- [ ] QA sign-off on happy path and expired-link path  

---

## Feature 1.3 — Mentor Quiz Experience Clarity (View vs Attempt)

| Attribute | Value |
| --------- | ----- |
| **Priority** | Critical |
| **Estimate** | Small–Medium |
| **Dependencies** | Mentors can already view tests |
| **Risk** | Low–Medium — mainly UX clarity; accidental mentor attempts may pollute data |
| **Impact** | High — mentor operational clarity |

### Current State

Mentors can view tests; **clearer view-vs-attempt behaviour** is remaining.

### Remaining Work

Make it unambiguous when a mentor is **previewing/viewing** a quiz versus **attempting** it as a student would.

### Functional Requirements

- Distinct entry points or explicit mode labels: View/Preview vs Attempt (if attempt is allowed).  
- If mentors should not create student-like attempts by default, block or warn before starting an attempt.  
- Viewing must not silently create attempt records unless intended.  

### Technical Requirements

- Client navigation and API calls must use the correct mode/endpoints.  
- Attempt-creation calls gated by role policy.  

### Backend Changes

- Confirm role policy for mentor attempt creation; enforce server-side.  
- Optional: preview endpoint that returns questions without creating an attempt (if not already available).  

### Frontend Changes

- Clear CTAs and screen titles (“Preview quiz” vs “Start attempt”).  
- Disable or hide student-only controls in view mode.  

### API / Database / Security

- Authorisation checks on attempt start.  
- Audit that mentor preview does not mutate student analytics incorrectly.  

### Edge Cases

- Mentor who is also assigned as a learner (if possible in org model).  
- Shared quiz links opened while logged in as mentor.  

### Testing Requirements

- Mentor open quiz → preview only (no attempt row).  
- If attempt allowed → explicit confirm → attempt created once.  

### Definition of Done

- [ ] Mentors cannot accidentally start attempts without clear intent  
- [ ] UI copy/modes distinguish view vs attempt  
- [ ] Analytics not polluted by unintended mentor attempts  

---

## Feature 1.4 — Audio Call Reliability (Launch-Path Pass)

| Attribute | Value |
| --------- | ----- |
| **Priority** | High (report: Mid-term polish; P1 Notification & Call Polish) |
| **Estimate** | Large |
| **Dependencies** | Audio calling delivered on native builds (initiate/join/leave/mute/end, push wake, active-call indicator) |
| **Risk** | High — realtime/network variability |
| **Impact** | High — mentorship communication quality |

### Current State

Audio Calls module **In Progress (~68%)**. Calls are live on native builds; **broader network success** improvements ongoing.

### Remaining Work

Improve call success rates across weaker/variable networks; reduce failed joins and dropped sessions where feasible within existing architecture.

### Functional Requirements

- Reliable call initiate and incoming accept under typical mobile network conditions.  
- Clear user feedback when join fails (retry guidance).  
- Mute/leave/end remain reliable during degraded network.  
- Push wake for incoming calls continues to work after reliability changes.  

### Technical Requirements

- Instrument failure points (signalling, media connect, push-to-join). **[Recommended Practice]** if not already instrumented.  
- Harden reconnect / rejoin behaviour where architecture supports it.  

### Backend / API / Realtime

- Review call signalling and presence for race conditions (caller cancels, callee slow join).  
- Ensure push payload still routes to correct call session.  

### Frontend (Native Mobile)

- Improve error states and retry affordances.  
- Avoid stuck “connecting” UI without timeout.  

### Validation / Security

- Only group members / authorised roles may join.  
- Call tokens/sessions must expire appropriately **[Recommended Practice]**.  

### Edge Cases

- App backgrounded during ring.  
- Switch networks mid-call (Wi-Fi ↔ cellular).  
- Simultaneous calls / stale active-call indicator.  

### Testing Requirements

- Device matrix testing on weak network / airplane-mode toggle.  
- Push-killed app → incoming call wake.  

### Definition of Done

- [ ] Measurable improvement in join success on target test networks  
- [ ] No stuck call UI without recovery path  
- [ ] Push wake regression-tested  
- [ ] Known limitations documented for support  

---

## Feature 1.5 — Notification Routing (Open-from-Notification)

| Attribute | Value |
| --------- | ----- |
| **Priority** | High |
| **Estimate** | Medium |
| **Dependencies** | Core push sending live; in-app unread/unseen indicators delivered |
| **Risk** | Medium — deep-link mismatches cause blank screens |
| **Impact** | High — engagement and operational responsiveness |

### Current State

Notifications core **Completed (~62%\*)** — remaining % reflects polish (open-from-notification behaviour), not absence of module. Push registration and event-driven push for key activities exist.

### Remaining Work

When a user opens the app **from a push notification**, navigate to the correct destination (chat, quiz, assignment, retest, call, etc.).

### Functional Requirements

- Cold start and warm start from notification both route correctly.  
- Tapping a notification marks/consumes unseen state consistently with in-app indicators where applicable.  
- Invalid/stale notification targets show a safe fallback (home/dashboard) with message.  

### Technical Requirements

- Notification payload includes stable type + target IDs.  
- Router maps type → screen with auth/session gate.  

### Backend Changes

- Ensure push payloads for key events include routing metadata.  
- Backward compatible with older app versions where possible.  

### Frontend Changes

- Central notification-open handler.  
- Auth restore before navigation if session needed.  

### Security

- Do not navigate to resources the user is unauthorised to see; re-check on open.  

### Edge Cases

- Logged out user taps notification.  
- Target deleted (group/quiz removed).  
- Multiple notifications queued.  

### Testing Requirements

- Per event type: receive → tap → land on correct screen.  
- Cold start and backgrounded app cases.  

### Definition of Done

- [ ] Open-from-notification works for key activity types used in production pushes  
- [ ] Unauthorised/stale targets fail safely  
- [ ] Regression on in-app unread badges  

---

## Feature 1.6 — Dashboard KPI Enrichment

| Attribute | Value |
| --------- | ----- |
| **Priority** | Medium–High |
| **Estimate** | Medium |
| **Dependencies** | Role-based dashboards exist (Admin / Mentor / Student / Free-user) |
| **Risk** | Low–Medium — query cost if KPI aggregation is heavy |
| **Impact** | Medium–High — operational visibility |

### Current State

Dashboard (core) **In Progress (~65%)** — usable; **richer operational KPIs planned**.

### Remaining Work

Enrich role home dashboards with stronger **operational KPI summaries** (beyond current baseline).

### Functional Requirements

- Role-appropriate KPI cards/summaries for Admin, Mentor, Student (and Free-user where relevant — see Phase 6).  
- KPIs must reflect real backend data already available from analytics/assignments/quizzes where possible.  
- Loading and empty states for zero-activity orgs.  

### Technical Requirements

- Prefer aggregated endpoints over client-side fan-out of many list calls.  
- Cache or reuse session dashboard fetch reasonably.  

### Backend / API / Database

- Add or extend summary endpoints if current APIs cannot supply KPI totals efficiently.  
- Use existing analytics/assignment/quiz data sources; avoid inventing metrics not supported by data.  

### Frontend

- Extend existing dashboard layouts without turning homes into unrelated dashboards of clutter; keep role-aware clarity.  

### Performance

- Dashboard load must remain acceptable on mobile networks.  

### Definition of Done

- [ ] Agreed KPI set per role implemented and accurate  
- [ ] Empty/loading/error states complete  
- [ ] Performance acceptable on representative data volume  

---

# 5. Phase 2 — Production Hardening

## Objective

Meet baseline **security and reliability expectations** required before broad public / store production use (report: Security Hardening In Progress; P0 Production Hardening Gate).

## Why This Phase Exists

Launch readiness assessment lists Security Hardening as **In Progress** and required before broad public launch. Architecture and backend are strong; hardening is the remaining gate for production trust.

## Features / Workstreams Included

1. Security & authentication/authorization review  
2. API protection & input validation  
3. Secure storage & secrets management  
4. Logging, monitoring, crash/error tracking  
5. Network resilience & retry behaviour  
6. Environment & deployment validation  
7. Backup / operational continuity considerations  

---

## 2.1 Security Review & Auth Hardening

| Attribute | Value |
| --------- | ----- |
| **Priority** | Critical |
| **Estimate** | Large |
| **Dependencies** | Auth delivered (login, OTP signup, forgot password, session restore, RBAC) |
| **Risk** | High if skipped |
| **Impact** | Critical |

### Current State

Authentication & Access **Completed (~82%)** — core flows live. Security hardening package is **High Priority launch path** and **Active next focus**.

### Remaining Work

Complete a production security hardening pass over authentication, session handling, and role-based access.

### Detailed Tasks

**Authentication validation**

- Verify email/password, OTP signup, forgot-password, and session restore under failure and abuse scenarios.  
- Confirm session expiry/logout behaviour is consistent on mobile.  

**Authorization review**

- Re-verify Admin / Mentor / Student / Free User boundaries on sensitive APIs (user management, quiz control, retest approval, analytics export, group admin actions).  

**API protection**

- Confirm authenticated routes reject missing/invalid tokens.  
- Confirm role middleware on admin/mentor mutations.  

**Input validation**

- Server-side validation on create-user, quiz/question import, chat metadata, assignment create, file upload content types/sizes.  

**Rate limiting** **[Recommended Practice — label if not already in report as explicit feature]**

- Protect login, OTP, password reset, and public guest quiz endpoints from brute force / abuse.  

**Secure storage**

- Ensure tokens/credentials on device use platform-secure storage patterns already appropriate for the stack; remediate any plaintext secrets in app config.  

**Secrets management**

- Production secrets only via environment / secret store; no committed secrets.  
- Validate staging vs production key separation.  

### Definition of Done

- [ ] Security review checklist completed and findings triaged  
- [ ] Critical authZ gaps fixed  
- [ ] Secrets scrubbed from client/repo for production builds  
- [ ] Abuse-prone endpoints have basic protections or accepted risk documented  

---

## 2.2 Reliability, Logging & Observability

| Attribute | Value |
| --------- | ----- |
| **Priority** | Critical |
| **Estimate** | Medium–Large |
| **Dependencies** | Backend services strong; Performance & operational monitoring planned |
| **Risk** | Medium |
| **Impact** | High — incident response capability |

### Remaining Work (report-derived)

Performance & operational monitoring is a **planned** challenge for stable scaled usage.

### Detailed Tasks

**Logging**

- Structured logs for auth failures, quiz submit failures, push send failures, call signalling errors.  

**Monitoring** **[mix: report requires operational monitoring; tooling choices are Recommended Practice]**

- Health checks on API and critical dependencies.  
- Alerting on error-rate spikes.  

**Crash reporting / error tracking** **[Recommended Practice]**

- Mobile crash reporting enabled for release builds.  
- Backend error tracking for unhandled exceptions.  

**Analytics** **[Recommended Practice for product analytics; report already has assessment analytics]**

- Confirm operational analytics needed for launch (distinct from quiz analytics module).  

**Network resilience & retry logic**

- Idempotent retries for safe GETs; careful retry on submit/payment-like mutations.  
- User-visible offline/poor-network messaging on critical flows (full offline is Phase 9).  

**Backup strategy** **[Recommended Practice]**

- Confirm database backup/restore procedure for production data stores.  

### Definition of Done

- [ ] Minimum logging for critical domains in production config  
- [ ] Monitoring/alerting baseline agreed and enabled  
- [ ] Crash/error reporting enabled for release candidates **[Recommended Practice]**  
- [ ] Backup/restore validated at least once in staging **[Recommended Practice]**  

---

## 2.3 Environment, Deployment & Configuration Validation

| Attribute | Value |
| --------- | ----- |
| **Priority** | Critical |
| **Estimate** | Medium |
| **Dependencies** | Deployment process developing; mobile release path documented; final checklist remains |

### Remaining Work

Finalise environment validation and deployment verification for production.

### Detailed Tasks

- Inventory required environment variables for backend and mobile (API URLs, push keys, storage keys, realtime config).  
- Validate staging parity with production configuration shape.  
- Deployment validation: build → deploy → smoke test pipeline documented.  
- Confirm push notification credentials for production apps.  
- Confirm file upload / media pipeline credentials for production.  

### Definition of Done

- [ ] Env var checklist complete and verified on staging  
- [ ] Production deploy dry-run successful  
- [ ] No critical config drift between documented and actual  

---

# 6. Phase 3 — Quality Assurance

## Objective

Establish the **quality baseline** and initial automated coverage for critical user journeys (report: Automated Testing Program Pending 0%; Initial automated quality coverage is High Priority launch path; Quality Baseline is P0).

## Why This Phase Exists

Without a QA baseline, launch confidence is unprotected. The report treats automated testing as **starting / to be established as part of launch prep**, not as a completed capability.

## Features Included

1. Manual test program for critical paths  
2. Initial automated checks for critical flows  
3. Role-based, API, regression, device, network, notification, and audio call test suites  
4. Acceptance testing against Definition of Done for Phase 1–2  

---

## 3.1 QA Program Structure

### Manual Testing

Cover all primary mobile journeys:

- Auth: login, OTP signup, forgot password, session restore, logout  
- Admin user/mentor management  
- Groups/chat attachments and member management  
- Audio call initiate/incoming/join/leave  
- Question bank + Excel import  
- Quiz create → share → attempt → results → retest  
- Guest attempt → results (after Feature 1.2)  
- Assignments create → complete → verify/redo  
- Analytics views + CSV export  
- Notifications receive + open routing (after Feature 1.5)  
- Profile completion  
- Free-user shell (and content after Phase 6)  

### Integration Testing

- Mobile ↔ API for auth, quiz attempt autosave/submit, chat send, push registration.  
- Guest public link ↔ attempt APIs.  

### Regression Testing

- After each Phase 1 polish merge, re-run critical-path smoke pack.  

### Role Testing

- Explicit matrices for Admin, Mentor, Student, Free User permissions on key screens/APIs.  

### API Testing

- Auth negative tests, role denial tests, validation error contracts, guest token boundaries.  

### Performance Testing

- Dashboard load, quiz attempt with realistic question counts, chat history scroll, analytics export size sanity.  

### Device Testing

- Representative iOS/Android versions used for native audio calling and push.  

### Network Testing

- Poor network, intermittent connectivity, airplane mode toggles during attempt autosave and calls.  

### Notification Testing

- Foreground / background / killed states; tap routing.  

### Audio Call Testing

- Caller/callee matrices; push wake; mute/end; failure injection.  

### Offline Scenarios

- Document current behaviour (no full offline yet).  
- Ensure graceful degradation messaging (full offline is Phase 9).  

### Failure Scenarios

- API 5xx, token expiry mid-flow, upload failure, push registration failure.  

### Edge Cases

- Retest races, guest refresh after submit, mentor preview vs attempt, deleted group notification tap.  

### Acceptance Testing

- Product sign-off against Phase 1 DoDs and Phase 2 hardening gate.  

---

## 3.2 Initial Automated Quality Coverage

| Attribute | Value |
| --------- | ----- |
| **Priority** | Critical |
| **Estimate** | Large (program start); Medium for first critical pack |
| **Dependencies** | Stable APIs for auth, quiz attempt, retest |
| **Risk** | Medium — flaky tests if over-broad too early |
| **Impact** | High |

### Remaining Work

Automated Testing Program is **Pending (0%)**. Launch path requires **initial** automated checks for critical flows — not the entire long-term suite on day one.

### Recommended First Automation Pack (report-aligned)

1. Auth login success/failure  
2. Quiz attempt submit scoring smoke  
3. Retest request/approve entitlement  
4. Guest attempt submit + result payload  
5. Role denial on admin-only route  

### Definition of Done (QA Phase for launch)

- [ ] Critical-path manual test pack executed and results recorded  
- [ ] Initial automated checks running in CI or pre-release pipeline  
- [ ] P0 bugs from polish/hardening triaged  
- [ ] Go/No-Go QA recommendation issued for launch checklist  

---

# 7. Phase 4 — Performance Optimization

## Objective

Move Performance from **Developing** (adequate for current scale; optimisation planned) to a launch-acceptable, monitored baseline.

## Why This Phase Exists

Launch readiness lists Performance as Developing. Operational monitoring is planned to support stable scaled usage.

## Features Included

1. Mobile performance profiling of primary journeys  
2. API/query optimisation for dashboards, analytics, chat  
3. Bundle / app size awareness for store release **[Recommended Practice]**  
4. Memory stability for quiz attempt and call sessions **[Recommended Practice]**  

---

## Detailed Implementation Tasks

### Frontend (Mobile)

- Profile cold start, dashboard, quiz attempt, chat thread open.  
- Eliminate unnecessary re-renders/refetches on home KPI enrichment.  
- Image/media load behaviour in chat and questions.  

### Backend / API / Database

- Review slow endpoints used by dashboards and analytics export.  
- Add indexes or aggregations only where measured need exists.  
- Pagination discipline on lists (users, questions, messages).  

### Validation / Edge Cases

- Large question banks, large groups, heavy analytics CSV.  

### Security / Performance balance

- Do not disable auth checks for speed.  

### Testing

- Before/after timings on agreed scenarios.  

### Definition of Done

- [ ] No known P0 performance defects on critical paths  
- [ ] Dashboard and attempt flows meet agreed latency targets for current scale  
- [ ] Export/chat extremes documented with mitigations  

---

# 8. Phase 5 — Settings & Profile Completion

## Objective

Complete the **dedicated Settings experience** and finish profile/account completeness beyond existing profile completion flows (module Partial ~45%).

## Why This Phase Exists

Report lists Profile & Settings as Partial; Dedicated Settings screen is Medium Priority and P2 Settings & Profile Completeness milestone. Profile completion exists; Settings is pending.

## Features Included

1. Dedicated Settings screen/module  
2. Profile completeness improvements tied to account experience  
3. Session/logout controls remain coherent with settings IA  

---

## Feature 5.1 — Dedicated Settings Module

| Attribute | Value |
| --------- | ----- |
| **Priority** | Medium (High Priority launch path lists polish first; Settings is Medium Priority but on mid-term launch completeness) |
| **Estimate** | Medium–Large |
| **Dependencies** | Profile completion flows delivered; auth session/logout controls exist |
| **Risk** | Low–Medium |
| **Impact** | Medium — account ownership and supportability |

### Current State

Profile completion exists. **Dedicated settings experience pending.** Module completion ~45%.

### Remaining Work

Ship a dedicated Settings experience on mobile for account/preferences/session management appropriate to roles.

### Functional Requirements

- Central Settings entry from profile or standard account affordance.  
- Account information view/edit where already supported by backend.  
- Access to logout / session controls from Settings (consistent with existing logout).  
- Password change / notification preferences if already supported by APIs; if not, scope only what backends allow (do not invent payment settings here).  
- Role-safe: Free User vs Student vs Mentor vs Admin see only relevant items.  

### Technical Requirements

- Settings as modular screens; reuse existing profile APIs.  
- Form validation and save/error states.  

### Backend Changes

- Use existing profile endpoints; extend only if settings fields lack persistence.  

### Frontend Changes

- New Settings navigation and screens.  
- Wire profile edit fields already available.  

### API / Database

- Persist only fields supported by current user model.  

### UI Changes

- Clear information architecture: Account, Security/Session, Notifications (as available), About/App version **[About version = Recommended Practice]**.  

### Security

- Sensitive actions re-auth if required by existing patterns.  
- No exposure of admin-only controls to students.  

### Edge Cases

- Incomplete profile user opening Settings.  
- Session expiry while editing.  

### Testing Requirements

- Save profile from Settings; logout; role-specific menu visibility.  

### Definition of Done

- [ ] Dedicated Settings screen shipped on mobile  
- [ ] Profile completion/edit reachable and functional  
- [ ] Logout/session controls consistent  
- [ ] Role-appropriate settings visibility verified  

---

# 9. Phase 6 — Free User Experience

## Objective

Uplift Free-User experience from **shell (~25%)** to **real content/data** behind free-user screens (P2 Free-User Experience Uplift; Medium Priority free-user real content).

## Why This Phase Exists

Free-user content maturity improves acquisition experience and is an explicit mid-term workstream. Screens exist; content maturity is pending.

## Features Included

1. Free-user dashboard real content wiring  
2. Free-user accessible learning/assessment content as product rules allow  
3. Clear upgrade/paid boundary messaging (payment integration itself is Future — Phase 9)  

---

## Feature 6.1 — Free-User Real Content & Data

| Attribute | Value |
| --------- | ----- |
| **Priority** | Medium |
| **Estimate** | Medium–Large |
| **Dependencies** | Free-user dashboards/screens exist; Free vs paid student controls delivered on admin side |
| **Risk** | Medium — accidental paid-content leakage |
| **Impact** | High for acquisition funnel |

### Current State

Free-User Experience **Partial (~25%)**. Shell present; **real content/data pending**.

### Remaining Work

Wire real content and data into free-user surfaces; enforce free vs paid boundaries consistently.

### Functional Requirements

- Free-user home shows meaningful content (not empty placeholders).  
- Content must respect free-tier entitlements already implied by Free/Paid controls.  
- Clear CTAs for limited features (without requiring full payment integration if payments are future).  
- Free user must not access paid-only mentorship resources (groups/quizzes/assignments) contrary to policy.  

### Technical Requirements

- Entitlement checks client + server.  
- Content sources from existing question/quiz/content APIs filtered by free access rules.  

### Backend / API / Database

- Filter endpoints by free-user flag / plan.  
- Ensure admin Free/Paid toggles immediately affect access.  

### Frontend

- Replace shell placeholders with live lists/cards.  
- Empty states when no free content configured.  

### Security

- Server-side enforcement is mandatory; UI hide is insufficient.  

### Edge Cases

- User upgraded Free → Paid mid-session.  
- User downgraded Paid → Free.  

### Testing

- Free user happy path; paid-only denial; admin toggle effect.  

### Definition of Done

- [ ] Free-user screens show real data  
- [ ] Paid-only resources blocked server-side  
- [ ] Empty and error states complete  
- [ ] Product acceptance on free-tier scope  

---

# 10. Phase 7 — Secondary Admin Console Completion

## Objective

Close **selected user/group management gaps** on the secondary web admin console and, as medium priority, broaden chat parity — without treating the console as the primary product.

## Why This Phase Exists

Secondary Admin Console is **In Progress (~55%)**, useful for quiz ops, developing for launch readiness. Selected gaps are High Priority where they aid operations; broader chat parity is Medium Priority. Mobile remains primary.

## Features Included

1. Selected user/group management actions (near-term)  
2. Broader secondary-console chat parity (medium priority)  
3. Maintain quiz hub / question bank / analytics / retests strengths already delivered  

---

## Feature 7.1 — Selected User / Group Management Actions

| Attribute | Value |
| --------- | ----- |
| **Priority** | High (where operations-blocking) |
| **Estimate** | Medium |
| **Dependencies** | Console has login, quiz tools, user/group listing, basic text chat |
| **Risk** | Medium — dual-surface drift vs mobile admin |
| **Impact** | Medium — desktop admin convenience |

### Current State

Foundations delivered: admin login; quiz hub, question bank, create/import, analytics, retests; user/group listing; basic text chat. Remaining: **selected user/group management actions**.

### Remaining Work

Implement the missing admin actions on web that operators need for convenience, aligned with mobile capabilities (create/manage users, filters, password reset, free/paid, mentor–student assignment, subject assignment, group member management — **only the selected gaps required for operations**, not necessarily full mobile parity in one pass).

### Functional Requirements

- Identify operations currently forcing admins back to mobile; close those gaps first.  
- Actions must call the same backend authorisation model as mobile.  
- Success/error toasts and list refresh after mutations.  

### Technical Requirements

- Reuse existing backend APIs; avoid a second business-logic stack.  
- Form validation matching mobile rules.  

### Frontend (Web)

- UI for selected management actions on user/group pages.  

### Backend / API / Database

- Prefer zero backend change if APIs exist; fix gaps only if web needs fields mobile already uses.  

### Security

- Admin-only routes; CSRF/session hardening as applicable to web stack **[Recommended Practice]**.  

### Testing

- Role denial for non-admin.  
- Parity checks: same action on web vs mobile yields same data.  

### Definition of Done

- [ ] Agreed selected actions implemented on console  
- [ ] API authorisation verified  
- [ ] Ops stakeholders can complete target workflows without mobile for those actions  

---

## Feature 7.2 — Broader Secondary-Console Chat Parity

| Attribute | Value |
| --------- | ----- |
| **Priority** | Medium |
| **Estimate** | Large |
| **Dependencies** | Basic text chat exists on console; full mobile chat suite is richer |
| **Risk** | Medium |
| **Impact** | Medium |

### Current State

Basic text chat on console; mobile has attachments, edit/delete, read receipts, etc.

### Remaining Work

Improve chat parity toward mobile capabilities as needed for admin desktop convenience (attachments, richer member-aware behaviours — scope to what report calls “broader chat parity”).

### Definition of Done

- [ ] Agreed parity subset shipped  
- [ ] Does not regress quiz admin tools  
- [ ] Explicitly accepted that full mobile parity may remain post-launch if not required for ops  

---

# 11. Phase 8 — Launch Readiness

## Objective

Complete **Mobile Launch Checklist / store & production release verification** (P1) and confirm the platform is suitable to move from controlled/staging use to public production launch after hardening + critical polish.

## Why This Phase Exists

Deployment process is Developing; final checklist remains. Next release goal is a production-ready mobile release baseline.

## Features Included

1. Backend readiness verification  
2. Mobile / store readiness  
3. Database & environment readiness  
4. Push, auth, analytics, monitoring gates  
5. Security & performance sign-off  
6. Final smoke tests & rollback planning  

---

## 8.1 Production Launch Checklist

### Backend Readiness

- [ ] Core business APIs stable on production environment  
- [ ] Auth, quiz, chat, notifications, uploads verified  
- [ ] Health checks passing  
- [ ] Migrations applied and verified  

### Mobile Readiness

- [ ] Release candidate build for primary OS targets  
- [ ] Native audio calling verified on release build  
- [ ] Push registration on release credentials  

### Database Readiness

- [ ] Production schema matches required models  
- [ ] Backup/restore procedure validated **[Recommended Practice]**  

### Environment Variables

- [ ] All required secrets present in production secret store  
- [ ] No debug-only flags enabled  

### API Verification

- [ ] Smoke suite against production or production-like staging  
- [ ] Guest public quiz links work with production routing  

### Push Notifications

- [ ] Production push certificates/keys valid  
- [ ] Event-driven pushes for key activities verified  
- [ ] Open-from-notification routing verified (Phase 1.5)  

### Authentication

- [ ] Login, OTP signup, forgot password, session restore verified on RC  
- [ ] RBAC spot-checks passed  

### Analytics

- [ ] Assessment analytics and CSV export verified  
- [ ] Operational analytics/crash pipelines verified **[Recommended Practice]**  

### Monitoring / Crash Reporting

- [ ] Monitoring dashboards/alerts live  
- [ ] Mobile crash reporting receiving events in staging/RC **[Recommended Practice]**  

### Performance

- [ ] Critical-path performance accepted for current scale  

### Security

- [ ] Hardening gate (Phase 2) signed off  
- [ ] No critical open vulnerabilities  

### Store Readiness

- [ ] Store listing assets/metadata prepared as required by release process  
- [ ] Privacy/permissions disclosures aligned with chat, mic (calls), push, uploads  

### Release Validation

- [ ] Versioning/changelog recorded  
- [ ] Release candidate signed by Eng + QA + Product  

### Final Smoke Tests

- [ ] Auth → dashboard → chat → quiz attempt → results → notification tap  
- [ ] Admin critical ops smoke  
- [ ] Guest link smoke  

### Rollback Planning

- [ ] Rollback owner and procedure documented  
- [ ] Previous store build retained  
- [ ] Backend rollback / forward-fix strategy agreed  

---

## 8.2 Launch Gate Criteria (Go / No-Go)

**Go** only if:

1. Phase 1 critical polish (retest, guest results, mentor clarity) is Done  
2. Phase 2 hardening gate is met  
3. Phase 3 quality baseline recommends Go  
4. Phase 8 checklist items for P0/P1 are complete  

**May launch with known limitations** if explicitly accepted:

- Full offline support (Future)  
- Payment / premium upgrade (Future)  
- Full secondary-console chat parity (if selected ops gaps are done)  
- Advanced reporting automation / message search / taxonomy tools (Future)  

---

# 12. Phase 9 — Future Expansion

## Objective

Capture **post-launch** and long-term vision items so they are not confused with launch blockers.

## Why This Phase Exists

Report separates Future Enhancements / P3 Expansion Features from the launch path. Including them here prevents scope creep into the 6–10 week baseline.

## Features Included (Report-Derived)

| Feature | Notes |
| ------- | ----- |
| Full offline mode / offline support | Pending ~15%; resilience enhancement; Future |
| Payment / premium upgrade | Future; conversion beyond free/paid admin controls |
| Broader browser-based student experiences | Future secondary-surface growth |
| Advanced content taxonomy tools | Future |
| Message search | Future |
| Advanced reporting automation | Future |
| Broader secondary-surface expansion | Long-term |

## Treatment Rules

- Do **not** block mobile production launch on these items.  
- Prioritise after launch based on adoption metrics and ops pain.  
- Payment work should build on existing Free/Paid student controls rather than replacing them blindly.  

### High-Level DoD for Future Items (when scheduled)

- Product brief + entitlement rules  
- Backend + mobile (and web if needed) implementation  
- Security review for payments **[Recommended Practice]**  
- QA including failure/refund/edge cases for payments  
- Gradual rollout plan  

---

# 13. Production Hardening — Dedicated Reference

> Consolidates Phase 2 with an explicit inclusion policy: **report-required** vs **recommended practice**.

## Report-Required / Explicitly Implied

| Item | Source signal in report |
| ---- | ----------------------- |
| Security & production hardening package | High Priority launch path; Active next focus; In Progress |
| Authentication / session robustness | Auth delivered but hardening required for public launch |
| Authorization / RBAC enforcement review | Role-based platform; hardening gate |
| Quality assurance baseline | Planned challenge; P0 Quality Baseline |
| Performance optimisation | Performance Developing; optimisation planned |
| Operational monitoring | Planned for scaled usage |
| Deployment / release checklist completion | Deployment Developing; final checklist remains |
| Network reliability for calls | Audio call reliability mid-term |
| Notification delivery → open behaviour | Notification polish |

## Recommended Production Practices (Not Explicit Feature Lines in Report)

Label these clearly in planning so they are not mistaken for missed report items:

- Rate limiting on auth and public guest endpoints  
- Centralised error tracking (Sentry or equivalent)  
- Mobile crash reporting in release builds  
- Formal DB backup/restore drills  
- Bundle size / memory profiling budgets  
- WAF / DDoS basics at infrastructure layer  
- Dependency vulnerability scanning in CI  
- Privacy policy / data retention review for store  
- Feature flags for risky polish rollouts  
- Penetration test before broad public launch  

Only adopt recommended practices that fit the **existing** architecture (mobile + backend + realtime + push + uploads + secondary admin).

---

# 14. Quality Assurance — Dedicated Roadmap

## 14.1 Test Layers

| Layer | Scope | Timing |
| ----- | ----- | ------ |
| Smoke | Auth, dashboard, chat send, quiz submit, push receive | Every RC |
| Critical path | Retest lifecycle, guest results, mentor view/attempt, assignments verify | Every Phase 1 merge |
| Role matrix | Admin/Mentor/Student/Free | Before hardening gate |
| API contract | AuthZ denials, validation errors, guest tokens | Parallel to Phase 2 |
| Performance | Dashboard, attempt, export | Phase 4 |
| Device | iOS/Android native call + push | Phase 1.4 & 8 |
| Network | Weak network call + autosave | Phase 1.4 & 3 |
| Notification | Open routing all event types | Phase 1.5 |
| Audio call | Initiate/incoming/wake/fail | Phase 1.4 |
| Offline | Graceful degradation only until Phase 9 | Phase 3 docs |
| Failure | 5xx, token expiry, upload fail | Phase 2–3 |
| Acceptance | Product Go/No-Go | Phase 8 |

## 14.2 Role Testing Matrix (Minimum)

| Capability | Admin | Mentor | Student | Free User |
| ---------- | ----- | ------ | ------- | --------- |
| User management | Yes | No | No | No |
| Quiz create/share | Per product rules | Per product rules | Attempt focus | Limited / free content only |
| Retest approve | Per rules | Per rules | Request only | Per rules |
| Assignments verify | Overview | Yes | Complete only | No / limited |
| Analytics export | Yes | Per rules | No / limited | No |
| Groups/chat | Manage | Participate | Participate | Per entitlement |
| Audio calls | Per membership | Per membership | Per membership | Per entitlement |
| Settings/profile | Yes | Yes | Yes | Yes (limited) |

## 14.3 Exit Criteria

- Zero open Critical defects on launch-path features  
- High defects have owners and launch waivers if deferred  
- Automated critical pack green on RC  
- QA Go recommendation recorded  

---

# 15. Launch Checklist — Dedicated Summary

Use this as the executive launch tracker (detail in Phase 8):

1. Backend readiness  
2. Mobile readiness  
3. Database readiness  
4. Environment variables  
5. API verification  
6. Push notifications  
7. Authentication  
8. Analytics  
9. Monitoring  
10. Crash reporting **[Recommended Practice]**  
11. Performance  
12. Security  
13. Store readiness  
14. Release validation  
15. Final smoke tests  
16. Rollback planning  

**Launch Readiness status target:** move from *Production Hardening In Progress* to *Production Launch Approved*.

---

# 16. Future Roadmap — Separation of Concerns

## Launch Blockers (Must Complete)

- Retest lifecycle polish (consistent retake rules)  
- Guest quiz result presentation  
- Mentor quiz view-vs-attempt clarity  
- Production hardening gate (security & reliability baseline)  
- Quality baseline + initial automated critical-flow checks  

## Launch Requirements (Should Complete for Confident Release)

- Mobile launch / store checklist completion  
- Notification open-from-notification routing  
- Audio call reliability improvements (to agreed acceptance threshold)  
- Deployment/env validation  
- Performance acceptable for current scale  
- Selected secondary admin user/group actions (if ops-blocking)  
- Settings dedicated experience *(mid-term; may be accepted as immediate post-launch if explicitly waived)*  
- Dashboard KPI enrichment *(mid-term; may be waived with documented KPI subset)*  
- Free-user real content *(P2; waive only with explicit product acceptance)*  

## Post-Launch Enhancements

- Broader secondary-console chat parity (if not done pre-launch)  
- Further dashboard KPI depth  
- Additional automated test expansion beyond initial pack  
- Further call reliability under extreme networks  

## Future Vision

- Full offline support  
- Payment / premium upgrade flows  
- Broader browser-based student experiences  
- Advanced content taxonomy tools  
- Message search  
- Advanced reporting automation  
- Broader secondary-surface expansion  

---

# 17. Engineering Priority Register

| ID | Feature / Workstream | Priority | Estimate | Dependencies | Risk | Impact |
| -- | -------------------- | -------- | -------- | ------------ | ---- | ------ |
| F1 | Retest lifecycle polish | Critical | Medium | Existing retest APIs/UI | Medium | High |
| F2 | Guest quiz results presentation | Critical | Medium | Guest attempt/submit | Medium | High |
| F3 | Mentor quiz view vs attempt | Critical | Small–Medium | Mentor quiz view | Low–Med | High |
| H1 | Production hardening package | Critical | Large | Auth/API foundation | High if skipped | Critical |
| Q1 | QA baseline + initial automation | Critical | Large | Stable critical APIs | Medium | High |
| L1 | Mobile launch / store checklist | High | Medium | H1, Q1, F1–F3 | Medium | Critical |
| N1 | Notification deep-link routing | High | Medium | Core push | Medium | High |
| C1 | Audio call reliability | High | Large | Native calling | High | High |
| D1 | Dashboard KPI enrichment | Medium | Medium | Role dashboards | Low–Med | Medium–High |
| S1 | Dedicated Settings + profile completeness | Medium | Medium–Large | Profile completion | Low–Med | Medium |
| U1 | Free-user real content | Medium | Medium–Large | Free/Paid controls | Medium | High |
| A1 | Secondary admin selected user/group actions | High* | Medium | Console foundations | Medium | Medium |
| A2 | Secondary admin chat parity | Medium | Large | Basic console chat | Medium | Medium |
| P1 | Performance optimisation | High | Medium | Monitoring baseline | Medium | High |
| M1 | Operational monitoring | High | Medium | Logging | Medium | High |
| X1 | Full offline support | Low (Future) | Large | Sync architecture | High | Medium |
| X2 | Payment / premium upgrade | Low (Future) | Large | Free/Paid model | High | High |
| X3 | Broader browser student experiences | Low (Future) | Large | Secondary surfaces | Medium | Medium |
| X4 | Advanced content taxonomy tools | Low (Future) | Medium–Large | Question bank | Low | Medium |
| X5 | Message search | Low (Future) | Medium | Chat store | Medium | Medium |
| X6 | Advanced reporting automation | Low (Future) | Large | Analytics | Medium | Medium |

\*High when operations-blocking; otherwise Medium.

---

# 18. Suggested Execution Sequence (6–10 Week Baseline)

Aligned to report effort bands (~3–5 weeks high priority, ~2–3 weeks medium, overall 6–10 weeks to mobile launch baseline):

```
Weeks 1–2   Phase 1 critical polish (F1, F2, F3) + hardening kickoff (H1)
Weeks 2–4   H1 continue + Q1 critical automated/manual pack + A1 selected admin gaps
Weeks 3–5   N1 notification routing + C1 call reliability pass + P1/M1 monitoring
Weeks 4–6   D1 dashboard KPIs + S1 settings + U1 free-user content (parallelise by owner)
Weeks 5–7   Phase 8 launch checklist, store RC, smoke, Go/No-Go
Weeks 7–10  Buffer for defect burn-down, waivers, or slip on Large items (C1/U1/S1)
Post-launch Phase 9 expansion + A2 chat parity remainder
```

Parallelisation guidance: mobile polish (F*) and backend hardening (H1) can proceed in parallel with dedicated owners; QA (Q1) tracks both continuously.

---

# 19. Final Master Checklist — Execution Tracker

> Every remaining engineering task extracted from the Implementation Status Report, plus clearly marked recommended practices. Use this as the living execution tracker.

## A. Critical Feature Closure (P0)

- [ ] **A1.** Define and document consistent retest/retake rules  
- [ ] **A2.** Enforce retest eligibility server-side  
- [ ] **A3.** Align mobile UI states for pending / approved / rejected / retake-available  
- [ ] **A4.** Prevent duplicate entitlements / race conditions on approve  
- [ ] **A5.** Verify analytics attribution for original vs retake attempts  
- [ ] **A6.** Implement guest/public post-submit result presentation UI  
- [ ] **A7.** Ensure guest result payload is returned securely (no PII leak)  
- [ ] **A8.** Handle guest expired/invalid link and refresh-after-submit edges  
- [ ] **A9.** Clarify mentor quiz Preview/View vs Attempt entry points  
- [ ] **A10.** Prevent unintended mentor attempt records  
- [ ] **A11.** QA sign-off on retest + guest results + mentor clarity  

## B. Engagement & Reliability Polish (P1 / Mid-term)

- [ ] **B1.** Implement open-from-notification navigation (cold + warm start)  
- [ ] **B2.** Standardise push payload routing metadata for key event types  
- [ ] **B3.** Safe fallback for stale/unauthorised notification targets  
- [ ] **B4.** Improve audio call join success across broader network conditions  
- [ ] **B5.** Call connecting timeout / retry / failure UX  
- [ ] **B6.** Regression-test push wake for incoming calls  
- [ ] **B7.** Resolve stale active-call indicator edge cases  
- [ ] **B8.** Enrich Admin dashboard operational KPIs  
- [ ] **B9.** Enrich Mentor dashboard operational KPIs  
- [ ] **B10.** Enrich Student dashboard operational KPIs  
- [ ] **B11.** Ensure dashboard KPI performance acceptable on mobile  

## C. Settings & Profile (P2 / Mid-term)

- [ ] **C1.** Ship dedicated Settings screen/module on mobile  
- [ ] **C2.** Wire account/profile edit flows into Settings IA  
- [ ] **C3.** Ensure logout/session controls consistent from Settings  
- [ ] **C4.** Role-appropriate Settings visibility (Admin/Mentor/Student/Free)  
- [ ] **C5.** Validate incomplete-profile + session-expiry edge cases  

## D. Free-User Experience (P2 / Mid-term)

- [ ] **D1.** Replace free-user shell placeholders with real content/data  
- [ ] **D2.** Enforce free vs paid entitlements server-side  
- [ ] **D3.** Reflect admin Free/Paid toggles in free-user access immediately  
- [ ] **D4.** Empty/error states for free-user content  
- [ ] **D5.** Product acceptance of free-tier scope (without requiring payments yet)  

## E. Secondary Admin Console (Support Ops)

- [ ] **E1.** Identify operations-blocking user/group management gaps  
- [ ] **E2.** Implement selected user management actions on web console  
- [ ] **E3.** Implement selected group management actions on web console  
- [ ] **E4.** Verify same backend AuthZ as mobile admin  
- [ ] **E5.** Broader console chat parity (attachments/richer behaviours as agreed)  
- [ ] **E6.** Confirm console remains secondary; mobile still primary  

## F. Production Hardening (P0)

- [ ] **F1.** Security review of authentication flows (login, OTP, forgot password, session restore)  
- [ ] **F2.** Authorization review across Admin/Mentor/Student/Free APIs  
- [ ] **F3.** API protection verification (token required, role middleware)  
- [ ] **F4.** Input validation pass (users, imports, uploads, assignments, quiz)  
- [ ] **F5.** Secure device storage review for tokens/secrets  
- [ ] **F6.** Secrets management validation (no secrets in repo; env separation)  
- [ ] **F7.** Production logging for critical domains  
- [ ] **F8.** Operational monitoring & alerting baseline  
- [ ] **F9.** Network resilience messaging on critical flows  
- [ ] **F10.** Environment variable inventory & staging/production validation  
- [ ] **F11.** Deployment dry-run / release path verification  
- [ ] **F12.** Rate limiting on abuse-prone endpoints **[Recommended Practice]**  
- [ ] **F13.** Crash reporting on mobile RC builds **[Recommended Practice]**  
- [ ] **F14.** Backend error tracking **[Recommended Practice]**  
- [ ] **F15.** Database backup/restore validation **[Recommended Practice]**  

## G. Quality Assurance (P0)

- [ ] **G1.** Publish critical-path manual test pack  
- [ ] **G2.** Execute role-matrix testing  
- [ ] **G3.** Execute API negative/AuthZ tests  
- [ ] **G4.** Execute notification open-routing tests  
- [ ] **G5.** Execute audio call device/network tests  
- [ ] **G6.** Execute guest quiz E2E tests  
- [ ] **G7.** Execute retest lifecycle E2E tests  
- [ ] **G8.** Execute regression smoke after each polish merge  
- [ ] **G9.** Establish initial automated checks for critical flows  
- [ ] **G10.** Wire automated checks into CI or pre-release process  
- [ ] **G11.** Performance test dashboard/attempt/export scenarios  
- [ ] **G12.** Failure-scenario tests (5xx, token expiry, upload fail)  
- [ ] **G13.** Document offline graceful-degradation behaviour (pre-full-offline)  
- [ ] **G14.** QA Go/No-Go recommendation for launch  

## H. Performance (P1)

- [ ] **H1.** Profile mobile critical journeys  
- [ ] **H2.** Optimise slow dashboard/analytics API paths as needed  
- [ ] **H3.** Validate list pagination behaviour under load  
- [ ] **H4.** Media load behaviour acceptable in chat/questions  
- [ ] **H5.** Bundle/memory pass on RC **[Recommended Practice]**  

## I. Launch Readiness (P1)

- [ ] **I1.** Backend production readiness sign-off  
- [ ] **I2.** Mobile RC readiness sign-off  
- [ ] **I3.** Database readiness sign-off  
- [ ] **I4.** Environment variables verified  
- [ ] **I5.** API smoke on production-like environment  
- [ ] **I6.** Production push credentials verified  
- [ ] **I7.** Authentication RC verification  
- [ ] **I8.** Analytics export verification  
- [ ] **I9.** Monitoring live  
- [ ] **I10.** Security hardening gate signed  
- [ ] **I11.** Performance accepted for current scale  
- [ ] **I12.** Store listing / permissions / privacy readiness  
- [ ] **I13.** Final end-to-end smoke tests  
- [ ] **I14.** Rollback plan documented and owned  
- [ ] **I15.** Eng + QA + Product release sign-off  

## J. Future Expansion (P3 — Do Not Block Launch)

- [ ] **J1.** Full offline mode design + implementation  
- [ ] **J2.** Payment / premium upgrade integration  
- [ ] **J3.** Broader browser-based student experiences  
- [ ] **J4.** Advanced content taxonomy tools  
- [ ] **J5.** Message search  
- [ ] **J6.** Advanced reporting automation  
- [ ] **J7.** Broader secondary-surface expansion beyond ops gaps  

## K. Explicit Non-Goals for Launch Baseline

- [ ] **K1.** Confirmed: Web Admin Console is secondary; full parity with mobile is not a launch blocker  
- [ ] **K2.** Confirmed: Feature completion ~72% is distinct from launch readiness hardening track  
- [ ] **K3.** Confirmed: Future items (offline, payments, etc.) excluded from 6–10 week launch baseline unless product re-scopes  

---

# 20. Traceability — Report → Roadmap

| Report Section Signal | Roadmap Location |
| --------------------- | ---------------- |
| §8 Under Development table | Phase 1 features 1.1–1.6; Phase 5–7 |
| §9 Pending High/Medium/Future | Phases 2–3, 5–8, 9 |
| §10 Challenges | Phases 2–4, 6–7, 9 |
| §11 Launch Readiness Assessment | Phases 2, 3, 4, 8 |
| §12 Next Milestones P0–P3 | Priority register + phase ordering |
| §13 Estimated Remaining Work | Executive Summary + §18 sequence |
| Module % (Notifications, Dashboard, Calls, Guest, Profile, Free, Admin, Offline, Testing) | Feature current-state sections |

---

# 21. Document Control

| | |
|---|---|
| Roadmap version | 1.0 |
| Basis | Implementation Status & Completion Report v3.0 (30 July 2026) only for project-required scope |
| Code changes in this task | None — planning document only |
| Primary KPI reminder | Overall Feature Completion ~72%; Launch Readiness is a separate track |
| Platform reminder | Mobile is primary; Web Admin Console is secondary |
| Next action for engineering | Begin Phase 1 Critical Feature Completion using Master Checklist Section A |

---

*End of Final Implementation Roadmap*
