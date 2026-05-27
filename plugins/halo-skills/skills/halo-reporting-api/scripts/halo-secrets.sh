#!/usr/bin/env bash
# Cross-OS secret storage helper for Halo API credentials.
#
# Stores values in the OS-native secret store under namespace "halo-reporting-api"
# so credentials never touch shell history, env files committed to git, or world-
# readable files on disk.
#
# Backends:
#   macOS  -> `security` (Keychain)               built-in
#   Linux  -> `secret-tool` (libsecret)           apt install libsecret-tools / dnf install libsecret
#                                                  Requires a running keyring (GNOME Keyring / KWallet).
#   Windows-> see scripts/halo-secrets.ps1
#
# Usage:
#   halo-secrets.sh set <name>      # prompts securely for the value (no echo)
#   halo-secrets.sh get <name>      # prints value to stdout (no newline)
#   halo-secrets.sh delete <name>   # removes the secret

set -euo pipefail

NAMESPACE="halo-reporting-api"

cmd="${1:-}"
name="${2:-}"

if [ -z "$cmd" ] || [ -z "$name" ]; then
  echo "usage: $0 {set|get|delete} <name>" >&2
  exit 2
fi

# Accept only [a-zA-Z0-9_-] in the secret name so it's safe in vault paths.
case "$name" in
  *[!a-zA-Z0-9_-]*)
    echo "error: secret name must match [a-zA-Z0-9_-]+ (got: $name)" >&2
    exit 2
    ;;
esac

prompt_value() {
  local val
  if [ -t 0 ]; then
    printf 'Value for %s (input hidden): ' "$1" >&2
    IFS= read -rs val
    printf '\n' >&2
  else
    IFS= read -r val
  fi
  printf '%s' "$val"
}

os="$(uname -s)"
case "$os" in
  Darwin)
    label="${NAMESPACE}:${name}"
    case "$cmd" in
      set)
        val=$(prompt_value "$name")
        # -U updates if it already exists. Passing via -w means the value is
        # only ever in this process's argv on macOS, which is acceptable for
        # a user-owned single-user devbox.
        security add-generic-password \
          -a "$USER" -s "$label" -w "$val" -U >/dev/null
        unset val
        ;;
      get)
        security find-generic-password -a "$USER" -s "$label" -w
        ;;
      delete)
        security delete-generic-password -a "$USER" -s "$label" >/dev/null
        ;;
      *) echo "unknown command: $cmd" >&2; exit 2;;
    esac
    ;;

  Linux)
    if ! command -v secret-tool >/dev/null 2>&1; then
      cat >&2 <<'MSG'
error: `secret-tool` not found.
  Debian/Ubuntu: sudo apt install libsecret-tools
  Fedora/RHEL:   sudo dnf install libsecret
A running keyring daemon (GNOME Keyring or KWallet) is also required.
MSG
      exit 1
    fi
    case "$cmd" in
      set)
        # secret-tool reads the secret from stdin when not on a TTY, and
        # prompts via getpass when on a TTY. We always pipe to keep behavior
        # consistent across interactive and scripted use.
        val=$(prompt_value "$name")
        printf '%s' "$val" | secret-tool store \
          --label="${NAMESPACE} ${name}" \
          service "$NAMESPACE" account "$name"
        unset val
        ;;
      get)
        secret-tool lookup service "$NAMESPACE" account "$name"
        ;;
      delete)
        secret-tool clear service "$NAMESPACE" account "$name"
        ;;
      *) echo "unknown command: $cmd" >&2; exit 2;;
    esac
    ;;

  *)
    cat >&2 <<MSG
error: unsupported OS '$os' for this shell helper.
On Windows, use the PowerShell helper:
  pwsh ./scripts/halo-secrets.ps1 -Command set -Name $name
MSG
    exit 1
    ;;
esac
