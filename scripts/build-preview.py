"""Copy the shared browser module and create a dependency-free HTML deliverable."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
web = root / 'web'
core = (root / 'supabase/functions/_shared/nutrition.mjs').read_text()
(web / 'nutrition.mjs').write_text(core)
html = (web / 'index.html').read_text()
js = (web / 'app.js').read_text()
js = '\n'.join(line for line in js.splitlines() if not line.startswith('import '))
inline = '\n'.join(line.removeprefix('export ') for line in core.splitlines()) + '\n' + js
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + (web / 'style.css').read_text() + '\n</style>')
html = html.replace('<script type="module" src="app.js"></script>', '')
html = html.replace('</body>', '<script>\n' + inline.replace('</script', '<\\/script') + '\n</script>\n</body>')
(root / 'outputs').mkdir(exist_ok=True)
(root / 'outputs/pfct.html').write_text(html)
print('Updated web/nutrition.mjs and outputs/pfct.html')
