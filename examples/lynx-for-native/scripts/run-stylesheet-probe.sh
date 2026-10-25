#!/usr/bin/env bash
#
# The stylesheet card's runner, kept so older docs and muscle memory still work.
#
# This is a thin wrapper: it execs `run-native-probe.sh stylesheet`, which is the
# one runner for all three native cards (smoke, stylesheet, list). Every argument
# is passed through, so `--dry-run` and `--help` behave exactly as they do there.
#
# Usage:
#   examples/lynx-for-native/scripts/run-stylesheet-probe.sh
#   examples/lynx-for-native/scripts/run-stylesheet-probe.sh --dry-run
#
# For the other cards, call the general script directly:
#   examples/lynx-for-native/scripts/run-native-probe.sh smoke
#   examples/lynx-for-native/scripts/run-native-probe.sh list
#
# See run-native-probe.sh for the device rule, the pins, and the exit codes.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

exec "${SCRIPT_DIR}/run-native-probe.sh" stylesheet "$@"
