# Maintenance write lock

Set `MAINTENANCE_WRITE_LOCK=true` in the backend environment to reject POST,
PUT, PATCH and DELETE under `/api/groups`, `/api/expenses`, `/api/auth/signup`
and `/api/notifications`. Only the exact lowercase string `true` enables it;
unset is disabled. Locked requests receive 503 JSON and `Retry-After: 120`.
Login, GET, HEAD and CORS preflight remain available. Authentication on unlocked
routes is unchanged. The guard runs before JSON parsing and route handlers.

Use `/readyz` as the Render health-check path. It returns 200 only while MongoDB
is connected and shutdown has not started; otherwise 503. It intentionally stays
ready during write maintenance and does not expose configuration or database data.
This is a connection-state check, not a database round-trip or transaction probe.

SIGTERM/SIGINT mark readiness unavailable, stop accepting HTTP connections, drain
active requests, then disconnect MongoDB. A 25-second deadline forces exit with
failure if draining stalls. Keep Render's shutdown allowance above this deadline.

This local implementation does not protect the currently deployed old release.
Prepare the maintenance-capable bridge release separately. Enable the lock on all
writers, finish the rollout and verify old instances and in-flight writes have
stopped before migration. Environment changes require the appropriate Render
restart/deploy; this is not a distributed or instant cancellation mechanism.
Deploy the updated backend with the lock retained, migrate only with separate
approval, then reopen writes. Keep a maintenance-capable rollback release.

No credentials or environment files need to be committed. Maintenance must not be
used as a replacement for authentication, transaction guards or index constraints.
