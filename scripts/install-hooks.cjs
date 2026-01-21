#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const gitDir = path.join(__dirname, '..', '.git');
const hooksDir = path.join(gitDir, 'hooks');
const preCommitHook = path.join(hooksDir, 'pre-commit');

const hookContent = `#!/bin/sh
# Run lint and typecheck before commit
bun run lint || exit 1
bun run typecheck || exit 1
`;

if (fs.existsSync(gitDir)) {
	if (!fs.existsSync(hooksDir)) {
		fs.mkdirSync(hooksDir, { recursive: true });
	}

	fs.writeFileSync(preCommitHook, hookContent);
	fs.chmodSync(preCommitHook, '755');
	console.log('Pre-commit hook installed');
} else {
	console.log('Not a git repository, skipping hook installation');
}
