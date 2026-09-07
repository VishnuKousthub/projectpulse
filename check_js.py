with open("static/js/app.js", "r", encoding="utf-8") as f:
    text = f.read()

mode_stack = ['code'] # 'code', 'single', 'double', 'template'
brace_stack = []
i = 0
line_no = 1
n = len(text)

while i < n:
    ch = text[i]
    if ch == "\n":
        line_no += 1
    
    current_mode = mode_stack[-1]

    if current_mode == 'code':
        if ch == '/' and i + 1 < n and text[i+1] == '/':
            # line comment
            i += 2
            while i < n and text[i] != '\n':
                i += 1
            continue
        if ch == '/' and i + 1 < n and text[i+1] == '*':
            # block comment
            i += 2
            while i + 1 < n and not (text[i] == '*' and text[i+1] == '/'):
                if text[i] == '\n':
                    line_no += 1
                i += 1
            i += 2
            continue
        if ch == '"':
            mode_stack.append('double')
        elif ch == "'":
            mode_stack.append('single')
        elif ch == '`':
            mode_stack.append('template')
        elif ch in ('{', '(', '['):
            brace_stack.append((ch, line_no))
        elif ch in ('}', ')', ']'):
            if not brace_stack:
                print(f"Extra closing {ch} at line {line_no}")
            else:
                top, l = brace_stack.pop()
                if top == '${' and ch == '}':
                    # finished interpolation inside template
                    if mode_stack and mode_stack[-1] == 'code':
                        mode_stack.pop() # return to 'template' mode
                else:
                    match = {'{': '}', '(': ')', '[': ']'}.get(top)
                    if match != ch:
                        print(f"Mismatched {top} (line {l}) closed by {ch} (line {line_no})")
        i += 1
    elif current_mode == 'single':
        if ch == '\\':
            i += 2
            continue
        if ch == "'":
            mode_stack.pop()
        i += 1
    elif current_mode == 'double':
        if ch == '\\':
            i += 2
            continue
        if ch == '"':
            mode_stack.pop()
        i += 1
    elif current_mode == 'template':
        if ch == '\\':
            i += 2
            continue
        if ch == '`':
            mode_stack.pop()
            i += 1
            continue
        if ch == '$' and i + 1 < n and text[i+1] == '{':
            mode_stack.append('code')
            brace_stack.append(('${', line_no))
            i += 2
            continue
        i += 1

print(f"Check Complete!")
print(f"Unclosed Braces: {len(brace_stack)}")
for b in brace_stack:
    print(f"  Unclosed {b[0]} from line {b[1]}")
print(f"Unclosed String Modes: {mode_stack}")


