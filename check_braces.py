with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

start = content.find('<script type="module">')
end = content.find('</script>', start)

if start != -1 and end != -1:
    script = content[start:end]
    lines = script.split('\n')
    
    open_braces = 0
    for i, line in enumerate(lines, 1):
        before = open_braces
        open_braces += line.count('{') - line.count('}')
        if open_braces < 0:
            print(f'Line {i}: Unmatched closing brace - balance: {open_braces}')
        if before != open_braces and line.count('{') > 0:
            print(f'Line {i}: +{line.count("{")} braces -> balance: {open_braces} | {line.strip()[:80]}')
    print(f'Final balance: {open_braces}')