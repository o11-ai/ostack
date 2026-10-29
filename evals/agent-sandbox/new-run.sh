#!/usr/bin/env bash
# Creates an isolated sandbox: its own HOME with ostack installed, mock tools on PATH, nothing reaching real people.
#   new-run.sh <name> [--from <existing run>] [--cwd <folder under HOME>]
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
OSTACK_SRC="$(cd "$H/../.." && pwd)"
RUNS="${OSTACK_EVAL_RUNS:-$H/runs}"
RUN="$1"; shift
FROM=""; CWD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$RUNS/$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
R="$RUNS/$RUN"; rm -rf "$R"; mkdir -p "$R/home/.claude" "$R/bin" "$R/mock"
cp "$H/fixtures/leads.csv" "$R/home/leads.csv"
for t in mail crm cal web scheduler; do printf '#!/usr/bin/env bash\nexec bun "%s/mock.ts" %s "$@"\n' "$H" "$t" > "$R/bin/$t"; done
printf '#!/usr/bin/env bash\nexec bun "%s/askuser.ts" "$@"\n' "$H" > "$R/bin/askuser"
# Stand-ins so nothing touches the machine's real crontab or starts a real agent.
printf '#!/usr/bin/env bash\nf="%s/mock/crontab"; if [ "$1" = "-l" ]; then [ -f "$f" ] && cat "$f" || exit 1; else cat > "$f"; fi\n' "$R" > "$R/bin/crontab"
for agent in claude codex; do printf '#!/usr/bin/env bash\necho "[%s stub] $*" >> "%s/mock/agent-runs.log"\n' "$agent" "$R" > "$R/bin/$agent"; done
# Every ostack call is logged with its output, for auditing the run afterwards.
cat > "$R/bin/ostack" <<EOS
#!/usr/bin/env bash
out=\$("$R/home/.local/bin/ostack" "\$@" 2>&1); code=\$?
printf '%s\n' "\$(jq -cn --arg a "\$*" --arg o "\$out" --argjson c \$code '{args:\$a,code:\$c,out:\$o}')" >> "$R/mock/ostack-calls.jsonl"
printf '%s\n' "\$out"; exit \$code
EOS
chmod +x "$R/bin/"*
cat > "$R/env.sh" <<EOS
export HOME="$R/home" MOCK_DIR="$R/mock" OSTACK_BIN_DIR="$R/home/.local/bin"
export PATH="$R/bin:$R/home/.local/bin:$(dirname "$(command -v bun)"):/usr/local/bin:/usr/bin:/bin"
cd "\$HOME/$CWD" 2>/dev/null || cd "\$HOME"
EOS
( source "$R/env.sh"; "$OSTACK_SRC/setup" >/dev/null )
if [ -n "$FROM" ]; then
  for ws in ostack gtm; do [ -d "$FROM/home/$ws" ] && cp -r "$FROM/home/$ws" "$R/home/"; done
  for f in "$FROM"/mock/*.json "$FROM"/mock/*.jsonl; do
    case "$(basename "$f")" in ostack-calls.jsonl|questions.jsonl|calls.jsonl) ;; *) [ -e "$f" ] && cp "$f" "$R/mock/" ;; esac
  done
fi
echo "$R"
