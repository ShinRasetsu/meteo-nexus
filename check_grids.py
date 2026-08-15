import urllib.request
import re
try:
    resp = urllib.request.urlopen('https://shinrasetsu.github.io/meteo-nexus/')
    html = resp.read().decode()
    for match in re.finditer(r'class="[^"]*grid[^"]*"', html):
        context = html[max(0, match.start()-50):match.end()+50]
        print(f'--- Grid at {match.start()} ---')
        print(context)
        print('---')
except Exception as e:
    print(f'Error: {e}')