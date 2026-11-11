#!/usr/bin/env node
import { main } from '../src/cli.js';

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  process.stderr.write(`stackmap needs Node.js 20 or newer (you have ${process.versions.node}).\n`);
  process.exit(1);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`stackmap: ${err.stack ?? err}\n`);
    process.exitCode = 1;
  },
);
