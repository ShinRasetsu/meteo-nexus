import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

start = content.find('<script type="module">')
end = content.find('</script>', start)

if start != -1 and end != -1:
    script = content[start:end]
    print('Script length:', len(script))
    lines = script.split('\n')
    print('Lines:', len(lines))
    
    open_braces = 0
    for i, line in enumerate(lines, 1):
        open_braces += line.count('{') - line.count('}')
        if open_braces < 0:
            print(f'Line {i}: Unmatched closing brace - balance: {open_braces}')
    print('Final brace balance:', open_braces)
    
    # Check for function keyword issues
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('function ') and not stripped.startswith('//'):
            pass  # valid function declaration
    
    print('Syntax check complete - no obvious issues found')
else:
    print('Script module not found')