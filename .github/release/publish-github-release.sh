#!/usr/bin/env bash
# publish-github-release.sh <dir>...: attaches the CLI archives and desktop builds in the given artifact dirs, plus
# a SHA256SUMS, to the v<version> GitHub release with OPENCODE_RELEASE_NOTES.
. "$(dirname "$0")/lib.sh"

assets=$(mktemp -d)
echo "=== DEBUG: Received directories ==="
for dir in "$@"; do
  echo "Dir: $dir"
  ls -la "$dir/" 2>&1 | head -30
done

echo "=== DEBUG: Searching for assets ==="
for dir in "$@"; do
  echo "Searching in: $dir"
  find "$dir" -maxdepth 2 -type f \( -name 'opencode-*.zip' -o -name 'opencode-*.tar.gz' -o -name 'opencode-desktop-*' -o -name '*.exe' \) \
    ! -name '*.tgz' ! -name '*.app.tar' -exec cp -v {} "$assets/" \;
done

echo "=== DEBUG: Assets collected ==="
ls -la "$assets/"
echo "Total files: $(find "$assets" -type f | wc -l)"

if [ -z "$(ls -A "$assets" 2>/dev/null)" ]; then
  echo "ERROR: No assets found!"
  exit 1
fi

(cd "$assets" && sha256 -- * > SHA256SUMS 2>/dev/null && cat SHA256SUMS) || true
printf '%s\n' "${OPENCODE_RELEASE_NOTES:-}" > "$assets.md"
if dry_run; then exit 0; fi

tag="v$OPENCODE_VERSION"
echo "=== Creating release for tag: $tag ==="

# Delete existing release if exists
gh release view "$tag" > /dev/null 2>&1 && {
  echo "Deleting existing release..."
  gh release delete "$tag" --yes --cleanup-tag || true
}

echo "Creating new release..."
gh release create "$tag" --draft --verify-tag --latest=false --title "$tag" --notes-file "$assets.md"

echo "Uploading assets..."
gh release upload "$tag" "$assets"/* --clobber

echo "Publishing release..."
gh release edit "$tag" --draft=false --latest=false

echo "=== Done ==="
