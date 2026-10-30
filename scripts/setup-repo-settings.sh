#!/usr/bin/env bash
# Applies the Stanza repository settings: labels, branch protection, merge
# policy, discussions. Requires an admin token.
#
#   REPO=Streams-Hq/stanza ./scripts/setup-repo-settings.sh
set -euo pipefail

REPO="${REPO:-Streams-Hq/stanza}"

command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required: https://cli.github.com" >&2
  exit 1
}

label() {
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null
}

echo "→ Labels"
label "Stellar Wave" "7B3FE4" "Scoped for the Stellar Drips Wave program"
label "good first issue" "7057ff" "Small, well-bounded change"
label "complexity: low" "0E8A16" "A few hours"
label "complexity: mid" "FBCA04" "A day or two"
label "complexity: high" "B60205" "Several days, design involved"
label "contract" "5319E7" "Soroban contract (Rust)"
label "sdk" "1D76DB" "TypeScript SDK"
label "indexer" "006B75" "Event indexer and REST API"
label "web" "C5DEF5" "Next.js application"
label "docs" "D4C5F9" "Documentation"
label "testing" "BFD4F2" "Tests and CI"

echo "→ Repository features"
gh api -X PATCH "repos/${REPO}" \
  -F has_discussions=true \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true >/dev/null

echo "→ Branch protection for main"
gh api -X PUT "repos/${REPO}/branches/main/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Soroban contract (fmt, test, wasm)",
      "SDK, indexer and web app",
      "Documentation build"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "→ Pages (source: GitHub Actions)"
gh api -X POST "repos/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 || \
  gh api -X PUT "repos/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 || true

echo
echo "Applied to ${REPO}. Remaining manual steps:"
echo "  • Confirm the Pages workflow has deployed: https://${REPO%%/*}.github.io/${REPO##*/}/"
echo "  • Add the production indexer URL as a repository variable if you deploy one"
echo "  • Enable secret scanning and Dependabot alerts in Settings → Code security"
