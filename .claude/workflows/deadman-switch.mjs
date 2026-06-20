export const meta = {
  name: 'deadman-switch',
  description: 'Implement the full dead-man switch roadmap (features 008-012) spec->implement->verify->fix->commit',
  whenToUse: 'Build out the Ensure dead-man switch end to end per specs/deadman-switch-roadmap.md',
  phases: [
    { title: 'Spec' },
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Fix' },
    { title: 'Commit' },
    { title: 'Final' },
  ],
}

// ---------------------------------------------------------------------------
// Shared context handed to every agent. Agents start fresh, so we point them
// at the ground-truth docs + key conventions instead of assuming knowledge.
// ---------------------------------------------------------------------------
const REPO = '/home/jorgesimoes/ensure'
const ROADMAP = `${REPO}/specs/deadman-switch-roadmap.md`

const CONVENTIONS = `
You are working in the Ensure monorepo at ${REPO} (npm workspaces: shared/, server/, client/).
Read ${ROADMAP} first — it is the umbrella plan (product model, shared data model, all 5 features,
security decisions). Also obey ${REPO}/CLAUDE.md (esp. the README-maintenance rule) and the
constitution at ${REPO}/.specify/memory/constitution.md (TDD, KISS/YAGNI, typed end-to-end, accessible
by default, small commits).

Codebase conventions you MUST follow (study the existing code before writing):
- Backend: Express 5 (ESM, run via tsx), Zod validation, repository-over-better-sqlite3 data layer.
  * Schema is created in server/src/db/index.ts; repos live in server/src/db/*-repo.ts (raw prepared
    statements, no ORM). New dead-man modules go under server/src/deadman/.
  * Routes are routers in server/src/routes/*.ts, mounted in server/src/app.ts; protected routes use
    the requireAuth middleware (req.user.id scopes every query).
  * Email is sent via the generic dispatcher: buildRegistry(emailProvider) + notify(registry, {channel,
    recipient, content:{subject, body, bodyFormat}}). Do NOT call providers directly.
  * Tokens: mirror the session pattern in server/src/auth + db/session-repo.ts — high-entropy random
    value shown once in a URL, stored only as a SHA-256 hash, time-limited, single-use, constant-time
    compare. Never log tokens or note plaintext.
  * Notes are encrypted at rest; decrypt only via the keyring (crypto/keyring.ts + note-cipher.ts) and
    note-repo getNote. Fail closed on decrypt errors (never emit plaintext on failure).
  * Env is validated at boot in server/src/config/env.ts (Zod, fail-closed). New optional env vars:
    DEADMAN_TICK_MS, DEADMAN_TICK_DISABLED, APP_BASE_URL, DEADMAN_TEST_MODE — read where EMAIL_PROVIDER
    is read. The in-process timer MUST be disabled when DEADMAN_TICK_DISABLED=1, and vitest/integration
    tests MUST set it so the timer never runs during tests.
- Contract is source of truth: edit contracts/openapi.yaml then run \`npm run gen:api\` to regenerate
  shared/src/api.ts. Shared bounds/constants go in shared/src/constants.ts. Never hand-edit shared/src/api.ts.
- Frontend: accessible, library-free React 18 SPA. Per-endpoint API clients in client/src/api/*Client.ts
  wrap apiFetch (silent-refresh on 401). Pages in client/src/pages, components in client/src/components.
  Routes in client/src/App.tsx; gate authed pages with ProtectedRoute. Styling is plain CSS in
  client/src/styles.css (CSS variables, WCAG AA). Every input has a <label htmlFor>; errors use
  role="alert"; status uses role="status" aria-live="polite". Match the NoteEditor/ContactList patterns.
- Test seams (mounted only behind an env gate) follow the existing AUTH_TEST_MODE / NOTE_ALLOW_TEST_RESET
  pattern in server/src/app.ts + test-support/.
- Tests: server uses vitest + supertest (server/tests/), client uses vitest + RTL, e2e uses Playwright
  (e2e/). Tests must not require real Google/network credentials.

Work ONLY on the current git branch (feat/deadman-switch). Do not switch branches. Do not open PRs.
`

// Per-feature briefs (full detail is in the roadmap; these are the actionable scope per slice).
const FEATURES = [
  {
    num: '008', slug: 'deadman-engine-checkin', title: 'Liveness engine, check-in & status dashboard',
    brief: `MVP + foundational core. Build the per-user switch state machine (disarmed->active->grace->triggered).
DATA: tables deadman_config and deadman_event (see roadmap section 3) created in server/src/db/index.ts.
ENGINE (server/src/deadman/): engine.ts with a PURE evaluate(config, now) + runDeadmanTick(db, deps, now)
  (deps = injected notifier + clock; idempotent). config-repo.ts (getConfig/upsertConfig/recordCheckin/
  setState/listDue). event-repo.ts (append-only recordEvent/listEvents). driver.ts startDeadmanTimer using
  setInterval(DEADMAN_TICK_MS default 60000), guarded by DEADMAN_TICK_DISABLED; wired into server.ts boot
  and also recovered on boot. CLI server/src/cli/deadman-tick.ts -> add "deadman:tick" script to server/package.json.
  In 008, on grace-expiry transition to 'triggered' and record the event (actual contact delivery is 010).
  During 'grace', send reminder notifications to the USER's own email via notify().
API (contracts/openapi.yaml + gen:api): GET /api/deadman (status incl. secondsUntilDue), PUT /api/deadman/config
  (checkinIntervalSeconds, gracePeriodSeconds, enabled => arm/disarm), POST /api/deadman/checkin. routes/deadman.ts
  mounted under requireAuth in app.ts. Add interval/grace min-max bounds to shared/src/constants.ts.
TEST SEAM: POST /api/test/deadman (gated by DEADMAN_TEST_MODE=1) to fast-forward next_checkin_due_at/grace_deadline_at
  into the past for e2e.
CLIENT: client/src/api/deadmanClient.ts; a dashboard page (state badge, live countdown, big "I'm alive" check-in
  button, config form for interval+grace, arm/disarm with a confirm before first arm, recent-events list); add a
  nav link from the note page header. Follow NoteEditor/ContactList state-machine + a11y patterns.
TESTS: engine unit tests (every transition; tick with injected clock + spy notifier; idempotency); supertest route
  tests; client component tests; an e2e spec (arm -> check-in -> status; and miss-deadline via the test seam -> grace).`,
  },
  {
    num: '009', slug: 'contact-verification', title: 'Contact verification',
    brief: `A contact must prove control of its address before it can ever receive a release.
DATA: ALTER contact ADD verified_at, verification_token_hash, verification_expires_at (handle existing rows:
  treat null verified_at as unverified). Update contact-repo.ts + contact serialization (and openapi Contact schema
  gains a verified boolean / verifiedAt).
API: POST /api/contact/{id}/verify (mint+hash a token, email the contact a verification link via notify() using
  APP_BASE_URL; refresh/resend allowed). Public GET /api/contact/verify?token=... (no auth) -> validate hash, check
  expiry/single-use, set verified_at, render/return result. Update contracts/openapi.yaml + gen:api.
CLIENT: ContactList shows a verified/unverified badge per contact + a "Send verification"/"Resend" action with
  status messaging (a11y); a public verification-result page (e.g. /contact-verified). Add the route in App.tsx.
TESTS: send + verify happy path; expired/used/invalid token; idempotent re-verify; unverified is the default for
  pre-existing contacts; component + e2e.`,
  },
  {
    num: '010', slug: 'release-delivery', title: 'Release & secure one-time delivery',
    brief: `When the switch fires, securely deliver the note to VERIFIED contacts via one-time tokenized links.
DATA: tables release and release_grant (roadmap section 3). tokens.ts helper shared with 011 (mint/hash/compare).
  release-repo.ts (createRelease, createGrants, getGrantByTokenHash, markGrantViewed, set email status).
ENGINE: extend runDeadmanTick so grace-expiry -> create a release, snapshot VERIFIED contacts only, mint one grant
  token per contact, email each contact a tokenized link (via notify(), subject/body explaining a message awaits +
  the APP_BASE_URL/r/<token> link), record per-grant email_status, transition switch to 'triggered', record
  'triggered'+'released' events. MUST be idempotent: never create a second release for an already-triggered cycle
  (guard on state + existing release), so the in-process timer and an external cron can't double-fire.
PUBLIC ROUTES (no auth): GET /api/release/{token} -> hash+lookup grant; if valid & not viewed & not expired: decrypt
  the owner's note via the keyring, mark viewed_at, return the content ONCE. Already-viewed/expired -> 410 Gone.
  Decrypt failure -> fail closed 500, never leak. Rate-limit the route. Update openapi + gen:api.
MANUAL PREVIEW: POST /api/deadman/test-release (authed) -> mint a grant to the OWNER's own verified contact address
  so a user can preview the recipient experience without triggering for real (used by 012).
CLIENT: public /r/:token view-once page with a clear "this can only be opened once" warning; renders the note text.
TESTS: trigger -> grants+emails (spy provider); view-once (2nd open = 410); decrypt-fail closed; idempotent re-tick
  creates no second release; only verified contacts get grants; full e2e cycle using the DEADMAN_TEST_MODE seam to
  fast-forward (arm -> miss -> grace -> trigger -> open link once -> gone).`,
  },
  {
    num: '011', slug: 'email-checkin-links', title: 'Passwordless email check-in links',
    brief: `Let a user stay alive from their inbox: grace reminder emails embed a one-time check-in link.
DATA: table checkin_token (roadmap section 3); reuse the tokens.ts helper from 010.
WIRING: 008's grace reminder emails now mint a fresh check-in token per reminder and include
  APP_BASE_URL/checkin?token=<token> (or /api/deadman/checkin?token=) in the email body.
PUBLIC ROUTE (no auth): GET /api/deadman/checkin?token=... -> validate hash/expiry/single-use, perform the check-in
  (reset last_checkin_at/next_checkin_due_at, state back to active, clear reminders, record 'checkin' event), then a
  confirmation. Update openapi + gen:api.
CLIENT: public /checked-in confirmation page; route in App.tsx.
TESTS: token check-in resets the clock; expired/used/invalid handling; a generated reminder email actually contains a
  working link; e2e (miss deadline -> reminder -> open link -> back to active).`,
  },
  {
    num: '012', slug: 'onboarding-tutorial', title: 'Onboarding tutorial & guided setup',
    brief: `Teach the model and de-risk first use; final polish + docs for the whole suite.
CLIENT: first-run detection (no deadman_config / never armed) -> a dismissible, fully accessible guided wizard that
  explains the flow and walks the user through: write note -> add & verify a contact -> set interval/grace -> arm.
  Integrate the 010 "send myself a test release" CTA so users see what contacts will receive. Add an in-app
  help/explainer of the dead-man model. Polish empty states + the countdown formatting from 008.
ACCESSIBILITY: full keyboard nav, semantic HTML, labelled controls, WCAG AA contrast across ALL new dead-man UI
  (008-012) per constitution IV.
DOCS: update all four README sections (Architecture, Run, Manual setup incl. the new env vars + deadman:tick,
  Tests) to reflect the whole dead-man suite. Update server/.env.example.
TESTS: wizard step component tests; e2e of the first-run path; ensure the full suite (npm test, typecheck, lint) is green.`,
  },
]

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['green', 'typecheck', 'test', 'lint', 'summary'],
  properties: {
    green: { type: 'boolean', description: 'true only if typecheck, test, and lint ALL pass' },
    typecheck: {
      type: 'object', additionalProperties: false, required: ['pass', 'details'],
      properties: { pass: { type: 'boolean' }, details: { type: 'string', description: 'failing output excerpt, or empty if pass' } },
    },
    test: {
      type: 'object', additionalProperties: false, required: ['pass', 'details'],
      properties: { pass: { type: 'boolean' }, details: { type: 'string' } },
    },
    lint: {
      type: 'object', additionalProperties: false, required: ['pass', 'details'],
      properties: { pass: { type: 'boolean' }, details: { type: 'string' } },
    },
    summary: { type: 'string', description: 'one-paragraph status; if not green, the concrete failures to fix' },
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['buildPlan', 'filesToCreate', 'filesToModify', 'endpoints'],
  properties: {
    buildPlan: { type: 'string', description: 'concise but complete build plan the implementer will follow' },
    filesToCreate: { type: 'array', items: { type: 'string' } },
    filesToModify: { type: 'array', items: { type: 'string' } },
    endpoints: { type: 'array', items: { type: 'string' }, description: 'new/changed HTTP endpoints' },
  },
}

const MAX_FIX_ROUNDS = 3
const results = []

for (const f of FEATURES) {
  const tag = `${f.num}-${f.slug}`
  log(`=== Feature ${f.num}: ${f.title} ===`)

  // 1) SPEC — author the Spec-Kit artifacts for this feature and a build plan.
  phase('Spec')
  const spec = await agent(
    `${CONVENTIONS}

TASK: Author the Spec-Kit feature artifacts for feature ${f.num} (${f.title}) under
${REPO}/specs/${tag}/ : spec.md, plan.md, and tasks.md, matching the exact section structure used by the
existing specs/00N-* features and the templates in ${REPO}/.specify/templates/. Base everything on the
roadmap and this scope:

${f.brief}

Write real, committed files (use Write). spec.md: prioritized independently-testable user stories
(Given/When/Then), FR-### functional requirements, SC-### success criteria, edge cases. plan.md:
Technical Context + a Constitution Check table (all 5 principles) + Project Structure. tasks.md:
phased, TDD-first, [P] parallel markers, exact file paths.

Then RETURN (do not just write) a structured build plan the implementer will follow: the concrete list
of files to create and modify (exact paths) and the new/changed endpoints. Be precise and consistent
with the existing codebase. Your returned text is data for the next agent, not a human message.`,
    { label: `spec:${f.num}`, phase: 'Spec', schema: SPEC_SCHEMA },
  )

  // 2) IMPLEMENT — write the code + tests for the whole vertical slice.
  phase('Implement')
  await agent(
    `${CONVENTIONS}

TASK: Implement feature ${f.num} (${f.title}) END TO END on the current branch, following the spec files
just written under ${REPO}/specs/${tag}/ and this build plan:

BUILD PLAN:
${spec ? spec.buildPlan : f.brief}
Files to create: ${spec ? spec.filesToCreate.join(', ') : '(see brief)'}
Files to modify: ${spec ? spec.filesToModify.join(', ') : '(see brief)'}
Endpoints: ${spec ? spec.endpoints.join(', ') : '(see brief)'}

SCOPE DETAIL:
${f.brief}

Requirements:
- Write the implementation AND its tests together (constitution: TDD). Server: edit contracts/openapi.yaml
  for any API change then run \`npm run gen:api\`; never hand-edit shared/src/api.ts. Implement db schema,
  repos, engine/routes; mount routes in app.ts; wire any boot/timer/CLI changes in server.ts/package.json.
  Client: API client(s), pages/components, routes in App.tsx, styles in styles.css (accessible).
- Ensure the in-process dead-man timer is disabled during tests (DEADMAN_TICK_DISABLED) so tests are
  deterministic. Tests must not need real Google/network credentials.
- If this feature touches README-relevant scope (new env var, run/setup/test change), update the matching
  README.md section in this same change per CLAUDE.md (feature 012 does the full README pass).
- Before finishing, self-check by running \`cd ${REPO} && npm run gen:api && npm run typecheck\` and fix
  obvious breakages. Do NOT commit — a later step commits.

Return a short summary of what you implemented and anything left uncertain.`,
    { label: `impl:${f.num}`, phase: 'Implement' },
  )

  // 3) VERIFY + 4) FIX loop — the dynamic self-correcting cycle until green.
  let verdict = null
  for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
    phase('Verify')
    verdict = await agent(
      `${CONVENTIONS}

TASK: Verify feature ${f.num} against the merge gates. Run EACH of these from ${REPO} and capture results:
  1. npm run typecheck
  2. npm test
  3. npm run lint
Report pass/fail per command with a short excerpt of any failures. green=true ONLY if all three pass.
Do not fix anything — only report. (Note: \`npm test\` runs unit/integration/contract via vitest + hook
tests; it does NOT run Playwright e2e.)`,
      { label: `verify:${f.num}:r${round}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'low' },
    )
    if (verdict && verdict.green) { log(`Feature ${f.num} green after ${round} fix round(s).`); break }
    if (round === MAX_FIX_ROUNDS) { log(`Feature ${f.num} STILL NOT GREEN after ${MAX_FIX_ROUNDS} fix rounds.`); break }

    phase('Fix')
    await agent(
      `${CONVENTIONS}

TASK: Feature ${f.num} is failing its merge gates. Fix the code (and/or tests where the test is wrong) so
that \`npm run typecheck\`, \`npm test\`, and \`npm run lint\` all pass from ${REPO}. Keep changes minimal
and consistent with the conventions. If you change the API, edit contracts/openapi.yaml and re-run
\`npm run gen:api\`. Do not weaken tests to make them pass — fix the real defect. Do NOT commit.

FAILURES TO FIX:
typecheck: ${verdict ? (verdict.typecheck.pass ? 'OK' : verdict.typecheck.details) : 'unknown'}
test: ${verdict ? (verdict.test.pass ? 'OK' : verdict.test.details) : 'unknown'}
lint: ${verdict ? (verdict.lint.pass ? 'OK' : verdict.lint.details) : 'unknown'}
summary: ${verdict ? verdict.summary : ''}`,
      { label: `fix:${f.num}:r${round}`, phase: 'Fix' },
    )
  }

  // 5) COMMIT — one bisectable commit per feature.
  phase('Commit')
  await agent(
    `${CONVENTIONS}

TASK: Stage and commit ALL changes for feature ${f.num} on the current branch (feat/deadman-switch) as a
single commit. Use \`git add -A\` then commit with a Conventional-Commits message:
  feat(deadman): ${f.title.toLowerCase()} (${f.num})
followed by a short body summarizing the slice. End the commit message with exactly this trailer line:
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Do not push. Do not open a PR. If the pre-commit hook complains about README relevance and this feature
legitimately needs no README change, you may use --no-verify and note why. Report the commit hash and
\`git status\` after committing.`,
    { label: `commit:${f.num}`, phase: 'Commit' },
  )

  results.push({ feature: f.num, title: f.title, green: !!(verdict && verdict.green), verify: verdict })
}

// FINAL — whole-suite verification + a best-effort e2e attempt + summary.
phase('Final')
const finalVerify = await agent(
  `${CONVENTIONS}

TASK: Final whole-suite verification after all five dead-man features. From ${REPO} run and report:
  1. npm run typecheck
  2. npm test
  3. npm run lint
Then attempt the Playwright e2e suite best-effort: \`PW_CHANNEL=chrome npm run test:e2e\` (if the browser
is unavailable, report that rather than failing the whole step). Report per-command pass/fail with short
failure excerpts. green=true only if typecheck+test+lint pass (e2e is reported but not required for green).`,
  { label: 'final-verify', phase: 'Final', schema: VERIFY_SCHEMA },
)

log('Dead-man switch roadmap run complete.')
return {
  features: results,
  finalVerify,
  allGreen: results.every((r) => r.green) && !!(finalVerify && finalVerify.green),
}
