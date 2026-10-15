# The README's GIF: Claude starts a dev server, the mod says it stays on, Claude tries again and the
# guard asks first; then the pane.
#   vhs demo/scene.tape   (after demo/history.tape, logged in to the demo configuration)
# While Claude thinks the recording is hidden: the GIF cuts from the prompt to the answer.

Output demo/dev-deck-mod.gif

Set Shell "powershell"
Set FontSize 16
Set Width 1400
Set Height 820
Set Padding 16
Set TypingSpeed 35ms

Env DEVDECK_LANG "en"
Env COLORTERM "truecolor"
Env FORCE_COLOR "3"

Hide
# A clean start, without the markers of the session that runs VHS, in the demo's own configuration.
Type "Get-ChildItem Env: | Where-Object Name -like 'CLAUDE*' | ForEach-Object { Remove-Item ('Env:' + $_.Name) }; $env:CLAUDE_CONFIG_DIR = (Join-Path $HOME 'dev-deck-demo\.claude')"
Enter
Type "$mod = (Get-Location).Path; cd ~/dev-deck-demo/demo-shop; claude --plugin-dir $mod"
Enter
Sleep 15s

# A short, silly chat first, so Chapters has something to show.
Type "What's the meaning of life? One sentence."
Enter
Sleep 25s
Type "Be honest: is it 42?"
Enter
Sleep 25s
Type "Can you say it as a haiku about dev servers?"
Enter
Sleep 30s
Type "Perfect. Ship it."
Enter
Sleep 20s
Show

# 1. Claude starts the dev server: it stays on, and the mod says so.
Type "Start the dev server in the background (npm run dev)."
Enter
Sleep 2s
Hide
Sleep 40s
Show
Sleep 5s

# 2. Claude tries again: the guard asks first. Enter picks "Reuse it".
Type "Run npm run dev once more, in the background."
Enter
Sleep 2s
Hide
Sleep 25s
Show
Sleep 4s
Enter
Sleep 2s
Hide
Sleep 25s
Show
Sleep 4s

# 3. The pane: what the session runs, the history, the chapters.
Type "/deck"
Sleep 1s
Enter
Sleep 5s
Type "2"
Sleep 4s
Shift+Tab
Sleep 1s
Enter
Sleep 3s
Tab
Sleep 1s
Enter
Sleep 4s

Hide
Escape
Ctrl+C
Sleep 1s
Ctrl+C
Sleep 2s
