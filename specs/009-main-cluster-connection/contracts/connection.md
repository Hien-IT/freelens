# Contract: Connecting a Cluster

FR-001 to FR-005, FR-008, FR-009; research R5 to R8. What the views see of a
connection, which the core produces as the Electron build's
`ClusterConnection` does.

## Activation

`activate-cluster` `{clusterId, force?}`:

| Situation                           | What happens                                            |
| ----------------------------------- | ------------------------------------------------------- |
| id not in the catalog               | nothing; the request answers                            |
| activated, not forced               | nothing                                                 |
| an activation in flight, not forced | the request waits for it                                |
| forced while one is in flight       | waits for it to settle, then runs again                 |
| otherwise                           | runs the steps below; the request answers when they end |

The steps, each message on `cluster:<clusterId>:connection-update` to every
view:

| Step | When                           | Message (level)                                  | On failure (level `error`), then stop      |
| ---- | ------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| 1    | disconnected or not accessible | `Starting connection ...` (info)                 | `Failed to start connection: <error>`      |
| 2    | always                         | `Refreshing connection status ...` (info)        | `Failed to connection status: <error>`     |
| 3    | accessible after step 2        | `Refreshing cluster accessibility ...` (info)    | `Failed to refresh accessibility: <error>` |
| 4    | step 3 succeeded               | `Connected, waiting for view to load ...` (info) |                                            |

Step 1 resets the backoff, builds the client and clears `disconnected`. The
connection is `activated` once the steps end without a stop, whatever status
step 2 found.

## The status check

`GET /version` with a 30 s limit. Success: `metadata.version` = `gitVersion`,
`metadata.lastSeen` = now as `Date.toJSON()` writes it, the backoff reset,
access granted. Failures, each sent at level `error`:

| Failure                                                                                                | Message                                                                               | Backoff | Status        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------- | ------------- |
| the API server answers 400 to 499                                                                      | `Invalid credentials`                                                                 | counted | access denied |
| a credential plugin failed (its text matches `/getting credentials\|exec plugin\|credential plugin/i`) | `Failed to fetch credentials: <client-go's text>`                                     | counted | access denied |
| the API server answers another status                                                                  | its body, trimmed, or the status text when empty                                      | no      | offline       |
| 30 s passed and the context uses `exec`                                                                | `Connection timed out, the credential plugin may be waiting for an interactive login` | counted | offline       |
| 30 s passed                                                                                            | `Connection timed out`                                                                | no      | offline       |
| the connection failed (refused, name not resolved, certificate not trusted)                            | the core's text naming the cause                                                      | no      | offline       |

Then `online` = not offline, `accessible` = access granted.

## Refreshes and backoff

- Every 30 s, while not disconnected and the backoff allows: the status check.
  A check in progress makes the next one skip.
- Every 15 minutes, while accessible and not disconnected: the accessibility
  and the metadata.
- Counted failure n: the 30 s check waits 60 s after the first, 300 s after
  later ones; at n = 3 it stops until a reconnect and sends `Authentication
  failed 3 times, automatic reconnection paused: reconnect to try again`
  (error). Logged: `[CLUSTER]: authentication failure #<n> for "<context>",
  next automatic attempt in <s>s`, or, at 3, `[CLUSTER]: authentication failed
  3 times for "<context>", pausing automatic refresh until reconnect`.
- A success after failures logs `[CLUSTER]: authentication succeeded after <n>
  consecutive failure(s)` and resets the count.

## Accessibility

In this order; every request under the 30 s inactivity limit:

1. `POST /apis/authorization.k8s.io/v1/selfsubjectaccessreviews`
   `{namespace: "kube-system", resource: "*", verb: "create"}` → `isAdmin`.
2. The same with `{verb: "watch", resource: "*"}` → `isGlobalWatchEnabled`.
3. `allowedNamespaces`: the cluster's `accessibleNamespaces` setting, else
   `GET /api/v1/namespaces`; on error the default namespace (setting, else the
   context's); empty after a `403` → `cluster:list-namespace-forbidden` with the
   id.
4. `knownResources`: `GET /api`, `GET /apis` (5 attempts, 1-2-4-8 s, each
   failed attempt `Failed to list kube API resource kinds, attempt <n>:
   <error>` (warning)), then each group version, 5 at a time (a failure:
   `Kube APIs under "<path>" may not be displayed` (warning)). First-time
   failure: `Failed to list kube API resources, please reconnect...` (error).
5. `resourcesToShow`: `POST …/selfsubjectrulesreviews` per allowed namespace,
   5 at a time, unless `skipNamespaceAuthorizationCheck`.
6. `ready` = any known resource. The state changes in one step and is sent.

## Metadata

On the 15-minute timer and `cluster:refresh-accessibility`: the detectors of
research R7 in parallel, the highest accuracy per key, the result replacing
`metadata` in the cluster store entry.

## State and phase

`cluster-state-sync` `{clusterId, state}` goes to every view each time the
state differs from the last one sent, and for every cluster once at startup.
`initial-cluster-state-sync` answers `[{clusterId, state}]` for every cluster
of the catalog. The phase of the entity follows data-model.md, on
`catalog:items` with spec 008's coalescing.
