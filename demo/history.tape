# Fills the demo's History: three short CLI sessions in the demo folders, none of it recorded.
#   vhs demo/history.tape   (once, after logging in to the demo configuration)

Output demo/.history.gif

Set Shell "powershell"
Set Width 1200
Set Height 700
Set TypingSpeed 20ms

Env COLORTERM "truecolor"
Env FORCE_COLOR "3"

Hide
# A clean start, without the markers of the session that runs VHS, in the demo's own configuration.
Type "Get-ChildItem Env: | Where-Object Name -like 'CLAUDE*' | ForEach-Object { Remove-Item ('Env:' + $_.Name) }; $env:CLAUDE_CONFIG_DIR = (Join-Path $HOME 'dev-deck-demo\.claude')"
Enter

Type "cd ~/dev-deck-demo/demo-shop; claude"
Enter
Sleep 12s
Type "In one sentence: what does this project do?"
Enter
Sleep 35s
Type "/exit"
Enter
Sleep 5s

Type "cd ~/dev-deck-demo/demo-blog; claude"
Enter
Sleep 18s
# The first visit to a folder asks to trust it, "No, exit" first: down to "Yes", then Enter.
Down
Enter
Sleep 6s
Type "Suggest a better title for the first post. Just the title."
Enter
Sleep 35s
Type "/exit"
Enter
Sleep 5s

Type "cd ~/dev-deck-demo/demo-shop; claude"
Enter
Sleep 12s
Type "Which port does npm run dev use? One line."
Enter
Sleep 35s
Type "/exit"
Enter
Sleep 5s
