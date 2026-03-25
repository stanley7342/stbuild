// Runs under system Node.js (not Electron) to avoid native ABI mismatch.
'use strict';
const path = require('path');
// Resolve serialport from the extension's node_modules
const extDir = process.argv[2];
const { SerialPort } = require(path.join(extDir, 'node_modules', 'serialport'));

let port = null;

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) { continue; }
        try { handle(JSON.parse(line)); } catch { /* ignore bad JSON */ }
    }
});

async function handle(msg) {
    switch (msg.cmd) {
        case 'list': {
            try {
                const ports = await SerialPort.list();
                send({ type: 'portList', ports: ports.map(p => ({ path: p.path, manufacturer: p.manufacturer ?? '' })) });
            } catch (e) {
                send({ type: 'portList', ports: [] });
            }
            break;
        }
        case 'open': {
            if (port) { try { port.close(); } catch { /* ignore */ } port = null; }
            port = new SerialPort({ path: msg.path, baudRate: msg.baudRate, autoOpen: false });
            port.open(err => {
                if (err) { send({ type: 'error', message: err.message }); return; }
                send({ type: 'connected', port: msg.path, baudRate: msg.baudRate });
            });
            port.on('data', data => send({ type: 'data', text: Buffer.from(data).toString('binary') }));
            port.on('error', err => send({ type: 'error', message: err.message }));
            port.on('close', () => { port = null; send({ type: 'disconnected' }); });
            break;
        }
        case 'close': {
            if (port) { port.close(); }
            break;
        }
        case 'write': {
            if (port) { port.write(msg.data); }
            break;
        }
    }
}

process.on('exit', () => { try { if (port) { port.close(); } } catch { /* ignore */ } });
