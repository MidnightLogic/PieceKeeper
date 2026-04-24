/** 
* Copyright 2026 Craig Bailey
* Repository: https://github.com/MidnightLogic/PieceKeeper
*
* Licensed under the Apache License, Version 2.0
* SPDX-License-Identifier: Apache-2.0
*/

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const file = path.join(__dirname, '../../dist', 'index.html');

console.log("Analyzing deployment footprint for cryptographic hashing...");

if (!fs.existsSync(file)) {
    console.error(`Error: Could not find ${file}`);
    process.exit(1);
}

let html = fs.readFileSync(file, 'utf8');

// Function to generate SHA-256 hashes for regex matches
function extractHashes(regex, logLabel) {
    const hashes = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        const content = match[1];
        if (content && content.trim() !== '') {
            const normalizedContent = content.replace(/\r\n/g, '\n');
            const hash = crypto.createHash('sha256').update(normalizedContent, 'utf8').digest('base64');
            const cspHash = `'sha256-${hash}'`;
            hashes.push(cspHash);
            console.log(`Generated ${logLabel} hash: ${cspHash}`);
        }
    }
    return hashes;
}

// Extract and hash scripts
const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
const scriptHashes = extractHashes(scriptRegex, 'SCRIPT');

const emptyStringHash = crypto.createHash('sha256').update('').digest('base64');
const scriptHashList = scriptHashes.length > 0 ? `'unsafe-hashes' 'sha256-${emptyStringHash}' ` + scriptHashes.join(' ') : "'unsafe-inline'";

if (html.includes('__VITE_SCRIPT_HASH__')) {
    html = html.replace('__VITE_SCRIPT_HASH__', scriptHashList);
} else {
    console.warn("WARNING: __VITE_SCRIPT_HASH__ placeholder not found in dist/index.html.");
}

fs.writeFileSync(file, html, 'utf8');
console.log("CSP cryptographic injection sequence complete!");

// --- Auto-sync manifest.json and sw.js versions from package.json ---
const pkgPath = path.join(__dirname, '../../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

// Patch manifest.json version
const manifestPath = path.join(__dirname, '../../dist/manifest.json');
if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`Manifest version synced to ${version}`);
}

// Patch sw.js cache name with version-based key
const swPath = path.join(__dirname, '../../dist/sw.js');
if (fs.existsSync(swPath)) {
    let sw = fs.readFileSync(swPath, 'utf8');
    sw = sw.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'piecekeeper-v${version}-${Date.now()}';`);
    fs.writeFileSync(swPath, sw, 'utf8');
    console.log(`SW cache name updated to piecekeeper-v${version}`);
}
