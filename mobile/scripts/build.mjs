import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = path.resolve(root, '../web');
const out = path.join(root, 'www');
await mkdir(out, { recursive: true });
// Explicit allowlist prevents broker credentials and recovery artifacts entering the APK.
for (const file of ['index.html', 'style.css', 'script.js', 'telemetry-gauges.js', 'connection.js', 'app-ui.js', 'app-ui.css', 'mqtt.min.js', 'echarts.min.js']) {
  await cp(path.join(web, file), path.join(out, file));
}
let html = await readFile(path.join(out, 'index.html'), 'utf8');
html = html.replace(/\s*<link[^>]*https:\/\/fonts\.[^>]+>/g, '')
  .replace(/\s*<script>if \(!window\.(?:echarts|mqtt)\)[\s\S]*?<\/script>/g, '')
  .replace('<head>', '<head>\n  <script>document.documentElement.classList.add("native-app");</script>\n  <link rel="stylesheet" href="fonts.css">')
  .replace('</body>', '  <script src="native.js"></script>\n</body>');
await writeFile(path.join(out, 'index.html'), html);
const css = (await readFile(path.join(out, 'style.css'), 'utf8')).replace(/@import url\('https:\/\/fonts[^\n]+\n/g, '');
await writeFile(path.join(out, 'style.css'), css);
let fonts = '';
for (const font of ['inter', 'space-grotesk']) {
  const source = path.join(root, 'node_modules/@fontsource', font);
  await cp(path.join(source, 'LICENSE'), path.join(out, `${font}-LICENSE.txt`));
  for (const weight of [400, 600, 700, ...(font === 'inter' ? [800, 900] : [])]) {
    for (const subset of ['latin', 'latin-ext', 'vietnamese']) {
      const content = await readFile(path.join(source, `${subset}-${weight}.css`), 'utf8');
      fonts += content.replaceAll('./files/', './fonts/');
      for (const match of content.matchAll(/\.\/files\/([^')]+)/g)) {
        await mkdir(path.join(out, 'fonts'), { recursive: true });
        await cp(path.join(source, 'files', match[1]), path.join(out, 'fonts', match[1]));
      }
    }
  }
}
await writeFile(path.join(out, 'fonts.css'), fonts);
await build({ entryPoints: [path.join(root, 'src/native.js')], bundle: true, outfile: path.join(out, 'native.js'), target: 'chrome89', format: 'iife' });
console.log('MiniCNC: shared web + local fonts + native lifecycle built into www/');
