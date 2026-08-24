# LifeOps observability runbook

This runbook is intentionally read-only first. It does not authorize cluster changes, automated restarts, rollbacks or destructive remediation.

## Inspect

Identify the firing alert, namespace, release and start time. Review the LifeOps dashboard for availability, request rate, 5xx ratio, p50/p95 duration, active requests, pod CPU/memory/restarts and deployment revision. Correlate only by the structured `requestId`; logs must not contain bodies, authorization headers, cookies or secrets.

## Confirm

Confirm the condition across a second signal before escalating: compare probes with `up`, application metrics with pod readiness/restarts, and the observed deployment generation with the expected user-owned release. Check whether traffic is nonzero before interpreting error ratios. Preserve timestamps and queries as evidence.

## Mitigate

Apply only reversible, user-approved application actions. Reduce optional upstream integration load, pause a new application release, or route users to the documented maintenance state when authorized. Do not run `kubectl`, synchronize Argo CD, restart workloads, mutate the cluster or expose `/metrics` through the public Gateway from this repository.

## Recover

Verify availability, readiness, 5xx ratio and p95 duration remain healthy for at least the alert `for` window. Record the immutable image digests, dashboard interval, correlated request IDs and any approved application-level action. Close the incident only after alerts resolve and no secret-bearing evidence was retained.
