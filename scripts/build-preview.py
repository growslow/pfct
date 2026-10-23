"""Copy the shared browser module and create a dependency-free HTML deliverable."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re

root = Path(__file__).resolve().parents[1]
web = root / 'web'
core = (root / 'supabase/functions/_shared/nutrition.mjs').read_text()
(web / 'nutrition.mjs').write_text(core)
(root / 'outputs').mkdir(exist_ok=True)
auth = (web / 'auth.mjs').read_text()
for page, script in [('index','app'),('login','login'),('admin','admin')]:
    html = (web / (page + '.html')).read_text()
    js = '\n'.join(line for line in (web / (script + '.js')).read_text().splitlines() if not line.startswith('import '))
    modules = (core + '\n' if page == 'index' else '') + auth
    if page == 'login':
        modules += '\n' + (web / 'public-config.mjs').read_text()
    if page == 'admin':
        modules += '\n' + '\n'.join(line for line in (web / 'admin-photos.mjs').read_text().splitlines() if not line.startswith('import '))
    inline = '\n'.join(line.removeprefix('export ') for line in modules.splitlines()) + '\n' + js
    html = re.sub(r'<link rel="stylesheet" href="style\.css(?:\?[^\"]*)?">', lambda _: '<style>\n' + (web / 'style.css').read_text() + '\n</style>', html)
    html = re.sub(r'<script type="module" src="' + re.escape(script) + r'\.js(?:\?[^\"]*)?"></script>', '', html)
    html = html.replace('</body>', '<script type="module">\n' + inline.replace('</script', '<\\/script') + '\n</script>\n</body>')
    (root / 'outputs' / (page + '.html')).write_text(html)
(root / 'outputs/pfct.html').write_text((root / 'outputs/login.html').read_text())
with ZipFile(root / 'outputs/pfct-preview.zip','w',ZIP_DEFLATED) as archive:
    for page in ['login','index','admin']:
        archive.write(root / 'outputs' / (page+'.html'),page+'.html')
print('Updated shared browser module and three-page HTML preview bundle.')
