with open("static/js/app.js", "r", encoding="utf-8") as f:
    text = f.read()

in_str = None
in_comment = False
in_line_comment = False
in_template = False
brace_stack = []

i = 0
line_no = 1
while i < len(text):
    ch = text[i]
    if ch == "\n":
        line_no += 1
        in_line_comment = False
    
    if in_line_comment:
        i += 1
        continue
    if in_comment:
        if ch == "*" and i + 1 < len(text) and text[i+1] == "/":
            in_comment = False
            i += 2
            continue
        i += 1
        continue
    
    if in_str:
        if ch == "\\":
            i += 2
            continue
        if ch == in_str:
            in_str = None
        i += 1
        continue

    if in_template:
        if ch == "\\":
            i += 2
            continue
        if ch == "`":
            in_template = False
            i += 1
            continue
        if ch == "$" and i + 1 < len(text) and text[i+1] == "{":
            brace_stack.append(("${", line_no))
            i += 2
            continue
        if brace_stack and brace_stack[-1][0] == "${":
            if ch == "{":
                brace_stack.append(("{", line_no))
            elif ch == "}":
                brace_stack.pop()
        i += 1
        continue

    if ch == "/" and i + 1 < len(text) and text[i+1] == "/":
        in_line_comment = True
        i += 2
        continue
    if ch == "/" and i + 1 < len(text) and text[i+1] == "*":
        in_comment = True
        i += 2
        continue
    if ch in ('"', "'"):
        in_str = ch
        i += 1
        continue
    if ch == "`":
        in_template = True
        i += 1
        continue
    if ch == "{":
        brace_stack.append(("{", line_no))
    elif ch == "}":
        if brace_stack:
            popped = brace_stack.pop()
        else:
            print(f"Extra closing brace at line {line_no}")
    i += 1

print("Remaining unclosed braces:", brace_stack)
