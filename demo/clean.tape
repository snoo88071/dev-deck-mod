# The pane on the demo's own data: open sessions, History, Chapters.
#   vhs demo/clean.tape   (after demo/history.tape, logged in to the demo configuration)

Output demo/clean.gif

Set Shell "powershell"
Set FontSize 16
Set Width 1400
Set Height 820
Set Padding 16
Set TypingSpeed 40ms

Env DEVDECK_LANG "en"
Env COLORTERM "truecolor"
Env FORCE_COLOR "3"

Hide
# A clean start, without the markers of the session that runs VHS, in the demo's own configuration.
Type "Get-ChildItem Env: | Where-Object Name -like 'CLAUDE*' | ForEach-Object { Remove-Item ('Env:' + $_.Name) }; $env:CLAUDE_CONFIG_DIR = (Join-Path $HOME 'dev-deck-demo\.claude')"
Enter
Type "cd ~/dev-deck-demo/demo-shop; claude --plugin-dir C:/path/to/dev-deck-mod"
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

Type "/deck"
Sleep 1s
Enter
Sleep 5s

Type "2"
Sleep 5s

# The search field has the keyboard in History: back to the tabs, then Chapters.
Shift+Tab
Sleep 1s
Enter
Sleep 3s

# Down to the first message, and Enter: the conversation goes back to it.
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
