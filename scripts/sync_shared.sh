#!/bin/sh
# Copies each file listed in scripts/shared-files.txt from crm/ (the source) to admin/. Run it after editing a shared file. (The older shared files flow-core.js,
# flow-rules.js and flow.css are still copied by hand; a test checks they match.)
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
grep -v '^[[:space:]]*#' "$root/scripts/shared-files.txt" | grep -v '^[[:space:]]*$' | while read -r f; do
  cp "$root/crm/$f" "$root/admin/$f"
  echo "synced $f"
done
