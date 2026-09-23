#!/usr/bin/env bash
# Run this ONCE, on a machine that can actually reach your Postgres instance
# (your dev machine, your server — wherever `psql` can connect).
#
# It applies a newly-rotated password to the app's database role. It does
# NOT touch anything remotely — Claude cannot run this for you because
# Claude's sandbox has no network path to your database; you have to run
# it from somewhere that does.
#
# SECURITY: this script previously had a real, generated password hardcoded
# directly in its own source — itself a leak, regardless of that password
# having been intended as "the fix" for an earlier one. It now prompts for
# the new password instead, so no credential ever sits in this file.
#
# Usage:
#   chmod +x db/scripts/apply-rotated-password.sh
#   ./db/scripts/apply-rotated-password.sh
#
# Requires: psql installed, and MIGRATOR_DATABASE_URL set in .env to a
# connection string with permission to ALTER ROLE (usually the postgres
# superuser, not the app user itself).

set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run this from the api/ project root." >&2
  exit 1
fi

# shellcheck disable=SC1091
source <(grep -E '^(MIGRATOR_DATABASE_URL|DATABASE_URL)=' .env)

if [ -z "${MIGRATOR_DATABASE_URL:-}" ]; then
  echo "ERROR: MIGRATOR_DATABASE_URL is not set in .env." >&2
  echo "It needs to be a connection string with permission to ALTER ROLE (superuser)." >&2
  exit 1
fi

ROLE_NAME="plug_app_user"

read -rsp "Enter the new password for ${ROLE_NAME}: " NEW_PASSWORD
echo
if [ -z "$NEW_PASSWORD" ]; then
  echo "ERROR: No password entered." >&2
  exit 1
fi

echo "Applying rotated password to role ${ROLE_NAME}..."
psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "ALTER ROLE ${ROLE_NAME} WITH PASSWORD '${NEW_PASSWORD}';"

echo "Done. ${ROLE_NAME}'s password now matches DATABASE_URL in .env."
echo "Next: restart your backend so it picks up the new .env value."
