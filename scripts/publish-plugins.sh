#!/usr/bin/env bash
# Build, sign, zip, and publish all Grafana plugins as GitHub releases.
# Idempotent: skips any plugin version that already has a GitHub release tag.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PLUGINS=(
  "heatmap-panel"
  "timeseries-selection-panel"
  "heatmap-app"
  "slo-app"
)

write_md5_file() {
  local input_file="$1"
  local output_file="$2"

  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$input_file" | awk '{print $1}' >"$output_file"
    return
  fi

  if command -v md5 >/dev/null 2>&1; then
    md5 -q "$input_file" >"$output_file"
    return
  fi

  echo "Error: neither md5sum nor md5 is available to generate checksums." >&2
  exit 1
}

# Signing mode. These plugin IDs are not registered in the Grafana catalog,
# so a catalog signature (sign-plugin with no --rootUrls) is always rejected
# with HTTP 409. The only signature Grafana will grant us is a PRIVATE one,
# which requires the root URL(s) of the Grafana instance(s) the plugins run on.
# Set GRAFANA_SIGN_ROOT_URLS (comma-separated) to sign; leave it unset to
# publish unsigned zips — which is how these plugins are already loaded
# (GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS in docker-compose).
SIGNING_ENABLED=false
if [[ -n "${GRAFANA_SIGN_ROOT_URLS:-}" ]]; then
  SIGNING_ENABLED=true
  if [[ -z "${GRAFANA_ACCESS_POLICY_TOKEN:-}" ]]; then
    echo "Error: GRAFANA_SIGN_ROOT_URLS is set but GRAFANA_ACCESS_POLICY_TOKEN is not. Cannot sign." >&2
    exit 1
  fi
else
  echo "GRAFANA_SIGN_ROOT_URLS is not set — publishing UNSIGNED plugin zips." >&2
  echo "Grafana must allowlist them via GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS." >&2
fi

if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "Error: GITHUB_REPOSITORY is not set." >&2
  exit 1
fi

# Build all plugins
echo "Building all plugins..."
npm run build --prefix "$ROOT_DIR"

for PLUGIN in "${PLUGINS[@]}"; do
  PLUGIN_DIR="$ROOT_DIR/plugins/$PLUGIN"
  echo ""
  echo "==> Processing $PLUGIN..."

  # Read plugin ID from the built dist/plugin.json
  PLUGIN_ID=$(node -e "process.stdout.write(require('${PLUGIN_DIR}/dist/plugin.json').id)")

  # Read version from package.json (updated by changeset version)
  VERSION=$(node -e "process.stdout.write(require('${PLUGIN_DIR}/package.json').version)")

  TAG="${PLUGIN_ID}-v${VERSION}"

  # Skip if this release already exists (idempotent)
  if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" &>/dev/null; then
    echo "    Release $TAG already exists — skipping."
    continue
  fi

  if [[ "$SIGNING_ENABLED" == "true" ]]; then
    # Private signature scoped to the configured Grafana instance root URL(s).
    echo "    Signing plugin (private, rootUrls: ${GRAFANA_SIGN_ROOT_URLS})..."
    if SIGN_OUTPUT=$(cd "$PLUGIN_DIR" && GRAFANA_ACCESS_POLICY_TOKEN="$GRAFANA_ACCESS_POLICY_TOKEN" \
        npm run sign -- --rootUrls "$GRAFANA_SIGN_ROOT_URLS" 2>&1); then
      printf '%s\n' "$SIGN_OUTPUT"
    else
      SIGN_EXIT=$?
      printf '%s\n' "$SIGN_OUTPUT"
      if [[ "$SIGN_OUTPUT" == *"status code 409"* ]]; then
        echo "    Error: Grafana rejected the signing request for ${PLUGIN_ID} (HTTP 409)." >&2
        echo "    Likely causes: plugin ID prefix does not match the Grafana Cloud org slug" >&2
        echo "    that issued GRAFANA_ACCESS_POLICY_TOKEN, or the ID is owned by another org." >&2
      fi
      exit "$SIGN_EXIT"
    fi
  else
    echo "    Skipping signing (unsigned publish)."
  fi

  # Package: rename dist → plugin-id, zip, restore
  echo "    Creating zip archive ${PLUGIN_ID}-${VERSION}.zip..."
  cd "$PLUGIN_DIR"
  cp -r dist "$PLUGIN_ID"
  zip -r "${PLUGIN_ID}-${VERSION}.zip" "$PLUGIN_ID"
  rm -rf "$PLUGIN_ID"
  cd "$ROOT_DIR"

  # Extract release notes for this version from CHANGELOG.md
  NOTES=""
  if [[ -f "$PLUGIN_DIR/CHANGELOG.md" ]]; then
    NOTES=$(awk \
      "/^## ${VERSION}[[:space:]]*$/{found=1; next} found && /^## /{exit} found{print}" \
      "$PLUGIN_DIR/CHANGELOG.md" \
      | sed '/^[[:space:]]*$/d' \
      || true)
  fi
  if [[ -z "$NOTES" ]]; then
    NOTES="Release ${PLUGIN_ID} v${VERSION}"
  fi

  ZIP_PATH="$PLUGIN_DIR/${PLUGIN_ID}-${VERSION}.zip"
  MD5_PATH="$PLUGIN_DIR/${PLUGIN_ID}-${VERSION}.zip.md5"

  echo "    Generating MD5 checksum ${PLUGIN_ID}-${VERSION}.zip.md5..."
  write_md5_file "$ZIP_PATH" "$MD5_PATH"

  # Create the GitHub release and attach the zip + md5
  echo "    Creating GitHub release $TAG..."
  gh release create "$TAG" \
    --repo "$GITHUB_REPOSITORY" \
    --title "${PLUGIN_ID} v${VERSION}" \
    --notes "$NOTES" \
    "$ZIP_PATH" \
    "$MD5_PATH"

  # Clean up release assets from the plugin directory
  rm -f "$ZIP_PATH" "$MD5_PATH"

  echo "    Released $TAG"
done

echo ""
echo "All plugins processed."
