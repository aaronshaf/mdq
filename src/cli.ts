#!/usr/bin/env bun
import { run } from './cli/index.js';

await run(process.argv.slice(2));
