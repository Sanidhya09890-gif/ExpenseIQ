# Username uniqueness and legacy compatibility

New registrations require a string matching `^[A-Za-z0-9_.-]{3,40}$` both with OTP
enabled and with the legacy signup feature mode. New User documents and explicit
username changes are also validated. Existing names are never trimmed, lowercased,
renamed, backfilled or recreated. Case-sensitive semantics are retained: `Owner`
and `owner` remain distinct usernames, as before.

The exact proposed index on `expenceiq.users` is:

```javascript
db.users.createIndex(
    { username: 1 },
    {
        name: "unique_username_string",
        unique: true,
        partialFilterExpression: { username: { $type: "string" } },
        collation: { locale: "simple" }
    }
);
```

This is documentation, not an executed migration. Run only after separate approval
and a current audit of the intended cluster/database. No index synchronization,
index dropping or production account update is part of the implementation.

MongoDB's type filter excludes missing/null usernames. It enforces uniqueness for
all existing string usernames, including unusual legacy strings, conservatively
preventing collisions. The stricter registration syntax is application validation,
not a regex filter in the index (partial indexes do not support regex conditions).
Audit actual legacy BSON types, including arrays, before migration: MongoDB type
queries can match strings inside arrays. Do not silently rewrite malformed records.

The User schema declares only this partial username index; the previous inline
`unique: true` declaration is removed. `autoIndex: false` prevents model import or
startup from provisioning it or attempting the obsolete full unique index. The
existing unique email declaration remains; provisioning is explicit. Never use
`syncIndexes()` during rollout, because it may drop unrelated indexes.

OTP readiness requires the exact name, single key, unique flag and exact partial
filter. It rejects full/sparse/hidden indexes, narrower/different filters and
non-simple collations. MongoDB may omit the simple collation from listIndexes;
absence is accepted as the effective simple policy. Additional server-generated
metadata such as index version/background does not change the policy.

Multiple missing/null legacy usernames remain readable and can log in by email
using the same password and ID. Hydrated legacy documents can validate without
changing an untouched historical username. Setting a new invalid username fails.
There is no public exemption for new missing/null usernames. Group membership and
accounting continue to use user IDs; no expense, membership, invitation, notification
or balance references are rewritten. Email ownership is not inferred or backfilled.

## Remaining migration steps (separate approval required)

1. Re-audit production username BSON types and exact duplicate string usernames.
   Preserve all missing/null users. Resolve any unexpected duplicates through a
   separately reviewed plan without deleting/recreating accounts or changing IDs.
2. Review the collection's default collation and existing index specifications.
3. Pause signup/username writers and drain older processes. Deploy the compatible
   backend under maintenance with automatic User indexing disabled and the OTP
   flag still disabled; no old process should try to rebuild the full index.
4. Create only the index above and independently verify its exact specification.
   Do not remove any existing email, invitation, expense or other indexes.
5. Verify readiness and frontend compatibility under maintenance, then enable OTP
   and reopen writes after smoke checks. No User metadata backfill or password
   changes are required. Retain a rollback build that understands this partial
   policy; do not reintroduce the obsolete automatic full-index declaration.

Previously initialized manual test databases contain `username_1`; they are not
changed by this implementation. Adding the new partial index there also requires
explicit authorization. A retained full index can still restrict multiple null/
missing usernames; removing it, if needed, is another separately approved action.
Until the partial index is provisioned, OTP readiness on those databases fails
closed after a restart with the updated code. Existing running servers are not
restarted here. Production's five missing/null users remain untouched.

Only generated disposable integration databases receive indexes and fixtures in
the automated tests. Those tests build the partial index after inserting multiple
missing/null legacy fixtures, test competing new-name claims and case-sensitive
names, verify legacy email login/IDs and unchanged group/expense history, and drop
only their generated databases. Real email delivery is mocked.
