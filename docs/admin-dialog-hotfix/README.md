# Admin Dialog Overflow Hotfix

2026-10-02 (Europe/London). UI-only change, based on `5e6c692d8262feec2c8e3a8ea934b5f6bb120f9a`.

The shared native `WorkspaceDialog` now has a viewport-constrained flex layout: fixed header, scrollable body with `min-height: 0`, and fixed footer. It no longer inherits `.admin-panel` clipping or adjacent-panel margins. The existing white background, borders, controls and rounded corners are retained. Short content keeps its natural height.

Joint-team creation, group editing, team removal, group reassignment, standings confirmation, import confirmation and return/recheck actions use the shared footer. Footer submits are associated with their original forms through unique React IDs and `form`, preserving browser validation, FormData and submitter values. Stage/group/round configuration retains its separate forms in the scrollable body. Organization and bulk-team creation actions remain in their scrollable sections.

The page scroll lock saves/restores existing inline styles and scroll coordinates, supports nested dialogs, and returns focus with `preventScroll`. Native modal focus containment is retained. Escape does not bubble into a parent dialog, and busy dialogs retain their dismissal guard.

## Regression rule

**No critical admin Dialog submit action may become permanently unreachable because of viewport height.** Use the shared footer for main actions, with explicit form association for submit buttons. Keep section actions in a body that can scroll to its last field/action. Do not reintroduce `.admin-panel` on the native dialog or put scrolling on its outer container. New shared-dialog entries must be added to DIALOG-05 coverage.

## Verification

The saved logs record actual runs, not inferred results:

- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `npm run test:admin-dialog:browser`: exit 0, DIALOG-01 through DIALOG-05.
- Existing R3.1.3 service regression runs as the browser fixture initializer; the initial standalone run also exited 0.
- `git diff --check`: exit 0.

Browser matrix: 1440×900, 1024×768, 768×768, 390×700, 360×700, 1280×720, 1440×700. Automated Chromium checks cover dialog bounds, fixed footer visibility, scrolling to the end, all stage/group/round actions, wheel, PageDown/ArrowDown, forward Tab to the last checkbox, Shift+Tab, Escape, original scroll/style restoration and focus return. Chromium mobile emulation uses real dispatched touch gestures at 390/360 widths; physical-device Safari acceptance was not run.

DIALOG-05 opens all current shared entries: add teams (organization/joint/bulk), stage/round configuration, new/edit group, team removal, reassignment, ranking/qualification, import confirmation, and import grouping repair. It also closes a nested new-group dialog and verifies the parent remains visible, locked and focused. A joint-team submit through the detached footer was checked against the real API in a disposable database, including required-field validation and its original payload. No production test team was created.

The browser runner builds fresh disposable fixtures automatically. Run **after** build; do not rebuild `.next` while its production test server is running:

```sh
npm run build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:admin-dialog:browser
```

Omit `PLAYWRIGHT_MODULE` when Playwright is installed in the normal Node module path. The default browser channel is installed Google Chrome. `DIALOG_BROWSER_CHANNEL` can override it. No package/dependency upgrade is included. Raw results and screenshots are in `evidence/`.

## Release boundary

No Prisma schema or migration changes. No business service/API changes. Database writes during testing are restricted to temporary `nuaafa-ops-r313-*` databases; the main local database and production data were not used for fixture writes.

Production deployment and authenticated smoke remain pending: SSH to the recorded VPN and public server addresses timed out; the Tencent Cloud console required login. Follow the existing reviewed stage-only / activate-staged flow after confirming the current server/revision and unchanged schema/migration inventory. Restart only `nuaafa.service` and verify the deployed SHA and port-3001 health. Do not run the default full deployer mode, which invokes migration. Production smoke is read-only: open joint-team creation and stage/round configuration, confirm scroll and accessible actions, then cancel.
