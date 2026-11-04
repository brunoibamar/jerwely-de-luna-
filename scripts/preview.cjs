// Vista local aislada. Nunca sirve respaldos, archivos ocultos ni pruebas.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.POS_PREVIEW_PORT || 48731);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let name;
    try { name = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
    if (name === '/') name = '/index.html';
    if (!/^\/(index\.html|(?:js|css|assets)\/[\w./ -]+)$/.test(name) || name.split('/').some(part => part.startsWith('.')) || !mime[path.extname(name)]) { res.writeHead(404).end(); return; }
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', mime[path.extname(name)]);
        res.setHeader('Cache-Control', 'no-store');
        // Las ventas de prueba no deben enviar correos ni notificaciones.
        res.setHeader('Content-Security-Policy', "connect-src 'self'");
        if (name === '/index.html') data = data.toString('utf8').replace('<body>', '<body><div style="position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#522c00;color:#fff;text-align:center;padding:6px;font:14px sans-serif">PRUEBA LOCAL · Datos separados del sitio publicado · Envíos externos desactivados</div>');
        res.end(data);
    });
}).listen(port, '127.0.0.1', () => console.log(`Vista de pruebas: http://127.0.0.1:${port}/`));
