# Protected administrator account management

The existing login `nuaafa` is the permanent highest administrator. Ownership is derived from this immutable, reserved login, not from the assignable `SUPER_ADMIN` role. No database migration is required. Existing account IDs, passwords, sessions and business data are unchanged when the release is installed.

- `nuaafa` always resolves to all administrator permissions. It appears first in the list and is labelled 最高管理员 in both the account table and personal menu.
- Account management rejects changes to its roles, active state, administrative password reset and deletion, including through legacy status services. Its owner can change their password through the existing personal menu with the current password. Self-demotion, disable and deletion are intentionally blocked for this permanent owner.
- Other `SUPER_ADMIN` accounts retain management of other ordinary/delegated accounts, including role updates, enable/disable, password reset and deletion. Ownership cannot be assigned to another account. Ordinary module roles cannot access these system mutations.
- Reset uses PATCH with `action: "reset-password"`, `id` and `password`. Passwords are hashed; all target sessions are deleted and `mustChangePassword` is set in the same transaction. The next login must complete the existing password change flow. Resetting one's own password uses the personal menu.
- DELETE requires `id` and an exact `confirmUsername`. It blocks self-deletion and loss of the last active super administrator. Sessions are explicitly deleted before the account so the nullable session foreign key cannot create a legacy privileged session. Role assignments cascade; business records and audit history survive through existing SetNull relations. The deleted identity and roles are recorded in the deletion audit. The action cannot be undone.
- Existing login/Origin/password-change/role authorization gates apply to both new mutations. Secrets and password hashes are excluded from returned account data and audit metadata.

Account dialogs reuse WorkspaceDialog for native modal focus handling, Escape, page scroll lock, a scrollable body and fixed actions. Role checkbox dimensions and labels are scoped to this page to avoid the global form input width/min-height rule.

## Verification

Run `npm run test:unified-admin-rbac`, `npm run test:unified-admin-r1`, `npm run typecheck` and `npm run build`. Run `node scripts/test-admin-accounts-browser.mjs` after building; when Playwright is bundled outside this project, set `PLAYWRIGHT_MODULE` to its `index.mjs`. The browser suite uses installed Chrome, a disposable migrated database and a loopback production server on port 3117 (override with `ADMIN_ACCOUNTS_TEST_PORT`). It adapts Origin and Secure cookies only in the test client; the application's production checks remain intact.

Evidence is in `evidence/browser-results.json` and the adjacent screenshots. The fixture accounts shown there are test data. Technical and browser validation does not constitute production deployment or human acceptance; no production accounts are modified by these checks.
