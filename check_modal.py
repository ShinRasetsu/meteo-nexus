with open(r'G:\PROJECT D\meteo-dashboard\index.html', encoding='utf-8') as f:
    lines = f.readlines()

print('=== ALL fuel-settings-modal REFERENCES ===')
for i, line in enumerate(lines):
    if 'fuel-settings-modal' in line:
        print(f'{i+1}: {line.rstrip()}')

print('\n=== MODAL STRUCTURE (449-600) ===')
for i in range(448, 600):
    if 'Aero' in lines[i]:
        print(f'{i+1}: {lines[i].strip()}')