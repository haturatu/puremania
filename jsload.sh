#!/bin/bash

# jsload.sh: Switches JS library mode and manages the local build process.
#
# Usage:
#   ./jsload.sh local     - Installs, builds, and switches to the local JS bundle.
#   ./jsload.sh remote    - Switches to the remote CDN and cleans up local build artifacts.

set -e

# --- Configuration ---
INDEX_FILE="static/index.html"
REMOTE_TEMPLATE="index.html.remote"
LOCAL_TEMPLATE="index.html.local"

# --- Functions ---

check_npm() {
  if ! command -v npm &> /dev/null
  then
      echo "Error: npm is not installed. Please install Node.js and npm first." >&2
      exit 1
  fi
}

switch_to_local() {
    check_npm
    if [ ! -f "${LOCAL_TEMPLATE}" ]; then
        echo "Error: Local template '${LOCAL_TEMPLATE}' not found." >&2
        exit 1
    fi

    echo "Running 'npm install' to get dependencies..."
    npm install

    echo "Running 'npm run build' to create local bundle..."
    npm run build

    echo "Switching to local bundle..."
    cp "${LOCAL_TEMPLATE}" "${INDEX_FILE}"
    echo "Success. Now using local bundle: /static/dist/app.bundle.js"
}

switch_to_remote() {
    if [ ! -f "${REMOTE_TEMPLATE}" ]; then
        echo "Error: Remote template '${REMOTE_TEMPLATE}' not found." >&2
        exit 1
    fi
    echo "Switching to remote CDN (esm.sh)..."
    cp "${REMOTE_TEMPLATE}" "${INDEX_FILE}"

    echo "Cleaning up local build artifacts..."
    rm -rf node_modules
    rm -rf static/dist
    rm -f package-lock.json
    echo "Cleanup complete."
    echo "Success. Now using remote CDN."
}

usage() {
  echo "Usage: $0 {local|remote}" >&2
  echo "  local:    Installs, builds, and switches to the local JS bundle." >&2
  echo "  remote:   Switches to the remote CDN and cleans up local build artifacts." >&2
  exit 1
}

# --- Main Logic ---

if [ -z "$1" ]; then
  usage
fi

case "$1" in
  local)
    switch_to_local
    ;;
  remote)
    switch_to_remote
    ;;
  *)
    usage
    ;;
esac

exit 0