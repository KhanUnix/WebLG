import http from 'node:http';
import path from 'node:path';
import { stat, readFile } from 'node:fs/promises';

const rootDir = process.cwd();
const defaultPort = 4000;
const cliPort = Number.parseInt(process.argv[2] ?? '', 10);
const envPort = Number.parseInt(process.env.PORT ?? '', 10);
const port = Number.isInteger(cliPort)
    ? cliPort
    : (Number.isInteger(envPort) ? envPort : defaultPort);
const host = process.env.HOST ?? '127.0.0.1';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
};

function toAbsolutePath(pathname) {
    return path.resolve(rootDir, '.' + pathname);
}

function isInsideRoot(filePath) {
    const rel = path.relative(rootDir, filePath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function contentType(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost');
        const pathname = decodeURIComponent(requestUrl.pathname);

        if (pathname === '/') {
            res.writeHead(302, { Location: '/demo/' });
            res.end();
            return;
        }

        let filePath = toAbsolutePath(pathname);
        if (!isInsideRoot(filePath)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
        }

        let fileInfo = await stat(filePath);
        if (fileInfo.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            fileInfo = await stat(filePath);
        }

        if (!fileInfo.isFile()) {
            throw new Error('Not a file');
        }

        const payload = await readFile(filePath);
        res.writeHead(200, {
            'Content-Type': contentType(filePath),
            'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        res.end(payload);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
    }
});

server.on('error', (error) => {
    console.error('Failed to start demo server:', error.message);
    process.exitCode = 1;
});

server.listen(port, host, () => {
    console.log(`WebLG demo server running at http://${host}:${port}/demo/`);
});
