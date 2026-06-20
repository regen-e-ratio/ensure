# Ensure — DB client shortcuts + Zsh autocomplete.
#
# Source this from your ~/.zshrc (adjust the path if your checkout lives elsewhere):
#
#     export ENSURE_ROOT="$HOME/ensure"
#     source "$ENSURE_ROOT/scripts/db-clients.zsh"
#
# Then use the short commands from anywhere, with <Tab> completing the actions:
#
#     db-user -seed
#     db-user -get-id <Tab>        # completes the available actions
#     db-contact -create-contact dev-alice,email,friend@example.com
#     db-note -list
#     db-session -sweep
#
# Requires Zsh's completion system; most setups already run it. If <Tab> does
# nothing, add this once to ~/.zshrc *before* sourcing this file:
#     autoload -U compinit && compinit

: "${ENSURE_ROOT:=$HOME/ensure}"

# Run a server CLI npm script from the repo root, forwarding all args after `--`.
_ensure_db_run() {
  ( cd "$ENSURE_ROOT" && npm run "$1" --workspace server -- "${@:2}" )
}

db-user()    { _ensure_db_run db:user    "$@"; }
db-contact() { _ensure_db_run db:contact "$@"; }
db-note()    { _ensure_db_run db:note    "$@"; }
db-session() { _ensure_db_run db:session "$@"; }

# --- Completions: offer each script's actions as the first word. -------------
# Keep these lists in sync with the `switch (action)` blocks in server/src/cli/*.
_db_user_actions()    { compadd -- -list -get-id -create-user -delete-id -seed -h --help; }
_db_contact_actions() { compadd -- -list -get-id -create-contact -delete-id -seed -h --help; }
_db_note_actions()    { compadd -- -list -get-id -set-note -delete-id -seed -h --help; }
_db_session_actions() { compadd -- -list -get-id -delete-id -sweep -h --help; }

# Only complete the first argument (the action); the value args are free-form.
_db_user()    { [[ $CURRENT -eq 2 ]] && _db_user_actions; }
_db_contact() { [[ $CURRENT -eq 2 ]] && _db_contact_actions; }
_db_note()    { [[ $CURRENT -eq 2 ]] && _db_note_actions; }
_db_session() { [[ $CURRENT -eq 2 ]] && _db_session_actions; }

compdef _db_user db-user
compdef _db_contact db-contact
compdef _db_note db-note
compdef _db_session db-session
