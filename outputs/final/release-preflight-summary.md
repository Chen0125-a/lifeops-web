# LifeOps release preflight summary

- Repository root: `C:\Users\Administrator\Documents\Codex\2026-08-08\bug\lifeops-web`
- Values file: `C:\Users\Administrator\Documents\Codex\2026-08-08\bug\lifeops-web\deploy\gitops\environments\production\values.yaml`
- Source revision: `c3bf5b558a24297a63e3823bdadf75314acae6d7`
- Credentials recorded: `false`

| Check | Result | Detail |
|---|---|---|
| git-cli | pass | git is available |
| git-root | pass | repository root is verified |
| git-revision | pass | HEAD must resolve to an immutable revision |
| git-branch | pass | a named release branch is required |
| git-origin | pass | origin must exist and must not embed credentials |
| git-default-branch | pass | origin default branch is known |
| git-clean | pass | release requires a clean working tree; unrelated or untracked changes are not auto-discarded |
| github-cli | pass | GitHub CLI is available |
| github-auth | pass | GitHub authentication must be valid |
| github-dispatch-capability | pass | the pinned release workflow must be readable before dispatch |
| docker-cli | pass | Docker CLI is available |
| docker-engine | pass | Docker Engine must be reachable |
| docker-buildx | pass | Docker Buildx must be available |
| helm-cli | pass | Helm CLI must be available for render validation only |
| uhub-repository-names | pass | Web and API must name distinct UHub repositories |
| uhub-credentials | pass | UHub credentials must be available through approved environment variables or the Docker credential store; values are never printed |
| uhub-repository-read | pass | both UHub repositories must pass Docker-native manifest probes; exact no-such-manifest is accepted before first release while unauthorized or denied results fail |
| production-values-file | pass | production values file exists |
| production-repositories | pass | production values must contain both confirmed repositories |
| production-digests | not-applicable | immutable digests are intentionally empty before the verified release workflow populates them |
| production-placeholders | pass | deployable production values must not retain placeholder hostnames or tokens |

This preflight invokes no cluster client or deployment operation.
