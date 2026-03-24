#!/bin/bash
# Installs memory-lite-plugin as a Claude Code plugin via symlink.
# Usage: ./install.sh

set -e

PLUGIN_SOURCE="$(cd "$(dirname "$0")/plugin" && pwd)"
CACHE_DIR="$HOME/.claude/plugins/cache/local/memory-lite/0.1.0"
INSTALLED_JSON="$HOME/.claude/plugins/installed_plugins.json"

# Build first
echo "Building..."
bun "$(dirname "$0")/build.ts"

# Create symlink in cache
if [ -L "$CACHE_DIR" ]; then
  echo "Removing existing symlink..."
  rm "$CACHE_DIR"
elif [ -d "$CACHE_DIR" ]; then
  echo "Removing existing directory..."
  rm -rf "$CACHE_DIR"
fi

mkdir -p "$(dirname "$CACHE_DIR")"
ln -s "$PLUGIN_SOURCE" "$CACHE_DIR"
echo "Symlink created: $CACHE_DIR -> $PLUGIN_SOURCE"

# Register in installed_plugins.json
if [ -f "$INSTALLED_JSON" ]; then
  # Check if already registered
  if grep -q '"memory-lite@local"' "$INSTALLED_JSON"; then
    echo "Plugin already registered in installed_plugins.json"
  else
    # Add entry using a temp file (portable JSON manipulation)
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    python3 -c "
import json, sys

with open('$INSTALLED_JSON', 'r') as f:
    data = json.load(f)

data['plugins']['memory-lite@local'] = [{
    'scope': 'user',
    'installPath': '$CACHE_DIR',
    'version': '0.1.0',
    'installedAt': '$TIMESTAMP',
    'lastUpdated': '$TIMESTAMP'
}]

with open('$INSTALLED_JSON', 'w') as f:
    json.dump(data, f, indent=2)
"
    echo "Plugin registered in installed_plugins.json"
  fi
else
  echo "Warning: installed_plugins.json not found at $INSTALLED_JSON"
fi

echo ""
echo "Done! Restart Claude Code to load the plugin."
echo "Data will be stored in ~/.memory-lite/"
