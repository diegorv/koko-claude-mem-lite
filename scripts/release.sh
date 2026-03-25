#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh [patch|minor|major]
# Defaults to "patch" if no argument given.
# Reads the latest git tag, bumps it, updates package.json, commits, tags, and pushes.

BUMP_TYPE="${1:-patch}"

if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
  echo "Usage: $0 [patch|minor|major]"
  exit 1
fi

# Get latest version tag, fallback to v0.0.0 if none exists
LATEST_TAG=$(git tag -l 'v*.*.*' --sort=-v:refname | head -1)
if [ -z "$LATEST_TAG" ]; then
  LATEST_TAG="v0.0.0"
fi

# Strip the 'v' prefix and split into parts
VERSION="${LATEST_TAG#v}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"

# Bump
case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
NEW_TAG="v${NEW_VERSION}"

echo "Bumping: ${LATEST_TAG} -> ${NEW_TAG} (${BUMP_TYPE})"

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: you have uncommitted changes. Commit or stash them first."
  exit 1
fi

# Update package.json version
if command -v node &> /dev/null; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '${NEW_VERSION}';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
else
  # Fallback: sed-based replacement
  sed -i.bak "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" package.json
  rm -f package.json.bak
fi

# Commit version bump and create tag
git add package.json
git commit -m "chore: bump version to ${NEW_VERSION}"
git tag -a "$NEW_TAG" -m "Release ${NEW_TAG}"

echo ""
echo "Pushing main and ${NEW_TAG} to origin..."
git push origin main "$NEW_TAG"

echo ""
echo "Released ${NEW_TAG}"
