#!/usr/bin/env bash
# Point git at the repo's tracked hooks (no husky, no extra deps).
set -euo pipefail

if [ -d .git ]; then
  git config core.hooksPath .githooks
  echo "git hooks path -> .githooks"
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "NOTE: gitleaks is not installed; the pre-commit secret scan will be skipped locally."
  echo "      CI still enforces it. Install: https://github.com/gitleaks/gitleaks#installing"
fi
