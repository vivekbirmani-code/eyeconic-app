#!/usr/bin/env node
/**
 * Phase 9 single-tester production operations (plan §F): root-cause
 * diagnostics, kill-switch toggling, and arming ONE selected quiz —
 * everything the owner authorized for today's end-to-end test.
 *
 * SAFETY:
 *  - Credentials live OUTSIDE the repo in a JSON file (default
 *    %USERPROFILE%\.eyeconic-prod-creds.json) and are NEVER printed, logged,
 *    or written anywhere. Only non-sensitive results are printed.
 *  - Read-only by default: every mutating command must be named explicitly.
 *
 * Creds file shape:
 *   { "admin": { "email": "...", "password": "..." },
 *     "student": { "email": "...", "password": "..." } }
 *
 * Usage:
 *   node scripts/prod-proctoring-ops.js diagnose
 *   node scripts/prod-proctoring-ops.js quiz <quizId>
 *   node scripts/prod-proctoring-ops.js list-quizzes
 *   node scripts/prod-proctoring-ops.js kill-switch on|off
 *   node scripts/prod-proctoring-ops.js arm <quizId>       # full silent-record payload
 *   node scripts/prod-proctoring-ops.js disarm <quizId>
 *   node scripts/prod-proctoring-ops.js student-view <quizId>  # needs student creds
 */

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.EYECONIC_API_BASE || 'https://eyeconic-app-prod-1r8o.onrender.com/api';
const CREDS_FILE = process.env.EYECONIC_CREDS_FILE ||
  path.join(process.env.USERPROFILE || '.', '.eyeconic-prod-creds.json');

// Mirror of utils/proctoringToggle.ts PROCTORING_ON_PAYLOAD — keep in sync.
const ON_PAYLOAD = {
  enabled: true,
  camera: 'optional',
  focusEvents: { mode: 'record' },
  multipleFaces: { mode: 'record' },
  facePresence: { mode: 'record' },
};

// Owner's warning-path config (plan §F.7 + the 2026-10-21 global rollout
// order): focusEvents warn-only (the app-away ladder WARNS — banner appears
// ~1–2 s after returning — but NEVER auto-submits) + attention 'warn'
// (Phase 9.1 3-look-away rule: the 3rd qualifying look-away turns into ONE
// advisory banner per 5-min window; never violation / risk / submit).
// multipleFaces/facePresence stay silent record; camera stays optional.
// Policy change ⇒ new policy hash ⇒ the student re-consents on the next
// start (by design, §21.4).
//
// Phase 9.1 backend (e610c67+) is DEPLOYED and verified — attention.mode
// 'warn' round-trips in prod (arm-warn 200 on Test*, 2026-10-21).
// Keep in sync with utils/proctoringToggle.ts PROCTORING_ON_PAYLOAD.
const WARN_PAYLOAD = {
  enabled: true,
  camera: 'optional',
  focusEvents: { mode: 'warn-only' },
  multipleFaces: { mode: 'record' },
  facePresence: { mode: 'record' },
  attention: { mode: 'warn' },
};

// PRE-DEPLOY variant: identical to WARN_PAYLOAD minus the attention 'warn'
// opt-in, which the pre-Phase-9.1 backend rejects with 400 (attention.mode
// locked to 'record' there). Use until the Phase 9.1 commits are deployed;
// re-run plain `arm-warn` afterwards to add the head-turn banner.
const WARN_PAYLOAD_FOCUS_ONLY = {
  enabled: true,
  camera: 'optional',
  focusEvents: { mode: 'warn-only' },
  multipleFaces: { mode: 'record' },
  facePresence: { mode: 'record' },
};

function loadCreds() {
  if (!fs.existsSync(CREDS_FILE)) {
    console.error(`[creds] File not found: ${CREDS_FILE}\n[creds] Create it as {"admin":{"email":"...","password":"..."},"student":{...}}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
}

async function api(method, url, { token, body } = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON */ }
  return { status: response.status, data };
}

async function login(role) {
  const creds = loadCreds()[role];
  if (!creds) throw new Error(`No "${role}" entry in ${CREDS_FILE}`);
  const result = await api('POST', '/auth/login', { body: { email: creds.email, password: creds.password } });
  if (result.status !== 200 || !result.data?.token) {
    throw new Error(`Login failed for role "${role}" (HTTP ${result.status}) — credentials not printed.`);
  }
  return { token: result.data.token, role: result.data.user?.role, email: creds.email };
}

const fmtQuiz = (q) => ({
  id: q._id,
  title: q.title,
  testType: q.testType,
  proctoring: {
    enabled: q.proctoring?.enabled === true,
    camera: q.proctoring?.camera,
    focusEvents: q.proctoring?.focusEvents?.mode,
    multipleFaces: q.proctoring?.multipleFaces?.mode,
    facePresence: q.proctoring?.facePresence?.mode,
    attention: q.proctoring?.attention?.mode ?? '(schema default: record)',
  },
  eligibility: q.proctoringEligibility ?? '(not in this response)',
  assignedCount: Array.isArray(q.assignedStudents) ? q.assignedStudents.length : undefined,
  // Cohort-exposure check: a quiz with this flag reaches EVERY free user the
  // moment proctoring is armed (old app builds then hard-fail /start 403).
  assignToAllFreeUsers: q.assignToAllFreeUsers === true,
});

async function cmdDiagnose() {
  console.log(`[diagnose] API base: ${API_BASE}`);

  // 1. Deploy markers — no auth needed.
  const health = await api('GET', '/health');
  console.log(`[deploy] /health -> HTTP ${health.status} ${health.status === 200 ? '(healthy)' : ''}`);

  const settingsUnauth = await api('GET', '/settings');
  console.log(`[deploy] GET /settings unauthenticated -> HTTP ${settingsUnauth.status}` +
    (settingsUnauth.status === 503 ? ' = kill-switch allowlist fix NOT yet deployed (still frozen)'
      : settingsUnauth.status === 401 ? ' = allowlist fix IS deployed (auth reachable)'
      : ' = unexpected'));

  // 2. Admin truth: kill switch + feature-flag inference.
  const { token } = await login('admin');
  console.log(`[auth] admin login OK`);

  const settings = await api('GET', '/settings', { token });
  console.log(`[gates] kill switch (AppSettings.proctoringEnabled): ${settings.data?.proctoringEnabled}`);
  console.log(`[gates] strict-CV gate: ${settings.data?.proctoringStrictCv} (stays false in V1)`);

  const quizzes = await api('GET', '/quizzes', { token });
  if (Array.isArray(quizzes.data)) {
    const withState = quizzes.data.filter((q) => q.proctoring?.enabled === true);
    console.log(`[quizzes] total visible: ${quizzes.data.length}; opted-in for proctoring: ${withState.length}`);
    for (const q of withState.slice(0, 5)) {
      const detail = await api('GET', `/quizzes/${q._id}`, { token });
      console.log(`[quizzes] opted-in: ${q.title} (${q._id}) eligibility: ${JSON.stringify(detail.data?.proctoringEligibility ?? 'n/a')}`);
    }
    // Feature-flag inference: an opted-in quiz + kill switch ON + eligibility
    // still false => feature_flag_off (deployed code predates the flip).
    if (withState.length > 0 && settings.data?.proctoringEnabled === true) {
      const detail = await api('GET', `/quizzes/${withState[0]._id}`, { token });
      const elig = detail.data?.proctoringEligibility;
      if (elig && elig.enabled === false && elig.blockers?.includes('feature_flag_off')) {
        console.log('[gates] inferred: backend aiProctoring flag is OFF (blocker feature_flag_off)');
      } else if (elig && !elig.blockers?.includes('feature_flag_off')) {
        console.log('[gates] inferred: backend aiProctoring flag is ON (no feature_flag_off blocker)');
      } else {
        console.log('[gates] eligibility field absent in quiz detail — deployed backend predates the toggle support deploy');
      }
    }
  } else {
    console.log(`[quizzes] list response shape unexpected (HTTP ${quizzes.status}) — keys: ${Object.keys(quizzes.data || {}).join(', ')}`);
  }
  console.log('[diagnose] done. (Root-cause model: proctoring appears only when killSwitch && flag && quizOptIn are ALL true.)');
}

async function cmdQuiz(quizId) {
  const { token } = await login('admin');
  const detail = await api('GET', `/quizzes/${quizId}`, { token });
  if (detail.status !== 200) return console.log(`HTTP ${detail.status}: ${detail.data?.message}`);
  console.log(JSON.stringify(fmtQuiz(detail.data), null, 2));
}

async function cmdListQuizzes() {
  const { token } = await login('admin');
  const quizzes = await api('GET', '/quizzes', { token });
  const list = Array.isArray(quizzes.data) ? quizzes.data : quizzes.data?.quizzes || [];
  for (const q of list) {
    console.log(`${q._id}  ${q.proctoring?.enabled === true ? '[PROCTORED-ON]' : '[off]'}  ${q.title}`);
  }
  console.log(`(total ${list.length})`);
}

async function cmdKillSwitch(state) {
  const { token } = await login('admin');
  const result = await api('PUT', '/settings/proctoring-enabled', { token, body: { proctoringEnabled: state === 'on' } });
  console.log(`kill-switch -> ${state}: HTTP ${result.status} ${JSON.stringify(result.data)}`);
}

async function cmdArm(quizId, payload) {
  const { token } = await login('admin');
  const result = await api('PUT', `/quizzes/${quizId}`, { token, body: { proctoring: payload } });
  console.log(`${payload.enabled ? 'arm' : 'disarm'} ${quizId}: HTTP ${result.status} ${result.data?.message ?? ''}`);
  if (result.status === 200) {
    const detail = await api('GET', `/quizzes/${quizId}`, { token });
    console.log('stored + eligibility now:');
    console.log(JSON.stringify(fmtQuiz(detail.data), null, 2));
  }
}

// 2026-10-21 global rollout order: arm WARN_PAYLOAD on EVERY quiz that has
// already opted into proctoring (enabled === true). Quizzes with proctoring
// off stay off — enabling those is a separate, explicit decision (old app
// builds hard-fail /start 403 on newly gated quizzes). Idempotent: re-running
// on an already-armed quiz writes the same config.
async function cmdArmWarnAll() {
  const { token } = await login('admin');
  const quizzes = await api('GET', '/quizzes', { token });
  const list = Array.isArray(quizzes.data) ? quizzes.data : quizzes.data?.quizzes || [];
  const proctored = list.filter((q) => q.proctoring?.enabled === true);
  console.log(`[arm-warn-all] ${proctored.length} of ${list.length} quizzes have proctoring ON; arming warn modes on each.`);
  let failures = 0;
  for (const q of proctored) {
    const result = await api('PUT', `/quizzes/${q._id}`, { token, body: { proctoring: WARN_PAYLOAD } });
    const stored = result.status === 200
      ? (await api('GET', `/quizzes/${q._id}`, { token })).data?.proctoring
      : null;
    const ok = stored?.focusEvents?.mode === 'warn-only' && stored?.attention?.mode === 'warn';
    console.log(`  ${ok ? 'OK ' : 'FAIL'} ${q.title} (${q._id}): HTTP ${result.status}`
      + (stored ? ` focus=${stored.focusEvents?.mode} attention=${stored.attention?.mode ?? '(default: warn)'}` : ` — ${result.data?.message ?? ''}`));
    if (!ok) failures += 1;
  }
  console.log(`[arm-warn-all] done: ${proctored.length - failures}/${proctored.length} armed, ${failures} failure(s).`);
  if (failures > 0) process.exitCode = 1;
}

async function cmdStudentView(quizId) {
  const { token } = await login('student');
  const detail = await api('GET', `/quizzes/${quizId}`, { token });
  console.log(`[student] HTTP ${detail.status} proctoringRequired=${detail.data?.proctoringRequired} title=${detail.data?.title}`);
}

async function cmdInspect(quizId) {
  const student = await login('student');
  const detail = await api('GET', `/quizzes/${quizId}`, { token: student.token });
  if (detail.status !== 200) return console.log(`[student] quiz detail HTTP ${detail.status}`);
  const attempt = detail.data?.attemptStatus;
  console.log(`[attempt] id=${attempt?.attemptId} status=${attempt?.status} hasAttempted=${attempt?.hasAttempted}`);
  if (!attempt?.attemptId) return;

  const session = await api('GET', `/quizzes/attempt/${attempt.attemptId}/proctoring/session`, { token: student.token });
  console.log(`[session] HTTP ${session.status} status=${session.data?.session?.status} started=${session.data?.session?.startedAt ?? session.data?.session?.createdAt}`);
  const s = session.data?.session;
  if (s) {
    console.log(`[session] heartbeats=${JSON.stringify(s.heartbeats ?? s.stats ?? 'n/a')} integrity=${JSON.stringify(s.integrity ?? 'n/a')}`);
  }

  const timeline = await api('GET', `/quizzes/attempt/${attempt.attemptId}/proctoring/timeline`, { token: student.token });
  console.log(`[timeline] HTTP ${timeline.status}`);
  const events = timeline.data?.events ?? timeline.data?.timeline ?? [];
  if (!Array.isArray(events) || events.length === 0) {
    console.log('[timeline] no events array — top-level keys: ' + Object.keys(timeline.data || {}).join(', '));
    console.log(JSON.stringify(timeline.data, null, 2).slice(0, 1500));
    return;
  }
  const byType = {};
  for (const e of events) {
    const t = e.type ?? e.eventType ?? 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log(`[timeline] total=${events.length} byType=${JSON.stringify(byType)}`);
  const t0 = events[0]?.occurredAt ?? events[0]?.timestamp ?? events[0]?.clientTs;
  for (const e of events) {
    const ts = e.occurredAt ?? e.timestamp ?? e.clientTs;
    const rel = ts && t0 ? `+${Math.round((new Date(ts) - new Date(t0)) / 1000)}s` : ts;
    console.log(`  ${rel}  ${e.type ?? e.eventType}  ${e.metadata ? JSON.stringify(e.metadata).slice(0, 120) : ''}`);
  }
}

async function cmdDigest(days = 1) {
  const { token } = await login('admin');
  const result = await api('GET', `/quizzes/proctoring-metrics/digest?days=${days}`, { token });
  console.log(`[digest days=${days}] HTTP ${result.status}`);
  console.log(JSON.stringify(result.data, null, 2));
}

async function main() {
  const [command, arg, arg2] = process.argv.slice(2);
  switch (command) {
    case 'diagnose': return cmdDiagnose();
    case 'quiz': return cmdQuiz(arg);
    case 'list-quizzes': return cmdListQuizzes();
    case 'kill-switch': return cmdKillSwitch(arg);
    case 'arm': return cmdArm(arg, ON_PAYLOAD);
    case 'arm-warn': return cmdArm(arg, WARN_PAYLOAD);
    case 'arm-warn-focus': return cmdArm(arg, WARN_PAYLOAD_FOCUS_ONLY);
    case 'arm-warn-all': return cmdArmWarnAll();
    case 'disarm': return cmdArm(arg, { enabled: false });
    case 'student-view': return cmdStudentView(arg);
    case 'inspect': return cmdInspect(arg);
    case 'digest': return cmdDigest(arg || 1);
    default:
      console.log('commands: diagnose | list-quizzes | quiz <id> | kill-switch on|off | arm <id> | arm-warn <id> | arm-warn-focus <id> | arm-warn-all | disarm <id> | student-view <id> | inspect <id> | digest [days]');
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exitCode = 1;
});
