import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => readFile(path.join(root, name), 'utf8');
const jsURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const imports = {};
imports['three/core'] = jsURL(await read('vendor/three.core.min.js'));
imports.three = jsURL((await read('vendor/three.module.min.js')).replaceAll('./three.core.min.js', 'three/core'));
for (const [name, file] of [['bookstore', 'bookstore.js'], ['seasons', 'seasons.js'], ['visitors', 'visitors.js'], ['stats', 'stats.js'], ['bookstore-runtime', 'main.js']]) {
  const source = (await read('src/' + file)).replaceAll('../vendor/three.module.min.js', 'three').replaceAll('./bookstore.js', 'bookstore').replaceAll('./seasons.js', 'seasons').replaceAll('./visitors.js', 'visitors').replaceAll('./stats.js', 'stats');
  imports[name] = jsURL(source);
}
const font = 'data:font/woff2;base64,' + (await readFile(path.join(root, 'assets/anton-latin.woff2'))).toString('base64');
const style = (await read('src/style.css')).replace('INLINE_FONT', font);
const logo = 'data:image/png;base64,' + (await readFile(path.resolve(root, '../../brand-assets/springhues-logo.png'))).toString('base64');
const notices = (await read('THIRD-PARTY-NOTICES.txt')).replaceAll('</script', '<\\/script');
const html = (await read('src/template.html')).replace('/* INLINE_STYLE */', style).replace('INLINE_LOGO', logo).replace('/* IMPORT_MAP */', JSON.stringify({ imports })).replace('</head>', '<script type="text/plain" id="third-party-notices">' + notices + '</script>\n</head>');
await writeFile(path.join(root, 'index.html'), html, 'utf8');
console.log('Built bookstore index.html · ' + (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB · model embedded, real public statistics');
