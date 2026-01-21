#!/usr/bin/env bun
import path from 'node:path';
import { Glob } from 'bun';

const MAX_FILE_SIZE = 500; // lines
const SRC_DIR = path.join(import.meta.dir, '..', 'src');

async function checkFileSizes(): Promise<void> {
	const glob = new Glob('**/*.ts');
	const violations: Array<{ file: string; lines: number }> = [];

	for await (const file of glob.scan({ cwd: SRC_DIR, absolute: true })) {
		const content = await Bun.file(file).text();
		const lineCount = content.split('\n').length;

		if (lineCount > MAX_FILE_SIZE) {
			violations.push({
				file: path.relative(SRC_DIR, file),
				lines: lineCount,
			});
		}
	}

	if (violations.length > 0) {
		console.error('Files exceeding maximum line count:');
		for (const v of violations) {
			console.error(`  ${v.file}: ${v.lines} lines (max: ${MAX_FILE_SIZE})`);
		}
		process.exit(1);
	}

	console.log('All files within size limits');
}

await checkFileSizes();
