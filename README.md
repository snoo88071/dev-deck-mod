# dev-deck-mod

A Claude Code mod, inspired by [Dev Deck](https://github.com/snoo88071/dev-deck), that lives inside the
Claude Code CLI: your CLI sessions in a pane, what they run, and the past ones to resume.

Prototype. Windows only for now (it asks `tasklist` which sessions are alive).

## Try it

```
claude --plugin-dir C:/path/to/dev-deck-mod
```

then `/deck` at the prompt. Ctrl+X then X closes the pane, Esc gives the keyboard back to the prompt.

The pane draws in the terminal and in the Desktop app; the VS Code extension's chat panel runs mods
but draws nothing.

## Develop

```
claude plugin validate .
claude plugin test .
tsc -p .
```

`.claude-plugin/types/` is written by Claude Code each time it loads the mod from this folder.
Everything that calls `$` lives in `hooks/register.tsx` (the validator follows `$` only within one
file); `hooks/engine/` holds pure functions, tested on their own.
