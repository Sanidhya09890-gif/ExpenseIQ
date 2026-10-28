# Group management — backend Phase 1

All new endpoints require the existing JWT middleware. No frontend is integrated.

## GET /api/groups/:groupId/members

Current members only. Returns a snapshot for the future confirmation UI:

```json
{
  "groupId": "ObjectId string",
  "ownerId": "ObjectId string",
  "members": [{
    "userId": "ObjectId string",
    "username": "Member",
    "unresolved": false,
    "role": "member",
    "canLeave": false,
    "canRemove": true,
    "balance": {
      "available": true,
      "netPaise": -5000,
      "warning": {
        "code": "OUTSTANDING_BALANCE",
        "message": "Removal does not settle, cancel, or redistribute existing debts. Historical balances remain unchanged."
      }
    }
  }],
  "balancePolicy": "preserve-history",
  "previewOnly": true
}
```

Roles and actions are viewer-specific. Only the owner may remove another member.
Only a non-owner may leave themselves. Missing user accounts retain their IDs and
return `username: null` with `unresolved: true`; no emails/passwords are returned.

`netPaise` is a safe signed integer: positive means receivable, negative means
owed, zero means settled. An accurate zero returns `warning: null`. Invalid
historical accounting returns `available: false`, `netPaise: null`, and a
`BALANCE_UNAVAILABLE` warning. Database failures are not converted into zero or
unavailable financial data; they fail the request.

## POST /api/groups/:groupId/leave

No target ID is accepted from the body; the target is `req.user.id`. Current
non-owner members only. Owner leave returns 409.

## DELETE /api/groups/:groupId/members/:memberId

The current owner, who must also be a current member, may remove another current
member. Ordinary-member attempts return 403; owner self-removal returns 409.

Both removal endpoints return HTTP 200:

```json
{
  "message": "Member removed",
  "groupId": "ObjectId string",
  "memberId": "ObjectId string",
  "balance": { "available": true, "netPaise": 0, "warning": null }
}
```

Leave uses `message: "You left the group"`. The balance is recalculated inside
the removal transaction, so it may differ from a prior preview. Option B permits
removal with any balance or with an explicit unavailable-balance warning. The
future frontend must fetch the preview and show the warning **before** confirmation,
then reflect any updated warning from the removal response. No debt is forgiven,
settled, reassigned, or duplicated. All historical expense fields remain intact.

Malformed IDs return 400; missing/invalid JWTs return 401; inaccessible/missing
groups and nonmember targets return 404; changed/already-consumed invitations and
conflicting operations return 409. Duplicate removals do not repeat side effects.
Unavailable transactions return 503; unexpected operation failures return 500.

## Rejoining and concurrency

- All application membership changes, owner invitation creation, invitation
  acceptance/rejection, expense creation, and whole-group deletion transact with
  a write to the same Group document (`$inc: { __v: 1 }`). Existing group versioning
  is used; no schema changes are required. Snapshot transactions use majority
  commit acknowledgement and driver retries for transient write conflicts.
- Removal uses conditional `$pull`, invalidates outstanding target/group pending
  invitations as `expired`, and deletes only their `INVITE_RECEIVED` notifications.
  Accepted/rejected invitation history and activity notifications are preserved.
- Creation expires stale pending invitations, then checks for duplicates under
  the group-write guard. Fresh records always receive new IDs. Accepted/rejected/
  expired records cannot be consumed again.
- Acceptance/rejection checks the authenticated invitee, pending status, expiry,
  and current owner membership. Acceptance uses `$addToSet`. No historical expense
  is inserted or modified by either decision.
- Revocation applies to subsequent requests and serializes concurrent writes.
  Previously downloaded data and reads already in flight cannot be recalled.
- GET group/expense APIs retain their existing shape. Former members are still
  represented in expense history/summaries but do not pass membership authorization.

## Topology and pending-invitation index

Transactions are required. There is **no nontransactional fallback**. The runtime
checks replica-set/sharded topology; transaction permission/commit failures also
prevent success. Standalone MongoDB is unsupported for these guarded writes.

Read-only preflight, from the repository root:

```sh
node BackEnd/scripts/groupManagementAudit.js
```

This loads the backend environment without printing it, checks `hello`, and reports
only transaction capability and the number of duplicate pending group/invitee pairs.
No default index creation or automatic history migration is enabled.

After reviewing the audit, coordinate a maintenance window and explicitly create
the partial unique index with:

```sh
node BackEnd/scripts/groupManagementAudit.js --create-index
```

The script refuses index creation if pending duplicates exist. Review those
records before a separately authorized migration; never delete invitation history.
The index is `{ groupId: 1, invitee: 1 }` with `unique: true` and
`partialFilterExpression: { status: 'pending' }`. Group serialization prevents
duplicate pending creation through the application even before this defensive
index is installed. Direct database writers must not bypass these services.
Deploy all application writers together (or pause writes during the rollout): an
older process using read/modify/save membership logic does not participate in the
new group guard. Exercise stale-invite expiry with the partial index in the isolated
integration environment before applying the index to the application database.

Reference: [MongoDB partial unique indexes](https://www.mongodb.com/docs/manual/core/index-partial/).

## Tests

```sh
node --test BackEnd/test/*.test.js FrontEnd/test/*.test.js
```

The ordinary suite is mocked/in-memory. Real concurrency tests are opt-in:
set `EXPENSEIQ_TEST_MONGO_URI` to a dedicated development replica set and
`EXPENSEIQ_TEST_ALLOW_MUTATIONS=1`, then run
`node --test BackEnd/test/groupManagement.integration.test.js`.
Never point this at production. The test rejects the application URI, explicitly
selects a freshly generated `expenseiq_test_<pid>_<timestamp>` database, creates
fixtures/indexes there, and drops only that exact test database afterward.

Before frontend integration: run isolated database tests, apply the reviewed index
migration, and build preview + custom confirmation controls with loading/error
states. Leaving clears the selected-group state and navigates to Dashboard;
removal refreshes member selection and balances. No settlement feature is implied.
