#!/usr/bin/env bash
#
# Run one native measurement card on the one permitted device.
#
# There are three cards in `examples/lynx-for-native`, each logging one prefixed
# line per stage, and this is the single runner for all of them:
#
#   card          bundle                        console prefix
#   smoke         main.lynx.bundle              [solid-lynx parity]
#   stylesheet    stylesheet-probe.lynx.bundle  [solid-lynx ss]
#   list          list-probe.lynx.bundle        [solid-lynx lp]
#
# The bundle stem is accepted as an alias, so `smoke` == `main`,
# `stylesheet` == `stylesheet-probe`, and `list` == `list-probe`.
#
# It builds with `pnpm native:build`, serves `dist` on loopback, opens the bundle
# through Lynx Explorer's deep link, captures logcat and a screenshot, prints the
# lines for the chosen card, then puts back exactly what it changed.
#
# Pinned to the Galaxy A03 (`R9WT911JVVH`). The tablet `19779010` is in use by
# another agent, so this script never enumerates devices and never addresses one
# it was not told to address; every adb call carries `-s R9WT911JVVH`.
#
# Usage:
#   examples/lynx-for-native/scripts/run-native-probe.sh <card>
#   examples/lynx-for-native/scripts/run-native-probe.sh <card> --dry-run
#   examples/lynx-for-native/scripts/run-native-probe.sh --help
#
# Environment overrides:
#   LOOPBACK_PORT   port for the local HTTP server and the adb reverse (8099)
#   LOG_DIR         where logcat, screenshot and the server pid file go
#                   (/tmp/solid-lynx-logs)
#   WAIT_SECONDS    how long to let the card render before capture (8)
#
# Exit codes:
#   0  the card's lines were captured (or --dry-run finished)
#   2  an unknown card or argument, or a serial variable named another device
#   3  the device is not attached and ready
#   4  the build or the local server did not come up, or the bundle is missing
#   5  the run captured no line for the chosen card
#
# The captures are evidence to read, not a verdict: this script does not parse
# the stages, and a run that captures nothing exits 5. It never reports a result
# it did not see.

set -euo pipefail

# Read the raw environment before this script assigns anything, so an inherited
# DEVICE_SERIAL can be caught rather than silently overwritten below.
readonly ENV_DEVICE_SERIAL="${DEVICE_SERIAL-}"

# The only device this repository's native work may target.
readonly PERMITTED_SERIAL="R9WT911JVVH"
DEVICE_SERIAL="${PERMITTED_SERIAL}"
readonly DEVICE_SERIAL

LOOPBACK_PORT="${LOOPBACK_PORT:-8099}"
LOG_DIR="${LOG_DIR:-/tmp/solid-lynx-logs}"
WAIT_SECONDS="${WAIT_SECONDS:-8}"

CARD=""
BUNDLE_NAME=""
BUNDLE_STEM=""
LOG_PREFIX=""
CARD_TITLE=""

DRY_RUN=0
SERVER_PID=""
PID_FILE=""
REVERSE_ADDED=0
DEVICE_READY=0

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
readonly SCRIPT_DIR REPO_ROOT
readonly DIST_DIR="${REPO_ROOT}/examples/lynx-for-native/dist"

ADB="${ADB:-adb}"
readonly ADB

usage() {
  # The header comment block, minus the shebang line, is the usage text.
  awk 'NR > 2 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

log() {
  printf '%s\n' "$*"
}

# Prints a command line, and runs it unless this is a dry run.
run_cmd() {
  printf '  $ %s\n' "$*"
  if (( DRY_RUN )); then
    return 0
  fi
  "$@"
}

fail() {
  local code="$1"
  shift
  printf 'error: %s\n' "$*" >&2
  exit "$code"
}

# Maps a card name or a bundle stem to the card, and fails loudly on anything
# else. A typo must not silently run a different card.
select_card() {
  local requested="$1"
  local name="${requested,,}"
  case "${name}" in
    smoke|main)
      CARD="smoke" ;;
    stylesheet|stylesheet-probe)
      CARD="stylesheet" ;;
    list|list-probe)
      CARD="list" ;;
    *)
      usage >&2
      fail 2 "unknown card: ${requested}. Expected one of smoke, stylesheet," \
        "list (or the bundle stems main, stylesheet-probe, list-probe)." ;;
  esac

  case "${CARD}" in
    smoke)
      CARD_TITLE="parity smoke"
      BUNDLE_STEM="main"
      BUNDLE_NAME="main.lynx.bundle"
      LOG_PREFIX="[solid-lynx parity]" ;;
    stylesheet)
      CARD_TITLE="native stylesheet probe"
      BUNDLE_STEM="stylesheet-probe"
      BUNDLE_NAME="stylesheet-probe.lynx.bundle"
      LOG_PREFIX="[solid-lynx ss]" ;;
    list)
      CARD_TITLE="native list probe"
      BUNDLE_STEM="list-probe"
      BUNDLE_NAME="list-probe.lynx.bundle"
      LOG_PREFIX="[solid-lynx lp]" ;;
  esac
}

bundle_path() {
  printf '%s/%s\n' "${DIST_DIR}" "${BUNDLE_NAME}"
}

# Refuses any run that was pointed at a different device. `adb` also honours
# ANDROID_SERIAL, so overriding that would silently retarget every call below,
# and an inherited DEVICE_SERIAL would otherwise be discarded without a word.
assert_serial() {
  local name value
  for name in ADB_SERIAL ANDROID_SERIAL; do
    value="${!name-}"
    if [[ -n "${value}" && "${value}" != "${PERMITTED_SERIAL}" ]]; then
      fail 2 "${name}=${value} is not permitted. This script targets only" \
        "${PERMITTED_SERIAL}; unset ${name} to run it."
    fi
  done
  if [[ -n "${ENV_DEVICE_SERIAL}" && "${ENV_DEVICE_SERIAL}" != "${PERMITTED_SERIAL}" ]]; then
    fail 2 "DEVICE_SERIAL=${ENV_DEVICE_SERIAL} is not permitted. This script targets" \
      "only ${PERMITTED_SERIAL}, which is not configurable; unset DEVICE_SERIAL to run it."
  fi
}

# Reads the device state and changes nothing on it.
check_device() {
  if (( DRY_RUN )); then
    printf '  $ %s -s %s get-state\n' "${ADB}" "${DEVICE_SERIAL}"
    DEVICE_READY=1
    return 0
  fi

  local state
  state="$("${ADB}" -s "${DEVICE_SERIAL}" get-state 2>&1 || true)"
  if [[ "${state}" != "device" ]]; then
    fail 3 "device ${DEVICE_SERIAL} is not ready (get-state: ${state:-no answer})." \
      "Attach the A03 over USB and enable USB debugging. Nothing was changed."
  fi
  DEVICE_READY=1
  log "device ${DEVICE_SERIAL}: ${state}"
}

build_bundle() {
  log "==> build"
  # Subshell so the `cd` cannot leak into the rest of the script.
  if (( DRY_RUN )); then
    printf '  $ cd %s && pnpm native:build\n' "${REPO_ROOT}"
  else
    ( cd "${REPO_ROOT}" && pnpm native:build )
  fi

  local path
  path="$(bundle_path)"

  if (( DRY_RUN )); then
    printf '  (check) test -f %s\n' "${path}"
    return 0
  fi

  # A runner that serves a bundle directory without the asked-for card in it
  # would open Explorer on a 404 and capture an empty log, which reads like a
  # measurement that found nothing. Stop instead.
  if [[ ! -f "${path}" ]]; then
    fail 4 "${path} was not produced by pnpm native:build." \
      "examples/lynx-for-native/lynx.config.ts must declare \"${BUNDLE_STEM}\"" \
      "in source.entry and in pluginVanillaLynx's entries, or this card is not" \
      "part of this build."
  fi
  log "built ${path}"
}

start_server() {
  log "==> serve ${DIST_DIR} on 127.0.0.1:${LOOPBACK_PORT}"

  if (( DRY_RUN )); then
    printf '  $ python3 -m http.server %s --bind 127.0.0.1 --directory %s &\n' \
      "${LOOPBACK_PORT}" "${DIST_DIR}"
    printf '  (pid written to) %s\n' "${PID_FILE}"
    return 0
  fi

  mkdir -p "${LOG_DIR}"

  # Only ever the server this script started: the pid is written here and the
  # trap kills that pid alone.
  python3 -m http.server "${LOOPBACK_PORT}" --bind 127.0.0.1 \
    --directory "${DIST_DIR}" >"${LOG_DIR}/http-server-${CARD}.log" 2>&1 &
  SERVER_PID="$!"
  printf '%s\n' "${SERVER_PID}" >"${PID_FILE}"

  local attempt=0
  while (( attempt < 100 )); do
    attempt=$(( attempt + 1 ))
    if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
      fail 4 "the local server exited immediately; see" \
        "${LOG_DIR}/http-server-${CARD}.log (a port already in use on" \
        "${LOOPBACK_PORT} looks like this)."
    fi
    if curl -fsS -o /dev/null 2>/dev/null "http://127.0.0.1:${LOOPBACK_PORT}/${BUNDLE_NAME}"; then
      log "server pid ${SERVER_PID} is serving ${BUNDLE_NAME}"
      return 0
    fi
    sleep 0.1
  done

  fail 4 "the local server never served ${BUNDLE_NAME} on port ${LOOPBACK_PORT}"
}

setup_reverse() {
  log "==> adb reverse tcp:${LOOPBACK_PORT}"
  if (( DRY_RUN )); then
    printf '  $ %s -s %s reverse tcp:%s tcp:%s\n' \
      "${ADB}" "${DEVICE_SERIAL}" "${LOOPBACK_PORT}" "${LOOPBACK_PORT}"
    return 0
  fi
  # Marked before the call so a half-completed setup is still cleaned up.
  REVERSE_ADDED=1
  "${ADB}" -s "${DEVICE_SERIAL}" reverse "tcp:${LOOPBACK_PORT}" "tcp:${LOOPBACK_PORT}"
}

open_card() {
  # A fresh value per run, so Explorer cannot serve a cached bundle.
  local cache_bust
  cache_bust="$(date +%s)"
  local url="http://127.0.0.1:${LOOPBACK_PORT}/${BUNDLE_NAME}?v=${cache_bust}"

  log "==> open ${url}"
  run_cmd "${ADB}" -s "${DEVICE_SERIAL}" shell am start \
    -a android.intent.action.VIEW \
    -d "lynx://open?url=${url}" \
    -p com.lynx.explorer
}

capture() {
  local stamp
  stamp="$(date +%Y%m%dT%H%M%S)"
  local logcat_file="${LOG_DIR}/lynx_console-${CARD}-${stamp}.log"
  local png_file="${LOG_DIR}/${BUNDLE_STEM}-${stamp}.png"

  log "==> wait ${WAIT_SECONDS}s, then capture"
  if (( DRY_RUN )); then
    printf '  $ sleep %s\n' "${WAIT_SECONDS}"
    printf '  $ %s -s %s logcat -d -s lynx_console > %s\n' \
      "${ADB}" "${DEVICE_SERIAL}" "${logcat_file}"
    printf '  $ %s -s %s exec-out screencap -p > %s\n' \
      "${ADB}" "${DEVICE_SERIAL}" "${png_file}"
    printf '  $ grep -aF -- %s %s\n' "'${LOG_PREFIX}'" "${logcat_file}"
    printf '  (expect) at least one line matching %s, then exit 0\n' "${LOG_PREFIX}"
    printf '  (otherwise) exit 5, pointing at the log and the screenshot\n'
    return 0
  fi

  sleep "${WAIT_SECONDS}"

  "${ADB}" -s "${DEVICE_SERIAL}" logcat -d -s lynx_console >"${logcat_file}" 2>&1 || true
  if ! "${ADB}" -s "${DEVICE_SERIAL}" exec-out screencap -p >"${png_file}" 2>/dev/null; then
    rm -f "${png_file}"
    log "warning: screencap failed; the logcat capture is still usable"
  fi

  log "logcat:     ${logcat_file}"
  if [[ -s "${png_file}" ]]; then
    log "screenshot: ${png_file}"
  fi

  log "==> ${LOG_PREFIX} lines"
  local lines
  lines="$(grep -aF -- "${LOG_PREFIX}" "${logcat_file}" || true)"
  if [[ -z "${lines}" ]]; then
    fail 5 "no ${LOG_PREFIX} line was captured for the ${CARD} card." \
      "The card did not log, or Explorer did not load ${BUNDLE_NAME}." \
      "Read ${logcat_file} and the screenshot in ${LOG_DIR} before treating" \
      "this as a result. Nothing is reported from this run."
  fi
  printf '%s\n' "${lines}"
  log "lines captured: $(grep -acF -- "${LOG_PREFIX}" "${logcat_file}" || true)"
}

# Kills only the server this run started and removes only the reverse this run
# added, then shows what is left so the next run starts from a known state.
cleanup() {
  local status=$?
  set +e

  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null
    wait "${SERVER_PID}" 2>/dev/null
  fi
  if [[ -n "${PID_FILE}" ]]; then
    rm -f "${PID_FILE}"
  fi

  if (( REVERSE_ADDED )) && (( DRY_RUN == 0 )); then
    "${ADB}" -s "${DEVICE_SERIAL}" reverse --remove "tcp:${LOOPBACK_PORT}" >/dev/null 2>&1
  fi

  log "==> adb reverse --list"
  # Skipped when the device was never ready: there is no reverse table to read,
  # and the adb error would bury the real reason this run stopped.
  if (( DEVICE_READY )); then
    run_cmd "${ADB}" -s "${DEVICE_SERIAL}" reverse --list
  else
    log "(not read: the device was never confirmed ready)"
  fi

  exit "${status}"
}

main() {
  local arg positional=0
  for arg in "$@"; do
    case "${arg}" in
      --dry-run) DRY_RUN=1 ;;
      -h|--help) usage; exit 0 ;;
      -*) usage >&2; fail 2 "unknown argument: ${arg}" ;;
      *)
        if (( positional )); then
          usage >&2
          fail 2 "only one card may be given, got a second: ${arg}"
        fi
        positional=1
        select_card "${arg}"
        ;;
    esac
  done

  if (( positional == 0 )); then
    usage >&2
    fail 2 "no card given. Expected one of smoke, stylesheet, list."
  fi

  assert_serial

  # The stylesheet card points __LoadStyleSheet at a fixed probe.css URL on
  # 8099, so a moved port would fail that one stage rather than the run.
  if [[ "${CARD}" == "stylesheet" && "${LOOPBACK_PORT}" != "8099" ]]; then
    log "warning: the stylesheet card loads http://127.0.0.1:8099/probe.css, so" \
      "with LOOPBACK_PORT=${LOOPBACK_PORT} its load-real-url stage cannot succeed."
    log ""
  fi

  if (( DRY_RUN )); then
    log "dry run: no build, no server, no device calls. The commands below are"
    log "exactly what a real run executes, in order."
    log ""
  fi

  PID_FILE="${LOG_DIR}/http-server-${CARD}-${LOOPBACK_PORT}.pid"
  trap cleanup EXIT

  log "card:   ${CARD} (${CARD_TITLE})"
  log "bundle: ${BUNDLE_NAME}"
  log "prefix: ${LOG_PREFIX}"
  log "repo:   ${REPO_ROOT}"
  log "device: ${DEVICE_SERIAL}"
  log "port:   ${LOOPBACK_PORT}"
  log "logs:   ${LOG_DIR}"
  log ""

  check_device
  build_bundle
  start_server
  setup_reverse
  open_card
  capture

  log "==> done"
}

main "$@"
