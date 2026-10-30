#!/usr/bin/env bash
# Rewrites the pre-pivot repository identifiers (Streams-Hq/stellar-stream-app,
# StellarStream, @stellar-stream/*) to the Stanza names.
#
# Dry run (default): shows every file that still contains an old identifier.
#   ./scripts/rename-repo.sh
# Apply:
#   ./scripts/rename-repo.sh --apply
#
# Override the target names if you keep a personal account instead of an org:
#   NEW_ORG=your-user NEW_REPO=stanza ./scripts/rename-repo.sh --apply
set -euo pipefail

OLD_ORG="${OLD_ORG:-Streams-Hq}"
OLD_REPO="${OLD_REPO:-stellar-stream-app}"
NEW_ORG="${NEW_ORG:-stanza-labs}"
NEW_REPO="${NEW_REPO:-stanza}"

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

# Every identifier that has to change. Order matters: longest first.
IDENTIFIERS=(
  "Deyanju23/stellar-stream-contract|${NEW_ORG}/${NEW_REPO}"
  "${OLD_ORG}/${OLD_REPO}|${NEW_ORG}/${NEW_REPO}"
  "deyanju23.github.io/stellar-stream-app|${NEW_ORG}.github.io/${NEW_REPO}"
  "stellar-stream-contract|${NEW_REPO}"
  "stellar-stream-app|${NEW_REPO}"
  "@stellar-stream/sdk|@stanza/sdk"
  "@stellar-stream/|@stanza/"
  "stellar-stream|stanza"
  "StellarStream|Stanza"
  "deyanju23|${NEW_ORG}"
  "${OLD_ORG}|${NEW_ORG}"
)

FILES=$(rg -l --hidden \
  -g '!.git' -g '!node_modules' -g '!target' -g '!pnpm-lock.yaml' -g '!*.wasm' \
  -e 'StellarStream|stellar-stream|Deyanju23|deyanju23|Streams-Hq' . || true)

if [[ -z "${FILES}" ]]; then
  echo "No old identifiers left. Nothing to do."
  exit 0
fi

echo "Target: ${NEW_ORG}/${NEW_REPO}"
echo
for file in ${FILES}; do
  echo "  ${file}"
done
echo

if [[ "${APPLY}" != "true" ]]; then
  echo "Dry run only. Re-run with --apply to rewrite $(echo "${FILES}" | wc -l) files."
  exit 0
fi

for file in ${FILES}; do
  for pair in "${IDENTIFIERS[@]}"; do
    old="${pair%%|*}"
    new="${pair##*|}"
    perl -pi -e "s/\Q${old}\E/${new}/g" "${file}"
  done
done

echo "Rewrote identifiers. Remaining references:"
rg -n --hidden -g '!.git' -g '!node_modules' -g '!target' \
  -e 'StellarStream|stellar-stream|Deyanju23|Streams-Hq' . || echo "  none"
echo
echo "Now rename on GitHub (this cannot be undone by this script):"
echo "  1. Create or rename the org:  ${NEW_ORG}"
echo "  2. Rename the repo:           gh repo rename ${NEW_REPO} --repo ${OLD_ORG}/${OLD_REPO}"
echo "  3. If the org is new:         gh repo transfer ${NEW_ORG}/${NEW_REPO} ${NEW_ORG}"
echo "  4. Update the Pages URL + custom domain to ${NEW_ORG}.github.io/${NEW_REPO}"
echo "  5. Re-run 'pnpm install' so the workspace links @stanza/sdk again."
echo "  6. Update the Drips Wave submission URL and README badges."
