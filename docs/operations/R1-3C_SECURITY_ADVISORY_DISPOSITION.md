# R1-3C Security Advisory Disposition

Assessment date: 2026-08-24 (Asia/Shanghai)

Classification: **KNOWN SECURITY ADVISORY — TEMPORARY ACCEPTED PRE-PRODUCTION EXCEPTION**

This disposition does not classify the dependency tree as security-clean. It permits R1-3C release-candidate validation only; R1-3D execution remains gated by a fresh official recheck.

## Finding

| Field | Current assessment |
| --- | --- |
| Advisory | GHSA-ggr8-5vv4-36mx / CVE-2026-40345 |
| Severity | High; GitHub reviewed; CVSS 4.0 score 8.2 |
| Weakness | CWE-674 uncontrolled recursion / stack exhaustion |
| Affected package | `deepmerge-ts < 8.0.0` |
| Installed package | `deepmerge-ts 7.1.5` |
| Patched upstream package | `deepmerge-ts 8.0.0`; latest observed `8.0.2` |
| Dependency path | `prisma 7.9.1 -> @prisma/config 7.9.1 -> deepmerge-ts 7.1.5` |
| Dependency type | `prisma` is a direct dev dependency; vulnerable path is Prisma CLI/config tooling |
| Current stable Prisma | `7.9.1` is the npm `latest` tag as assessed; `@prisma/config` latest is also `7.9.1` |
| Stable compatible fix | None available as assessed |

Commands re-run in this phase:

```text
npm audit
npm audit --json
npm ls prisma @prisma/config deepmerge-ts
npm view prisma version
npm view @prisma/config version
npm view deepmerge-ts version
```

Observed audit result: 3 High, 0 Critical. The three reported nodes are `prisma`, `@prisma/config`, and `deepmerge-ts`, all representing the same transitive advisory chain. The recorded JSON is in `docs/operations/evidence/npm-audit-2026-08-24.json`.

Observed versions:

```text
prisma latest:          7.9.1
@prisma/config latest:  7.9.1
deepmerge-ts latest:    8.0.2
```

## Reachability

The vulnerable function requires two recursive/cyclic object graphs at the same merge path. Plain JSON alone cannot create the recursive graph described by the advisory.

The installed `@prisma/config` imports `deepmerge` while loading local `prisma.config.ts`/JavaScript configuration through `c12`. Its configuration explicitly disables remote config extension, RC files, package.json config, and remote fetching. In this project the input is the version-controlled local Prisma configuration used by CLI/build/migration operators.

Consequences for this application:

- The vulnerable dependency is not imported by the Next.js HTTP application runtime or media/competition/referee request handlers.
- Untrusted remote request data has no identified path into this merge call.
- A party able to replace the local Prisma config already has local code/config modification capability.
- Plausible project exposure is Prisma CLI availability during trusted install, generate, validate, or migration operations—not confirmed remote production compromise, confidentiality loss, or database mutation.
- Severity remains **High** in the record; reachability analysis does not lower or hide the upstream severity.

## Compatibility decision

Rejected actions:

- `npm audit fix --force`, because npm proposes Prisma `6.12.0`, a breaking downgrade.
- A blind `deepmerge-ts` 8 override/resolution, because `@prisma/config 7.9.1` pins `7.1.5` and compatibility is not officially established.
- Prisma 8 RC/prerelease adoption.
- Manual `node_modules` changes or audit-output suppression.

Decision: keep the lockfile dependency structure unchanged for R1-3C, retain the finding as a documented pre-production exception, and continue only if all other RC gates pass.

## R1-3D mandatory gate

Before any R1-3D production action, re-run the six commands above and check the GitHub advisory, npm metadata, and official Prisma stable releases.

Exact gate label:

```text
RECHECK PRISMA / DEEPMERGE ADVISORY
```

If a stable compatible Prisma release is then available, R1-3D must pause for an isolated upgrade assessment covering Prisma Client, Prisma CLI, `@prisma/adapter-libsql`, generate, validate, migration deploy, the complete regression suite, and the Node 22 production build. If only an override, downgrade, or prerelease is available, production approval requires a renewed explicit risk decision.

## 2026-09-13 emergency public-restoration recheck

Classification: **CRITICAL = 0; CURRENT NON-CRITICAL ADVISORIES DOCUMENTED FOR POST-RESTORATION MAINTENANCE**

This section records a new assessment without rewriting the historical 2026-08-24 decision above. The exact dependency remediation changed `next` and `eslint-config-next` from `16.3.2` to `16.3.4`. A clean install under Node `22.23.2` and npm `10.9.8` then produced these current results:

| Audit | Critical | High | Moderate | Result |
| --- | ---: | ---: | ---: | --- |
| `npm audit --omit=dev --audit-level=critical` | 0 | 6 | 28 | exit 0; mandatory launch gate PASS |
| full `npm audit` | 0 | 8 | 28 | recorded inventory; non-zero below the critical threshold |

The production-dependency counts include transitive effect nodes. The reviewed advisory roots and dispositions are:

| Root | Severity | Production reachability assessment |
| --- | --- | --- |
| `@tiptap/core 3.30.2` / GHSA-j95f-988m-3j2f | High | The vulnerable path parses attacker-controlled Markdown. NUAAFA does not import Tiptap Markdown helpers: its authenticated content editor serializes ProseMirror JSON, while the server enforces an exact node/mark allowlist, byte/node/depth bounds, and renders public content without Tiptap. Not remotely reachable through the unauthenticated public site. |
| `@tiptap/core 3.30.2` / GHSA-cp6q-959q-f8rh | Moderate | Tiptap is confined to the RBAC-protected admin editor. Unknown document fields and attributes, including `__proto__`, are rejected server-side, and the public renderer does not call `mergeAttributes`. Not an unauthenticated public launch blocker. |
| `deepmerge-ts 7.1.5` / GHSA-ggr8-5vv4-36mx | High | Same Prisma CLI/local-config chain documented above; no request-data path and no application-runtime import was found. |
| `fast-uri 3.1.5` / GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp | High | Present under Prisma CLI development tooling through `@prisma/dev -> ajv`. NUAAFA application code does not import it or normalize request-supplied outbound URLs with it. |
| `mysql2 3.15.3` / GHSA-3f6p-5ww8-9rcr and GHSA-rgwj-5xj2-c3m3 | High / Moderate | Present in Prisma CLI tooling. NUAAFA production uses an explicit local SQLite file through `@prisma/adapter-libsql`; it does not connect to MySQL, so the rogue-MySQL-server and compressed-MySQL-protocol prerequisites are absent. |
| `baseline-browser-mapping 2.10.43` / GHSA-w5vr-8v7q-w6rv | Moderate | Build/browser-target tooling receives no remote request parameters in the running application. |
| `browserslist 4.28.6` and `js-yaml 4.2.1` | High, full-audit dev paths only | Absent from the `--omit=dev` production inventory and not imported by NUAAFA request handlers. Retained for a separate post-restoration dependency-maintenance cycle. |

The Tiptap advisory explicitly states that editors which only consume validated ProseMirror JSON and never invoke the Markdown parsing path are not directly affected through document content. Repository inspection confirms that architecture here. No advisory severity is lowered or hidden; this is a reachability decision for the emergency launch gate only.

Rejected actions remain: `npm audit fix --force`, Prisma downgrade/major change, unverified transitive overrides, or expanding this emergency Next.js patch into broad Tiptap/Prisma/tooling modernization. Any change to the exact names, URLs, severity counts, or Critical count makes the RC security gate fail for renewed review.

## 2026-10-03 compatible fast-uri security patch

The availability-calendar release preflight failed the exact advisory-inventory gate. The unchanged `fast-uri 3.1.5` lockfile now reports two additional reviewed advisory URLs: [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) (High, authority injection through an unvalidated object-form port) and [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) (Moderate, inconsistent percent-encoded host normalization). Critical remained 0; matching the historical severity counts did not make that failed check a PASS.

Renewed dependency inspection identifies `prisma 7.9.1 -> @prisma/dev 0.24.17 -> @prisma/streams-local 0.1.11 -> ajv 8.20.0 -> fast-uri 3.1.5`. The installed AJV dependency accepts `fast-uri ^3.0.1`. The upstream [stable 3.1.8 patch](https://github.com/fastify/fast-uri/releases/tag/v3.1.8) is within that existing range and includes the two fixes (patched minima 3.1.7 and 3.1.8 respectively). This gives a compatible remediation for this dependency without changing Prisma, introducing an override, or accepting a new advisory exception.

An isolated Node 22.23.2/npm 10.9.8 lockfile trial resolved `fast-uri` to 3.1.8 and left `package.json` byte-for-byte unchanged. Its fresh production audit reported 0 Critical / 5 High / 28 Moderate, with `fast-uri` absent from the vulnerability inventory and every remaining advisory root/URL unchanged. Only the three `fast-uri` lockfile fields (version, registry URL, integrity) are carried into the candidate; unrelated npm normalization of Linux `libc` metadata is excluded. Direct dependencies, all Prisma versions, schema, migrations and application behavior are unchanged by this security patch.

The RC gate now requires the smaller reviewed inventory exactly: 0 Critical / 5 High / 28 Moderate, the same remaining names and advisory URLs, and no `fast-uri` vulnerability entry. It continues to reject any new root, URL, severity-count drift or Critical finding; there is no audit-output suppression or generalized exception. The historical dispositions for the remaining Tiptap, deepmerge-ts, MySQL/tooling and browser-target findings remain recorded above. A clean install, Prisma format/validate/generate, the RC regression/build/reproducibility checks, and calendar validation must pass before this patched candidate is release-ready. Production access, backup, rehearsal and activation gates remain separate.
