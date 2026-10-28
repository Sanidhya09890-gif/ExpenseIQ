# Expense splitting API (Phase 2)

Both existing expense routes continue to use JWT authentication and group membership
authorization. An inaccessible/missing group returns 404; invalid request data returns
400. Missing/invalid authentication remains handled by the existing middleware.

## POST /api/expenses/add

The request fields remain `title`, `amount`, `groupId`, `paidBy`, `splitBetween`.

- IDs must be 24-character hexadecimal strings.
- `title` must be a nonempty string; surrounding whitespace is trimmed.
- `amount` must be positive INR, with at most two decimal places. Decimal strings
  and numbers are accepted. Unsafe paise values, or amounts that cannot round-trip
  through the existing Number rupee schema, are rejected rather than rounded.
- `paidBy` must identify the authenticated user and belong to the group.
- `splitBetween` must contain unique group member IDs, with at least one entry.
  The payer need not be included. No default participants are substituted.

The successful response remains HTTP 201 `{ message, expense }`. The stored
`amount` remains rupees for compatibility; `createdBy` remains the authenticated user.

## GET /api/expenses/group/:groupId

HTTP 200 returns `{ expenses, members, summary }`.

- `expenses` retains the existing expense fields and rupee `amount`. `paidBy` and
  each `splitBetween` item resolve to `{ _id, username }`. Deleted users retain
  `{ _id, unresolved: true }`; null references remain null. Participant order and
  duplicates in historical records are never rewritten or filtered.
- `members` contains current group member references in the same format, with no
  emails or passwords. Historical former participants remain in calculations.
- `summary.totalAmountPaise`: total expenses in integer paise.
- `summary.users[]`: `{ userId, paidPaise, sharePaise, netPaise, status }`.
  `netPaise = paidPaise - sharePaise`; status is `receives`, `owes`, or `settled`.
- `summary.allocations[]`: in expense-array order, each contains `payerId`,
  `amountPaise`, `shares: [{ userId, sharePaise }]`, and `unresolvedUserIds`.
- `summary.unresolvedUserIds`: historical user IDs not resolved in the database.

All summary monetary fields are safe integer **paise**, not rupees. The calculation
engine uses integer arithmetic, allocating remainder paise to sorted participant
IDs. Historical self-only expenses remain self-only. No new members are inserted
into existing splits. A valid but unresolved user ID still receives its recorded
credit/share and is explicitly reported.

If historical amounts or references are invalid/unrecoverable, or totals exceed
safe integer limits, the response remains HTTP 200 for existing expense cards:

```json
{
  "expenses": [],
  "members": [],
  "summary": null,
  "calculationError": {
    "code": "INVALID_EXPENSE_DATA",
    "message": "Details identifying the failed calculation"
  }
}
```

The arrays above are illustrative; the actual readable expense/member data is
returned. Consumers must check `summary`/`calculationError` before showing balances.
No partial summary is returned. Unexpected database failures still return HTTP 500.

`GET /api/groups` now populates members with `_id` and `username` instead of
`name`/`email`. No frontend selection or balance display is integrated in this phase.

## Tests

From the repository root:

```sh
node --test BackEnd/test/*.test.js
```

Controller tests mock model methods and never connect to MongoDB. They do not
replace a later development-environment HTTP/database integration test.
