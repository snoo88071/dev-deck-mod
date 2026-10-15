# A first take: does Claude Code, with the mod, draw well inside VHS on Windows?
#   vhs demo/test.tape   (from the repository's root)

Output demo/test.gif

Set Shell "powershell"
Set FontSize 16
Set Width 1400
Set Height 820
Set Padding 16
Set TypingSpeed 40ms

Env DEVDECK_LANG "en"
# ttyd's terminal draws 24-bit colour; Claude Code doesn't detect it there on its own.
Env COLORTERM "truecolor"
Env FORCE_COLOR "3"

Hide
# Started from inside a Claude Code session, the shell inherits its markers: a clean start without them.
Type "Get-ChildItem Env: | Where-Object Name -like 'CLAUDE*' | ForEach-Object { Remove-Item ('Env:' + $_.Name) }"
Enter
Type "cd C:/path/to/dev-deck-mod; claude --plugin-dir C:/path/to/dev-deck-mod"
Enter
Sleep 12s
Show

Type "/deck"
Sleep 1s
Enter
Sleep 6s

Type "2"
Sleep 5s

# The search field has the keyboard in History: back to the tabs, then Chapters.
Shift+Tab
Sleep 1s
Enter
Sleep 4s

Escape
Sleep 1s
Ctrl+C
Sleep 1s
Ctrl+C
Sleep 2s
