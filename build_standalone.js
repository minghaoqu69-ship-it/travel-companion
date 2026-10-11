// 将 web-desktop 的三个文件内联为单一 HTML（用于发布成免服务器直链）
// 用法：node build_standalone.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const dir = path.join(root, 'web-desktop');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

let out = html
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${css}\n</style>`)
  .replace('<script src="app.js"></script>', `<script>\n${js}\n</script>`);

const outPath = path.join(root, 'suixing-web.html');
fs.writeFileSync(outPath, out);
console.log('standalone written:', outPath, 'bytes =', out.length);
