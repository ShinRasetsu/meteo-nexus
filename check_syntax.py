import re

with open(r'G:\PROJECT D\meteo-dashboard\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find script content
script_start = content.find('<script type="module">')
if script_start == -1:
    script_start = content.find("<script type='module'>")
script_end = content.find('</script>', script_start)
script = content[script_start:script_end]

# Basic syntax checks
open_braces = script.count('{')
close_braces = script.count('}')
open_parens = script.count('(')
close_parens = script.count(')')
open_brackets = script.count('[')
close_brackets = script.count(']')

print(f'Braces: {open_braces} open, {close_braces} close, balanced: {open_braces == close_braces}')
print(f'Parens: {open_parens} open, {close_parens} close, balanced: {open_parens == close_parens}')
print(f'Brackets: {open_brackets} open, {close_brackets} close, balanced: {open_brackets == close_brackets}')

# Check for common issues
issues = []
if 'historyIdxIdx' in script:
    issues.append('Found historyIdxIdx typo')
if 'smoothedPitch' in script or 'smoothedRoll' in script:
    issues.append('Found removed horizon variables')
if '_el.horizon' in script:
    issues.append('Found removed horizon element reference')
if 'horizonTrans' in script:
    issues.append('Found removed horizon cache reference')

if issues:
    print('ISSUES FOUND:', issues)
else:
    print('No obvious issues found')