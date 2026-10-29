#!/usr/bin/env bash
# Prints the prompt for a test agent: the sandbox rules, then the user's message.
#   prompt.sh <run> "<message>"
H="$(cd "$(dirname "$0")" && pwd)"; R="${OSTACK_EVAL_RUNS:-$H/runs}/$1"
sed "s#__R__#$R#g" "$H/preamble.md"
printf '\nSam'"'"'s message to you:\n\n"%s"\n' "$2"
