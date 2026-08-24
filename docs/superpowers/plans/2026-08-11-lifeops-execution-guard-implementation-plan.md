# LifeOps Execution Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Implement the pre-P1 execution guard that inventories every approved clause, derives all 44 requirement rollups from atomic acceptance and fresh evidence, validates cross-session state, and prevents false task, phase or project completion.

**Architecture:** A Node-standard-library validator reads eleven locked normative sources, three machine-readable traceability artifacts and the external project handoff ledger. Small modules own Markdown clause extraction, authority/state loading, source checkpoints, acceptance validation and evidence freshness; one CLI composes them into startup, task-close, phase-close, handoff and project-close modes. Until a formal Git repository exists, evidence is tied to a sorted allowlisted file-hash manifest and root SHA-256; formal publication still requires a real Git revision.

**Tech Stack:** Node.js 24 standard library, node:test, JSON, Markdown source files, SHA-256, existing npm.cmd scripts. No new runtime dependency, Git initialization, Docker, registry or Kubernetes access is permitted by this plan.

## Global Constraints

- This control plan runs before P1-T1 and may not modify business behavior in src/, server/src/ domain/routes/store code, migrations, Helm templates or workflows.
- The five hash-locked authority files and all P1-P6 work-package plans are the complete static clause source set.
- AGENTS.md, execution-control, project CURRENT and the latest project session are dynamic state inputs, validated separately from static clause classification.
- The 44 parent requirement IDs remain the only product rollups; atomic rows may not create product scope outside their source clauses.
- Every validator defect is fixed by a red-green test in scripts/verify-execution-contract.test.mjs.
- A syntax, missing-file, dependency or connection failure is not an acceptable behavioral red test.
- The validator uses only Node standard-library modules and repository data.
- No evidence artifact may contain credentials, cookies, kubeconfig, private keys, raw personal content or sensitive logs.
- Visual evidence requires an opened-artifact/manual conclusion; generated screenshots alone never pass.
- Required MySQL, remote E2E, image, registry or delivery-package evidence with any skipped test never passes.
- Missing or unverifiable digest-bound SBOM/provenance blocks DELIVERY-01.
- No-Git checkpoints are temporary local evidence only; project-close requires an approved Git revision.
- No task may overwrite an occupied session number. Session paths are selected from max existing S-number plus one and recorded before use.

---

### Task 1: Define the execution-contract model and deterministic loaders

**Files:**
- Create: scripts/execution-contract/constants.mjs
- Create: scripts/execution-contract/load-json.mjs
- Create: scripts/execution-contract/markdown-clauses.mjs
- Create: scripts/verify-execution-contract.test.mjs

**Interfaces:**
- Produces AUTHORITY_FILES: exactly five relative paths.
- Produces WORK_PACKAGE_FILES: exactly six relative paths.
- Produces PARENT_REQUIREMENT_IDS: the original 20 plus LIFE-01 through LIFE-24.
- Produces readJson(path), sha256Text(text), normalizeRelativePath(path).
- Produces extractClauseCandidates(sourceKey, markdown): ClauseCandidate[].
- ClauseCandidate fields: sourceKey, sourcePath, headingPath, kind, ordinal, text, textSha256.

- [x] **Step 1: Write the failing constants and extraction tests.**

~~~js
test('locks five authority files, six work packages and 44 parent IDs', () => {
  assert.equal(AUTHORITY_FILES.length, 5)
  assert.equal(WORK_PACKAGE_FILES.length, 6)
  assert.equal(new Set(PARENT_REQUIREMENT_IDS).size, 44)
})

test('extracts headings, paragraphs, list items and table rows deterministically', () => {
  const rows = extractClauseCandidates('SPEC', fixtureMarkdown)
  assert.deepEqual(rows.map((row) => row.kind), [
    'heading', 'paragraph', 'list-item', 'table-row',
  ])
  assert.match(rows[2].textSha256, /^[A-F0-9]{64}$/)
})
~~~

- [x] **Step 2: Run the red test.**

Run:

~~~powershell
node --test scripts/verify-execution-contract.test.mjs
~~~

Expected: FAIL because the execution-contract modules do not exist.

- [x] **Step 3: Implement constants, strict JSON loading and Markdown candidate extraction.**

The extractor must:

- normalize CRLF/LF before hashing;
- track ATX heading hierarchy;
- treat each non-empty prose paragraph, list item and non-separator table row as one candidate;
- preserve source order and an ordinal within the same heading/kind;
- hash the full normalized clause text, never only its summary;
- reject duplicate source keys and files outside the fixed eleven-file set.

- [x] **Step 4: Run the focused test and confirm it passes.**

~~~powershell
node --test scripts/verify-execution-contract.test.mjs
~~~

- [x] **Step 5: Record the one-time bootstrap file hashes.**

Run git rev-parse --show-toplevel. If unavailable, record literal SHA-256 values for the four Task 1 files in S016 as `bootstrap-only/not-evidence`. This exception only tracks the files needed to build the real checkpoint generator; it cannot satisfy startup, task-close or any product evidence. Task 2 must replace it with the first sorted allowlisted root checkpoint before another control task begins.

### Task 2: Implement authority verification and the no-Git source checkpoint

**Files:**
- Create: scripts/execution-contract/authority.mjs
- Create: scripts/execution-contract/source-checkpoint.mjs
- Modify: scripts/verify-execution-contract.test.mjs

**Interfaces:**
- Produces readAuthoritySnapshot(executionControlText): Map<relativePath, sha256>.
- Produces verifyAuthorityHashes(workspaceRoot, snapshot): ValidationIssue[].
- Produces collectCheckpointInputs(workspaceRoot): string[].
- Produces buildLocalCheckpoint(workspaceRoot): { kind, rootSha256, files, includeRules, excludeRules }.
- Checkpoint file rows: { path, sha256 }, sorted by normalized relative path.

- [x] **Step 1: Write failing authority and checkpoint tests.**

~~~js
test('reports one exact authority mismatch', async () => {
  const issues = await verifyAuthorityHashes(fixtureRoot, approvedSnapshot)
  assert.deepEqual(issues.map((issue) => issue.code), ['AUTHORITY_HASH_MISMATCH'])
  assert.equal(issues[0].path, AUTHORITY_FILES[2])
})

test('local checkpoint is stable and ignores generated/sensitive paths', async () => {
  const first = await buildLocalCheckpoint(fixtureRoot)
  const second = await buildLocalCheckpoint(fixtureRoot)
  assert.equal(first.rootSha256, second.rootSha256)
  assert.equal(first.files.some((row) => row.path.startsWith('node_modules/')), false)
  assert.equal(first.files.some((row) => row.path.startsWith('outputs/evidence/')), false)
  assert.equal(first.files.some((row) => row.path.includes('private_key')), false)
})
~~~

- [x] **Step 2: Run the test and confirm behavioral failures.**

~~~powershell
node --test scripts/verify-execution-contract.test.mjs
~~~

- [x] **Step 3: Implement the authority parser and checkpoint allowlist.**

The allowlist includes:

- root package.json/package-lock.json and TypeScript/Vite/Vitest/Playwright configuration;
- src/, server/src/, server/migrations/, tests/, tests-remote/ and scripts/;
- Dockerfile, server/Dockerfile, nginx.conf and docker-entrypoint.sh;
- deploy/ and .github/workflows/;
- docs/traceability/ contract JSON and requirements ledger.

It excludes:

- node_modules/, server/node_modules/, dist/, server/dist/ and work/;
- outputs/evidence/, outputs/final/, Playwright reports and test-results;
- .git/ and editor/runtime caches;
- any filename matching private-key, credential, cookie, token, kubeconfig or test-database generated key patterns.

The normalized manifest is UTF-8 lines of path, one space and uppercase SHA-256. The root SHA-256 is the hash of those sorted lines plus a final newline.

- [x] **Step 4: Add mutation tests proving one included file changes the root and one excluded file does not.**

- [x] **Step 5: Run the focused test.**

~~~powershell
node --test scripts/verify-execution-contract.test.mjs
~~~

- [x] **Step 6: Save the first real uncommitted-local-checkpoint** under outputs/evidence/source-checkpoints/ with no secret-bearing filenames, then record only its path and root SHA-256 in S016.

### Task 3: Build and validate the eleven-file source-clause registry

**Files:**
- Create: scripts/build-source-clauses.mjs
- Create: scripts/execution-contract/source-clauses.mjs
- Create: docs/traceability/source-clauses.json
- Modify: scripts/verify-execution-contract.test.mjs

**Interfaces:**
- Produces buildSourceClauseCandidates(workspaceRoot): SourceClauseCandidate[].
- Produces validateSourceClauses(registry, currentCandidates): ValidationIssue[].
- SourceClause fields: id, sourceKey, sourcePath, headingPath, kind, ordinal, textSummary, textSha256, classification, atomIds, reason, supersededBy.
- classification accepts mapped, context-only, superseded.

- [x] **Step 1: Write failing tests for the fixed source set and classification rules.**

~~~js
test('fails when a later work package is absent from the registry', () => {
  const issues = validateSourceClauses(registryWithoutP6, candidates)
  assert(issues.some((issue) => issue.code === 'SOURCE_FILE_SET_MISMATCH'))
})

test('fails mapped clauses without atoms and context clauses without reasons', () => {
  const issues = validateSourceClauses(invalidRegistry, candidates)
  assert(issues.some((issue) => issue.code === 'MAPPED_CLAUSE_WITHOUT_ATOM'))
  assert(issues.some((issue) => issue.code === 'CONTEXT_REASON_REQUIRED'))
})
~~~

- [x] **Step 2: Run the tests and confirm the validator behavior is missing.**

- [x] **Step 3: Implement preview-only candidate generation.**

The build command writes JSON to stdout by default. It may write docs/traceability/source-clauses.json only with --apply and must refuse to replace an existing classified registry unless --replace-classifications is also supplied. Text changes retain the stable manual clause ID when sourceKey, headingPath, kind and ordinal still match, but update textSha256 and force review.

- [x] **Step 4: Implement registry validation.**

It must reject:

- a source set other than the exact five authority plus six P1-P6 files;
- duplicate clause IDs or duplicate locators;
- current clauses missing from the registry;
- registry clauses no longer present;
- changed text hashes without a reviewed classification;
- mapped clauses without atom IDs;
- context-only clauses without a concrete non-normative reason;
- superseded clauses without replacement evidence.

- [x] **Step 5: Generate the real candidate registry and classify every row.**

Run:

~~~powershell
node scripts/build-source-clauses.mjs
node scripts/build-source-clauses.mjs --apply
~~~

Review every generated row. Use mapped only for enforceable product/control behavior, context-only only for headings/background/explanation with a reason, and superseded only with ADR-016 through ADR-019 or a later explicit user decision.

- [x] **Step 6: Run source-registry validation until there are zero unclassified, orphan or stale rows.**

~~~powershell
node --test scripts/verify-execution-contract.test.mjs
~~~

- [x] **Step 7: Regenerate the no-Git checkpoint and record the new root.**

### Task 4: Define and validate atomic acceptance structure and page coverage

**Files:**
- Create: scripts/execution-contract/acceptance.mjs
- Create: docs/traceability/acceptance-matrix.json
- Modify: scripts/verify-execution-contract.test.mjs

**Interfaces:**
- Produces validateAcceptanceMatrix(matrix, sourceRegistry): ValidationIssue[].
- Matrix top-level fields: schemaVersion, parentRequirementIds, surfaces, atoms.
- Surface fields: id, kind, path, parentRequirementIds, requiredDimensions.
- Atom fields: id, parentRequirementId, title, contract, sourceClauseIds, surfaces, plannedTasks, requiredEvidence, finalBoundary, notApplicable.
- finalBoundary is an ordered array containing local and, only where applicable, image or registry.

- [x] **Step 1: Write failing structural tests.**

~~~js
test('rejects duplicate atoms, unknown parents and orphan source clauses', () => {
  const issues = validateAcceptanceMatrix(invalidMatrix, sourceRegistry)
  assert(issues.some((issue) => issue.code === 'DUPLICATE_ATOM_ID'))
  assert(issues.some((issue) => issue.code === 'UNKNOWN_PARENT_REQUIREMENT'))
  assert(issues.some((issue) => issue.code === 'ATOM_WITHOUT_SOURCE_CLAUSE'))
})

test('requires every visual page to declare all eight minimum coverage groups', () => {
  const issues = validateAcceptanceMatrix(matrixMissingMobileMotion, sourceRegistry)
  assert(issues.some((issue) =>
    issue.code === 'SURFACE_DIMENSION_MISSING' &&
    issue.surface === '/app/life/recipes' &&
    issue.dimension === 'MOTION'))
})
~~~

- [x] **Step 2: Run the red tests.**

- [x] **Step 3: Implement ID, parent, task, surface, evidence and boundary validation.**

Valid dimensions are LAYOUT, FUNC, DATA, CALC, TXN, STATE, NAV, RESP, A11Y, MOTION, SEC and OPS. Every visible route/overlay from execution-completeness section 6 must declare applicable minimum dimensions. A notApplicable entry requires reason and approvedSourceClauseId; it cannot suppress the universal four-breakpoint, keyboard/focus, return/close or reduced-motion contracts for a visible page.

- [x] **Step 4: Seed all 44 parent IDs and the complete surface catalog.**

The catalog must include public home/five details/login, private shell/overview/global overlays, every original private route, every life route and calendar overlay, all seven platform subtabs, and the cross-page transactions listed in execution-completeness section 6.6.

- [x] **Step 5: Run the focused test and checkpoint the task.**

### Task 5: Populate atomic contracts for the original 20 requirements

**Files:**
- Modify: docs/traceability/acceptance-matrix.json
- Modify: docs/traceability/source-clauses.json
- Modify: scripts/verify-execution-contract.test.mjs

**Interfaces:**
- Produces complete atomic children for PUB-01 through DELIVERY-01.
- Every mapped original-domain source clause points back to one or more atom IDs.

- [x] **Step 1: Add a failing coverage test** that lists any original parent with zero atoms, any mapped clause without an atom, and any original-domain surface/dimension without an atom.

- [x] **Step 2: Run the test and capture the expected missing-parent/missing-dimension failures.**

- [x] **Step 3: Add atomic rows by independent behavior.**

Split desktop/mobile, success/error/conflict/offline/permission, forward/reverse motion, enter/return state, data calculation/presentation, and write/reversal transactions whenever they can fail independently. DELIVERY-01 atoms must separately cover GitHub release, Web image, API image, exact-digest smoke, SBOM, provenance, UHub inspect, production values and delivery-package validation.

- [x] **Step 4: Map each original-domain normative clause to atom IDs and add approved reasons for true context-only rows.**

- [x] **Step 5: Run the coverage test until all original 20 parents and their surfaces are structurally complete.**

- [x] **Step 6: Regenerate and record the root checkpoint.**

### Task 6: Populate atomic contracts for LIFE-01 through LIFE-24

**Files:**
- Modify: docs/traceability/acceptance-matrix.json
- Modify: docs/traceability/source-clauses.json
- Modify: scripts/verify-execution-contract.test.mjs

**Interfaces:**
- Produces complete atomic children for LIFE-01 through LIFE-24.
- Produces explicit cross-consumer atoms for the master-data-to-history/stock/budget/purchase/Obsidian chain.

- [x] **Step 1: Add a failing life coverage test** that reports every LIFE parent, route, state dimension and business transaction without atomic coverage.

- [x] **Step 2: Run the test and record the expected missing coverage.**

- [x] **Step 3: Add atomic rows for LIFE-01 through LIFE-24.**

The matrix must independently cover:

- future recalculation versus immutable completed history;
- complete versus undo inventory events;
- prepared-food creation versus later consumption;
- purchase versus partial purchase versus refund;
- cash expenditure versus consumption cost;
- template apply, explicit sync and date-only copy;
- soft delete, restore, reference protection and permanent-delete gate;
- import preview, restore point, all-or-nothing apply and failed rollback;
- connected, conflict, degraded and unsupported Obsidian states;
- offline draft versus server-confirmed inventory/purchase/completion;
- medicine factual storage, private export and no-advice boundary;
- all life pages at 1440x900, 1024x768, 768x1024 and 390x844 with keyboard/focus/reduced motion and reachable exit.

- [x] **Step 4: Map every life normative clause and the cross-page impact graph to atom IDs.**

- [x] **Step 5: Run the original-plus-life coverage tests until all 44 parents, all sources and all required surfaces/dimensions are complete.**

- [x] **Step 6: Regenerate and record the root checkpoint.**

### Task 7: Implement evidence, freshness and rollup validation

**Files:**
- Create: scripts/execution-contract/evidence.mjs
- Create: docs/traceability/evidence-manifest.json
- Modify: scripts/verify-execution-contract.test.mjs

**Interfaces:**
- Produces validateEvidenceManifest(manifest, matrix, checkpoint): ValidationIssue[].
- Produces deriveAtomStatus(atom, evidence): pending | partial | verified-local | verified-image | verified-registry | invalidated.
- Produces deriveParentStatus(parentId, atomStatuses): parent rollup using the least-complete applicable atom.
- Evidence fields: id, atomIds, type, command, exitCode, startedAt, completedAt, checkpoint, sourcePaths, summary, artifactPath, artifactSha256, skipped, manualReview.

- [x] **Step 1: Write failing evidence tests.**

~~~js
test('invalidates evidence when a dependent source path hash changes', () => {
  assert.equal(deriveAtomStatus(atom, [staleEvidence]), 'invalidated')
})

test('rejects skipped MySQL and unopened visual artifacts', () => {
  const issues = validateEvidenceManifest(manifest, matrix, checkpoint)
  assert(issues.some((issue) => issue.code === 'REQUIRED_SUITE_SKIPPED'))
  assert(issues.some((issue) => issue.code === 'VISUAL_NOT_OPENED'))
})
~~~

- [x] **Step 2: Run the red tests.**

- [x] **Step 3: Implement strict evidence validation.**

Require exit code 0, no required skip, a current checkpoint, current hashes for every sourcePath, an existing artifact with matching SHA-256 when artifactPath is present, and a sanitized relative artifact path under outputs/evidence or outputs/final. Manual visual evidence requires reviewer, opened: true, breakpoint, checklist conclusions and motion/reduced-motion result.

- [x] **Step 4: Implement atom and parent rollups.**

Boundary order is pending < partial < verified-local < verified-image < verified-registry. A parent cannot exceed its least-complete applicable atom. invalidated evidence moves the affected atom out of verified status while preserving the old evidence row for audit.

- [x] **Step 5: Seed evidence-manifest.json as an empty schema-valid manifest** with the current root checkpoint and no fabricated pass rows.

- [x] **Step 6: Run tests and regenerate the checkpoint.**

### Task 8: Implement startup and state-consistency validation

**Files:**
- Create: scripts/execution-contract/project-state.mjs
- Create: scripts/execution-contract/startup.mjs
- Create: scripts/verify-execution-contract.mjs
- Modify: scripts/verify-execution-contract.test.mjs
- Modify: package.json
- Modify: package-lock.json only if npm changes it while adding scripts

**Interfaces:**
- Produces resolveProjectMemoryRoot(args, env, agentsText): absolute path.
- Produces loadProjectState(workspaceRoot, memoryRoot): execution-control/CURRENT/latest-session state.
- Produces validateStartup(context): ValidationIssue[].
- CLI accepts --mode and optional --task, --phase, --project-memory-root.

- [x] **Step 1: Write failing startup tests** for wrong working directory, authority drift, missing source file, duplicate requirement, missing atom, multiple active tasks, CURRENT/session mismatch and absent unique next action.

- [x] **Step 2: Run the red tests.**

- [x] **Step 3: Implement project-memory resolution.**

Resolution order is CLI --project-memory-root, LIFEOPS_PROJECT_MEMORY_ROOT, then the current canonical path explicitly declared in AGENTS.md. The validator prints which source it used, verifies CURRENT.md/DECISIONS.md/sessions exist and never reads credentials or kubeconfig.

- [x] **Step 4: Implement startup composition and stable output.**

Success output contains authority revision, status, active plan/task/step, 44 rollup count, root checkpoint, blockers, unique next action and first command. Failure output lists machine-readable issue codes and exits 1 without changing files.

- [x] **Step 5: Add package scripts.**

~~~json
{
  "verify:execution": "node scripts/verify-execution-contract.mjs",
  "test:execution": "node --test scripts/verify-execution-contract.test.mjs"
}
~~~

- [x] **Step 6: Run tests, then run startup against the real workspace.**

~~~powershell
npm.cmd run test:execution
npm.cmd run verify:execution -- --mode startup
~~~

Expected: tests pass. Real startup may remain red only for an explicitly named, planned bootstrap condition; fix all structural/data failures before Task 9.

- [x] **Step 7: Regenerate and record the root checkpoint.**

### Task 9: Implement task-close, phase-close, handoff and project-close modes

**Files:**
- Create: scripts/execution-contract/close-modes.mjs
- Modify: scripts/verify-execution-contract.mjs
- Modify: scripts/verify-execution-contract.test.mjs

**Interfaces:**
- Produces validateTaskClose(context, taskId).
- Produces validatePhaseClose(context, phaseId).
- Produces validateHandoff(context).
- Produces validateProjectClose(context).

- [x] **Step 1: Write failing task-close tests** for missing behavioral red evidence, syntax-only red evidence, undeclared changed path, skipped MySQL, missing four-breakpoint/manual visual evidence, missing keyboard/reduced-motion evidence and absent checkpoint.

- [x] **Step 2: Write failing phase-close tests** for incomplete task, mixed checkpoints, incomplete phase atoms and a later package implemented early.

- [x] **Step 3: Write failing handoff tests** for disagreement among execution-control, plan checkbox, requirement ledger, matrix/evidence, CURRENT and latest session, including two next actions or an occupied session path reused.

- [x] **Step 4: Write failing project-close tests** for absent Git revision, mutable image tag, missing Web/API digest, mismatched production values, missing exact-digest smoke, missing SBOM, missing provenance, registry inspect failure, placeholder production values and missing deployment/backup/rollback documents.

- [x] **Step 5: Run the red tests.**

~~~powershell
npm.cmd run test:execution
~~~

- [x] **Step 6: Implement each close mode without writing project state.**

All modes are read-only. task-close/phase-close/handoff/project-close exit 1 on any issue. project-close explicitly ignores absent Argo Synced/Healthy, Kubernetes context, hostname, Pod rebuild and cluster smoke; it must not ignore UHub digests, exact-image smoke, SBOM/provenance or delivery-package failures.

- [x] **Step 7: Run the complete execution-contract test suite.**

~~~powershell
npm.cmd run test:execution
~~~

- [x] **Step 8: Regenerate and record the root checkpoint.**

### Task 10: Bootstrap the real contract, pass startup/handoff and prepare the fresh-task drill

**Files:**
- Modify: docs/traceability/source-clauses.json
- Modify: docs/traceability/acceptance-matrix.json
- Modify: docs/traceability/evidence-manifest.json
- Modify: docs/traceability/requirements.md
- Modify: docs/superpowers/plans/2026-08-09-execution-control.md
- Modify: D:/笔记/项目/LifeOps-高可用K8s平台/CURRENT.md
- Modify: the current S016+ project session
- Modify: docs/handoff/NEW_TASK_CONTINUATION_PROMPT.md only if its command/state fields differ

**Interfaces:**
- Produces a structurally green startup and handoff state at P1/P1-T1/Step 1/0 of 44.
- Produces the exact user-triggered fresh-task drill prompt and comparison checklist.

- [x] **Step 1: Add a failing real-workspace acceptance test** that invokes startup and handoff through child_process and expects exit 0.

- [x] **Step 2: Run it and record every remaining real-data mismatch.**

~~~powershell
npm.cmd run test:execution
~~~

- [x] **Step 3: Complete all real clause classifications, atom mappings and empty-evidence bootstrap metadata.**

No product atom may be marked verified. The only green assertions are structural completeness, correct authority hashes, consistent handoff state and the current no-Git checkpoint.

- [x] **Step 4: Update the four handoff sources** with the exact validator commands, exit codes, current root checkpoint, zero verified requirements, unverified Docker/GitHub/UHub/MySQL 8.4 facts and one next action: user opens a new task for the read-only drill.

- [x] **Step 5: Run the complete control gate.**

~~~powershell
npm.cmd run test:execution
npm.cmd run verify:execution -- --mode startup
npm.cmd run verify:execution -- --mode handoff
~~~

Expected: all commands exit 0, no skipped control tests, state remains P1/P1-T1/Step 1 and 0/44.

- [x] **Step 6: Inspect the generated checkpoint and evidence files for sensitive content** using explicit filename and high-confidence secret-pattern scans; remove unsafe artifacts and rerun the gate if found.

- [x] **Step 7: Create the final Git-or-SHA checkpoint** for the execution guard and record literal hashes/exit codes in execution-control, CURRENT and the current session.

- [x] **Step 8: Ask the user to open a new Codex task in the same workspace** with the short continuation prompt. The new task must run startup read-only and report authority/status/task/count/blockers/next command exactly.

- [x] **Step 9: Compare the fresh-task report field by field.**

Only after the user-triggered drill matches may execution-control change to implementation-active. The next action then becomes writing the P1-T1 migration test followed by:

~~~powershell
npm.cmd run test:server -- server/src/db/migrate.test.ts
~~~

## Plan Self-Review

- Spec coverage: Tasks 1-10 cover the fixed eleven-file clause set, atomic matrix, page dimensions, cross-page impact graph, evidence freshness, deterministic no-Git checkpoint, five validator modes, handoff consistency, SBOM/provenance hard gates and the user-triggered fresh-task drill.
- Scope: the plan changes only execution-control artifacts and validation scripts; it does not start P1 business implementation or touch the Kubernetes cluster.
- Placeholder scan: the plan contains no TBD, TODO, REPLACE_ME or deferred implementation instruction. Runtime-generated clause/atom rows are accepted only when validators prove zero omissions.
- Type consistency: sourceClauseIds, atomIds, surfaces, plannedTasks, finalBoundary, checkpoint and evidence fields use the same names across all tasks.
- Completion truth: passing tests alone does not start P1; startup, handoff and the real user-triggered fresh-task drill must all pass while the product remains 0/44.
