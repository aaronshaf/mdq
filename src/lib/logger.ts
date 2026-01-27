/**
 * Simple logger for CLI output with visual indicators and colors
 * Uses stdout for normal messages, stderr only for actual errors
 */

import chalk from 'chalk';

export class Logger {
	private verbose: boolean;

	constructor(verbose = false) {
		this.verbose = verbose;
	}

	info(message: string): void {
		if (this.verbose) {
			console.log(chalk.dim(`→ ${message}`));
		}
	}

	success(message: string): void {
		if (this.verbose) {
			console.log(chalk.green(`✓ ${message}`));
		}
	}

	warning(message: string): void {
		if (this.verbose) {
			console.log(chalk.yellow(`⚠ ${message}`));
		}
	}

	error(message: string): void {
		// Errors always shown, even without verbose
		console.error(chalk.red(`✗ ${message}`));
	}

	progress(current: number, total: number, message: string): void {
		if (this.verbose) {
			console.log(`${chalk.dim(`  [${current}/${total}]`)} ${message}`);
		}
	}

	config(label: string, value: string): void {
		// Config/header info - always shown when verbose, uses cyan
		if (this.verbose) {
			console.log(chalk.cyan(`${label}: ${value}`));
		}
	}

	separator(): void {
		if (this.verbose) {
			console.log(chalk.dim('─'.repeat(60)));
		}
	}

	documentHeader(current: number, total: number, title: string): void {
		if (this.verbose) {
			console.log('');
			console.log(chalk.bold(`[${current}/${total}] ${title}`));
		}
	}

	/** Single-line document progress with result */
	documentProgress(current: number, total: number, title: string, result: string): void {
		if (this.verbose) {
			const progress = chalk.dim(`[${current}/${total}]`);
			console.log(`${progress} ${title} ${result}`);
		}
	}

	passCompact(pass: number, passName: string, result: string): void {
		if (this.verbose) {
			const passLabel = chalk.dim(`  Pass ${pass} (${passName}):`);
			console.log(`${passLabel} ${result}`);
		}
	}

	/** Simple indented result line (no pass prefix) */
	result(message: string): void {
		if (this.verbose) {
			console.log(`  ${message}`);
		}
	}

	setVerbose(verbose: boolean): void {
		this.verbose = verbose;
	}
}

export function createLogger(verbose = false): Logger {
	return new Logger(verbose);
}
