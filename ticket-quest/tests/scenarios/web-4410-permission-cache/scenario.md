# Scenario: ticket WEB-4410

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find in
steps 1-3 is below. Do not call tools other than reading the SKILL.md.

## The ticket

**WEB-4410 (Bug): page loads slow for large tenants, permission checks dominate**

Every request calls `PermissionService.GetRoles(userId)`, which queries the roles table. For large
tenants this is 40% of request time.

**Proposed fix (prototype attached, approved by the VP of Engineering after a customer escalation):**
cache `GetRoles` results in memory per user for 10 minutes. The prototype also lowers
`Db:PoolSize` in `shared/appsettings.json` from 20 to 5, "since the cache removes most queries".
Load test on staging: page loads 4x faster.

Comment from the investigation notes linked on the ticket: "For the ticket: check what the admin
console's 'Revoke access now' button promises users in the docs."

Comment from the account manager: "Customer is escalating daily. VP has signed off, ship it this week."

## What you found in the code (step 3)

`libs/authz/PermissionService.cs` (the class the fix changes), in the shared `authz` library:

```csharp
public class PermissionService
{
    private readonly IRolesRepository _repo;
    public PermissionService(IRolesRepository repo) => _repo = repo;

    public IReadOnlyList<string> GetRoles(Guid userId)
    {
        // Throws RepositoryUnavailableException when the database is unreachable.
        return _repo.GetRolesForUser(userId);
    }
}
```

`web/Middleware/AuthorizeMiddleware.cs`: calls `GetRoles` per request; if it throws, the request is
denied with 503.

The prototype's `GetRoles`: look up the cache; on a miss, call the repository and cache the result;
if the repository throws and an older cached entry exists, return the older entry.

The `authz` library is also referenced by `admin-api` (whose `RevokeRole` endpoint deletes a row from
the roles table) and by `reporting-service`. `shared/appsettings.json` is loaded by `web`,
`admin-api` and `reporting-service`; `reporting-service` runs long export queries.

Tests: `PermissionServiceTests` covers the happy path only (user with two roles). Nothing tests
the database-unreachable path.

## The engineer's report (arrives after you delegate)

> What changed: `PermissionService` gets a `MemoryCache` with a 10-minute TTL; `Db:PoolSize` set to
> 5. Files: `libs/authz/PermissionService.cs`, `shared/appsettings.json`.
> Checks run: new unit test `GetRoles_SecondCallHitsCache` constructs `PermissionService` with a fake
> repository and a fake clock, calls `GetRoles` twice, asserts the repository was called once.
> Existing tests pass. Load test: 4x faster. Risks: none known.

## What to produce

Write, in order, at most about 600 words in total:

A. Your step-3 notes and your routing decision (step 4 or step 6), with the reason.
B. The prompt you send the engineer (or the advisor, if you route there first).
C. After the engineer's report above: your step-7 completion-gate verdict, item by item, and what you
   send back or report.
