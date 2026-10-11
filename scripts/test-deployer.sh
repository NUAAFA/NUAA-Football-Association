#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "DEPLOYER TEST FAILURE: $*" >&2
  exit 1
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

assert_event_sequence() {
  local expected="$1"
  local actual
  actual="$(cat "$events")"
  [ "$actual" = "$expected" ] || fail "event sequence mismatch: expected [$expected], got [$actual]"
}

run_main_ok() {
  local label="$1"
  local status
  shift
  set +e
  (set -Eeuo pipefail; main "$@") >"$case_root/$label.stdout" 2>"$case_root/$label.stderr"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    cat "$case_root/$label.stderr" >&2 || true
    fail "$label unexpectedly failed"
  fi
}

run_main_failure() {
  local label="$1"
  local status
  shift
  set +e
  (set -Eeuo pipefail; main "$@") >"$case_root/$label.stdout" 2>"$case_root/$label.stderr"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    fail "$label unexpectedly succeeded"
  fi
}

repo_root="$(pwd -P)"
source "$repo_root/ops/deploy/nuaafa-deploy"
student_id_preflight_command="$repo_root/scripts/student-id-release-preflight.mjs"
student_id_preflight_node="$(command -v node)"

require_root() { :; }
prepare_process() { umask 077; }
acquire_lock() { :; }
run_as_deploy_user() { "$@"; }
set_link_owner() { :; }
set_file_owner() { :; }
verify_release_owner() { :; }
temporary_current_path() { printf '%s/.current.test.new\n' "$case_root"; }
path_is_symlink() {
  local marker=""
  [ -f "$1" ] || return 1
  IFS= read -r marker <"$1" || true
  [[ "$marker" == NUAAFA_TEST_SYMLINK=* ]]
}
read_symlink_target() {
  local marker
  IFS= read -r marker <"$1"
  printf '%s\n' "${marker#NUAAFA_TEST_SYMLINK=}"
}
resolve_existing_path() {
  if path_is_symlink "$1"; then
    read_symlink_target "$1"
  else
    readlink -f -- "$1"
  fi
}
create_symlink() {
  printf 'NUAAFA_TEST_SYMLINK=%s\n' "$1" >"$2"
}
run_release_static_checks() {
  printf 'static\n' >>"$events"
}
run_release_build() {
  local release="$1"
  printf 'build\n' >>"$events"
  mkdir -p "$release/.next"
  printf 'BUILD-%s\n' "$(basename -- "$release")" >"$release/.next/BUILD_ID"
}
run_db_backup() { printf 'backup\n' >>"$events"; }
run_migration() { printf 'migrate\n' >>"$events"; }
restart_service() { printf 'restart\n' >>"$events"; }
wait_for_health() { printf 'health\n' >>"$events"; }

# Canonicalize macOS's /var alias without weakening the deployer's path checks.
test_root="$(readlink -f -- "$(mktemp -d)")"
if [ "$(uname -s)" = Darwin ]; then
  # The existing fixture already replaces link primitives. Exercise an atomic
  # rename here; GNU mv -T itself still requires the separate Linux run.
  atomic_replace_path() {
    "$student_id_preflight_node" -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$1" "$2"
  }
fi
remote="$test_root/remote.git"
remote_url="$(cygpath -m "$remote" 2>/dev/null || printf '%s\n' "$remote")"
seed="$test_root/seed"

git init --bare --initial-branch=main "$remote" >/dev/null
git init --initial-branch=main "$seed" >/dev/null
git -C "$seed" config user.name "R1-3D Deployer Test"
git -C "$seed" config user.email "r1-3d-deployer-test@example.invalid"
git -C "$seed" config core.autocrlf false
mkdir -p "$seed/prisma"
cat >"$seed/.gitignore" <<'EOF'
.env.production
prisma/dev.db
.next/
node_modules/
EOF
printf 'old\n' >"$seed/application.txt"
printf 'schema-anchor\n' >"$seed/prisma/schema-anchor.txt"
git -C "$seed" add .
git -C "$seed" commit -m "old release" >/dev/null
old_sha="$(git -C "$seed" rev-parse HEAD)"
git -C "$seed" remote add origin "$remote"
git -C "$seed" push -u origin main >/dev/null

printf 'reviewed\n' >>"$seed/application.txt"
git -C "$seed" add application.txt
git -C "$seed" commit -m "reviewed release" >/dev/null
reviewed_sha="$(git -C "$seed" rev-parse HEAD)"
git -C "$seed" push origin main >/dev/null

printf 'local-only\n' >>"$seed/application.txt"
git -C "$seed" add application.txt
git -C "$seed" commit -m "unreachable local object" >/dev/null
unreachable_sha="$(git -C "$seed" rev-parse HEAD)"

setup_case() {
  local name="$1"
  case_root="$test_root/$name"
  release_root="$case_root/releases"
  shared="$case_root/shared"
  current_link="$case_root/current"
  repository="$remote_url"
  deploy_user="$(id -un)"
  lock_file="$case_root/deploy.lock"
  service_name="fake-nuaafa.service"
  db_backup_command="$case_root/fake-backup"
  events="$case_root/events"
  mkdir -p "$release_root" "$shared/prisma"
  printf 'ENV-BASELINE\n' >"$shared/.env.production"
  "$student_id_preflight_node" --input-type=module - "$shared/prisma/dev.db" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
db.exec('CREATE TABLE "Referee" (status TEXT NOT NULL, studentId TEXT); INSERT INTO "Referee" VALUES (\'ACTIVE\', \'SYNTHETIC001\')');
db.close();
NODE
  : >"$events"

  local old_release="$release_root/$old_sha"
  git clone --no-checkout "$repository" "$old_release" >/dev/null
  git -C "$old_release" checkout --detach "$old_sha" >/dev/null
  create_symlink "$old_release" "$current_link"
}

stage_reviewed_release() {
  run_main_ok "stage" --stage-only --allowed-ref refs/heads/main "$reviewed_sha"
}

# A-E, J: successful stage-only, non-mutation boundaries, and idempotent reuse.
setup_case "stage-success"
stage_current_before="$(read_symlink_target "$current_link")"
stage_env_before="$(sha256sum "$shared/.env.production" | awk '{print $1}')"
stage_db_before="$(sha256sum "$shared/prisma/dev.db" | awk '{print $1}')"
stage_reviewed_release
staged_release="$release_root/$reviewed_sha"
[ -d "$staged_release" ] || fail "stage-only did not publish the release"
[ -f "$staged_release/.git/$provenance_name" ] || fail "stage provenance was not recorded"
assert_equal "$(read_symlink_target "$current_link")" "$stage_current_before" "stage-only current"
assert_equal "$(sha256sum "$shared/.env.production" | awk '{print $1}')" "$stage_env_before" "stage-only ENV hash"
assert_equal "$(sha256sum "$shared/prisma/dev.db" | awk '{print $1}')" "$stage_db_before" "stage-only DB hash"
assert_event_sequence $'static\nbuild'
stage_event_count="$(wc -l <"$events" | tr -d ' ')"
run_main_ok "stage-repeat" --stage-only --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(wc -l <"$events" | tr -d ' ')" "$stage_event_count" "repeated stage event count"

# F: invalid SHA rejection.
setup_case "invalid-sha"
run_main_failure "invalid-sha" --stage-only --allowed-ref refs/heads/main "not-a-sha"

# G: a local-only object is not accepted as reachable from the allowed remote ref.
setup_case "unreachable"
unreachable_current="$(read_symlink_target "$current_link")"
run_main_failure "unreachable" --stage-only --allowed-ref refs/heads/main "$unreachable_sha"
assert_equal "$(read_symlink_target "$current_link")" "$unreachable_current" "unreachable current"
[ ! -e "$release_root/$unreachable_sha" ] && ! path_is_symlink "$release_root/$unreachable_sha" || fail "unreachable commit was published"

# H: unsafe release symlink rejection.
setup_case "unsafe-release-link"
mkdir "$case_root/outside-release"
create_symlink "$case_root/outside-release" "$release_root/$reviewed_sha"
run_main_failure "unsafe-release-link" --stage-only --allowed-ref refs/heads/main "$reviewed_sha"

# I: traversal is rejected by exact SHA validation.
setup_case "traversal"
run_main_failure "traversal" --stage-only --allowed-ref refs/heads/main "../../outside"

# K: existing ambiguous/dirty release rejection.
setup_case "dirty-release"
dirty_release="$release_root/$reviewed_sha"
git clone --no-checkout "$remote" "$dirty_release" >/dev/null
git -C "$dirty_release" checkout --detach "$reviewed_sha" >/dev/null
printf 'dirty\n' >>"$dirty_release/application.txt"
run_main_failure "dirty-release" --stage-only --allowed-ref refs/heads/main "$reviewed_sha"

# L: unexpected .env.production entry type rejection.
setup_case "unsafe-env-entry"
stage_reviewed_release
unsafe_env_release="$release_root/$reviewed_sha"
rm -f "$unsafe_env_release/.env.production"
mkdir "$unsafe_env_release/.env.production"
run_main_failure "unsafe-env-entry" --stage-only --allowed-ref refs/heads/main "$reviewed_sha"

# M: unexpected prisma/dev.db entry type rejection.
setup_case "unsafe-db-entry"
stage_reviewed_release
unsafe_db_release="$release_root/$reviewed_sha"
rm -f "$unsafe_db_release/prisma/dev.db"
mkdir "$unsafe_db_release/prisma/dev.db"
run_main_failure "unsafe-db-entry" --stage-only --allowed-ref refs/heads/main "$reviewed_sha"

# N-P: activation verifies and switches only current.
setup_case "activate"
stage_reviewed_release
: >"$events"
activate_env_before="$(sha256sum "$shared/.env.production" | awk '{print $1}')"
activate_db_before="$(sha256sum "$shared/prisma/dev.db" | awk '{print $1}')"
run_main_ok "activate" --activate-staged --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(read_symlink_target "$current_link")" "$release_root/$reviewed_sha" "activated current"
assert_equal "$(sha256sum "$shared/.env.production" | awk '{print $1}')" "$activate_env_before" "activation ENV hash"
assert_equal "$(sha256sum "$shared/prisma/dev.db" | awk '{print $1}')" "$activate_db_before" "activation DB hash"
assert_event_sequence ""

# Q: missing/unbuilt staged release rejection.
setup_case "missing-stage"
missing_release="$release_root/$reviewed_sha"
git clone --no-checkout "$remote" "$missing_release" >/dev/null
git -C "$missing_release" checkout --detach "$reviewed_sha" >/dev/null
run_main_failure "missing-stage" --activate-staged --allowed-ref refs/heads/main "$reviewed_sha"

# R: unsafe current target rejection.
setup_case "unsafe-current"
stage_reviewed_release
rm -f "$current_link"
mkdir "$case_root/outside-current"
create_symlink "$case_root/outside-current" "$current_link"
run_main_failure "unsafe-current" --activate-staged --allowed-ref refs/heads/main "$reviewed_sha"

# S: unsafe temporary current path rejection.
setup_case "unsafe-temp-current"
stage_reviewed_release
mkdir "$case_root/.current.test.new"
run_main_failure "unsafe-temp-current" --activate-staged --allowed-ref refs/heads/main "$reviewed_sha"

# T: repeated activation of an already-current staged release is deterministic.
setup_case "repeat-activation"
stage_reviewed_release
: >"$events"
run_main_ok "activate-first" --activate-staged --allowed-ref refs/heads/main "$reviewed_sha"
repeat_current="$(read_symlink_target "$current_link")"
run_main_ok "activate-repeat" --activate-staged --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(read_symlink_target "$current_link")" "$repeat_current" "repeated activation current"
assert_event_sequence ""

# U: dry-run leaves deployment state unchanged for both new modes.
setup_case "stage-dry-run"
dry_stage_current="$(read_symlink_target "$current_link")"
dry_stage_entries_before="$(find "$release_root" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort)"
run_main_ok "stage-dry-run" --dry-run --stage-only --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(read_symlink_target "$current_link")" "$dry_stage_current" "stage dry-run current"
assert_equal "$(find "$release_root" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort)" "$dry_stage_entries_before" "stage dry-run release tree"
assert_event_sequence ""

setup_case "activate-dry-run"
stage_reviewed_release
: >"$events"
dry_activate_current="$(read_symlink_target "$current_link")"
run_main_ok "activate-dry-run" --dry-run --activate-staged --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(read_symlink_target "$current_link")" "$dry_activate_current" "activate dry-run current"
assert_event_sequence ""

setup_case "full-dry-run"
dry_full_current="$(read_symlink_target "$current_link")"
dry_full_entries_before="$(find "$release_root" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort)"
run_main_ok "full-dry-run" --dry-run --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(read_symlink_target "$current_link")" "$dry_full_current" "full dry-run current"
assert_equal "$(find "$release_root" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort)" "$dry_full_entries_before" "full dry-run release tree"
assert_event_sequence ""

# V: legacy/default full deploy still performs its expected ordered operations.
setup_case "full-deploy"
full_env_before="$(sha256sum "$shared/.env.production" | awk '{print $1}')"
full_db_before="$(sha256sum "$shared/prisma/dev.db" | awk '{print $1}')"
run_main_ok "full-deploy" --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(read_symlink_target "$current_link")" "$release_root/$reviewed_sha" "full deploy current"
assert_equal "$(sha256sum "$shared/.env.production" | awk '{print $1}')" "$full_env_before" "full deploy ENV fixture hash"
assert_equal "$(sha256sum "$shared/prisma/dev.db" | awk '{print $1}')" "$full_db_before" "full deploy DB fixture hash"
assert_event_sequence $'static\nbackup\nmigrate\nbuild\nrestart\nhealth'

# Actual read-only guard must reject unsafe or unverifiable identities before
# full deployment writes or activation; do not replace the guard with a mock.
setup_case "student-id-blocked-full"
"$student_id_preflight_node" --input-type=module - "$shared/prisma/dev.db" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
db.exec('INSERT INTO "Referee" VALUES (\'ACTIVE\', NULL)');
db.close();
NODE
blocked_current="$(read_symlink_target "$current_link")"
run_main_failure "student-id-blocked-full" --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(read_symlink_target "$current_link")" "$blocked_current" "blocked full current"
assert_event_sequence ""

setup_case "student-id-blocked-activate"
stage_reviewed_release
: >"$events"
"$student_id_preflight_node" --input-type=module - "$shared/prisma/dev.db" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
db.exec('UPDATE "Referee" SET studentId = \' synthetic001 \'');
db.close();
NODE
blocked_current="$(read_symlink_target "$current_link")"
run_main_failure "student-id-blocked-activate" --activate-staged --allowed-ref refs/heads/main "$reviewed_sha"
assert_equal "$(read_symlink_target "$current_link")" "$blocked_current" "blocked activation current"
assert_event_sequence ""

setup_case "student-id-unverifiable"
printf 'INVALID-SYNTHETIC-DB\n' >"$shared/prisma/dev.db"
run_main_failure "student-id-unverifiable" --allowed-ref refs/heads/main "$reviewed_sha"
assert_event_sequence ""

setup_case "student-id-guard-missing"
installed_guard="$student_id_preflight_command"
student_id_preflight_command="$case_root/missing-preflight.mjs"
run_main_failure "student-id-guard-missing" --allowed-ref refs/heads/main "$reviewed_sha"
assert_event_sequence ""
student_id_preflight_command="$installed_guard"

# A misinstalled program exiting zero cannot substitute for a verified scan.
for invalid_report in empty incomplete inconsistent; do
  setup_case "student-id-report-$invalid_report"
  student_id_preflight_command="$case_root/invalid-preflight.mjs"
  case "$invalid_report" in
    empty) : >"$student_id_preflight_command" ;;
    incomplete) printf '%s\n' 'console.log(JSON.stringify({scanComplete: 1, readOnlyVerified: 1, releaseAllowed: 1}))' >"$student_id_preflight_command" ;;
    inconsistent) printf '%s\n' 'console.log(JSON.stringify({totalReferees:1,totalActiveAccounts:1,missingStudentId:1,activeMissingStudentId:1,activeNonNormalizedStudentId:0,duplicateStudentIdGroups:0,unsafeLoginMigrationBlockers:0,scanComplete:1,readOnlyVerified:1,releaseAllowed:1}))' >"$student_id_preflight_command" ;;
  esac
  previous_current="$(read_symlink_target "$current_link")"
  run_main_failure "student-id-report-$invalid_report" --allowed-ref refs/heads/main "$reviewed_sha"
  assert_equal "$(read_symlink_target "$current_link")" "$previous_current" "unverifiable scan preserves current"
  assert_event_sequence ""
done
student_id_preflight_command="$installed_guard"

# Rollback retains the old release and never reverses database migrations.
for rollback_case in restart-failure health-failure; do
  setup_case "$rollback_case"
  previous_current="$(read_symlink_target "$current_link")"
  if [ "$rollback_case" = restart-failure ]; then
    restart_service() { printf 'restart\n' >>"$events"; return 1; }
    wait_for_health() { printf 'health\n' >>"$events"; }
  else
    restart_service() { printf 'restart\n' >>"$events"; }
    wait_for_health() { printf 'health\n' >>"$events"; return 1; }
  fi
  run_main_failure "$rollback_case" --allowed-ref refs/heads/main "$reviewed_sha"
  assert_equal "$(read_symlink_target "$current_link")" "$previous_current" "$rollback_case restored previous release"
  assert_equal "$(sed -n '/^migrate$/p' "$events" | wc -l | tr -d ' ')" "1" "$rollback_case no reverse migration"
done
restart_service() { printf 'restart\n' >>"$events"; }
wait_for_health() { printf 'health\n' >>"$events"; }

# CLI conflict/missing-SHA fail-closed coverage.
setup_case "cli-rejection"
run_main_failure "conflicting-modes" --stage-only --activate-staged "$reviewed_sha"
run_main_failure "missing-stage-sha" --stage-only
run_main_failure "unsafe-ref" --stage-only --allowed-ref refs/heads/../unsafe "$reviewed_sha"

cat <<EOF
{
  "stageOnlyExactAllowedSha": true,
  "stageOnlyCurrentUnchanged": true,
  "stageOnlyServiceUntouched": true,
  "stageOnlyMigrationNotInvoked": true,
  "stageOnlyEnvironmentUnchanged": true,
  "invalidShaRejected": true,
  "unreachableCommitRejected": true,
  "unsafeReleaseSymlinkRejected": true,
  "releaseTraversalRejected": true,
  "validStageReused": true,
  "dirtyConflictingReleaseRejected": true,
  "unexpectedEnvironmentEntryRejected": true,
  "unexpectedDatabaseEntryRejected": true,
  "activateStagedSucceeded": true,
  "activateOnlySwitchedCurrent": true,
  "activateDidNotBuildMigrateOrRestart": true,
  "missingUnbuiltReleaseRejected": true,
  "unsafeCurrentRejected": true,
  "unsafeTemporaryCurrentRejected": true,
  "repeatedActivationSafe": true,
  "dryRunDeploymentStateUnchanged": true,
  "fullDeployRegressionPassed": true,
  "isolatedRoot": "$test_root"
}
EOF
