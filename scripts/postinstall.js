#!/usr/bin/env node
/**
 * Postinstall script to patch rpc-websockets for Node 25+ compatibility.
 * 
 * Node 25 strictly enforces package.json "exports", but @solana/web3.js
 * (via jito-ts) deep-imports rpc-websockets/dist/lib/client which isn't
 * declared in rpc-websockets v9's exports map.
 * 
 * This creates shim files so the deep imports resolve correctly.
 */

const fs = require('fs');
const path = require('path');

const nodeVersion = parseInt(process.versions.node.split('.')[0]);
if (nodeVersion < 23) {
  // Older Node versions don't strictly enforce exports
  process.exit(0);
}

const rpcWsDir = path.join(__dirname, '..', 'node_modules', 'rpc-websockets');

if (!fs.existsSync(rpcWsDir)) {
  process.exit(0);
}

const libDir = path.join(rpcWsDir, 'dist', 'lib');

// Only patch if the dist/lib directory doesn't exist (v9+ bundles everything)
if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
  
  // Create client shim
  const clientDir = path.join(libDir, 'client');
  fs.mkdirSync(clientDir, { recursive: true });
  
  const shimContent = `// Auto-generated shim for Node 25+ compat
const rpcWs = require('../../index.cjs');
module.exports = rpcWs;
module.exports.default = rpcWs;
`;
  
  fs.writeFileSync(path.join(libDir, 'client.js'), shimContent);
  fs.writeFileSync(path.join(clientDir, 'websocket.js'), shimContent);
  fs.writeFileSync(path.join(clientDir, 'websocket.browser.js'), shimContent);
  
  console.log('✓ Patched rpc-websockets for Node 25+ compatibility');
}
