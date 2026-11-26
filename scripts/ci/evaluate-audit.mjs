#!/usr/bin/env node
import { runFromStdin } from './audit-policy.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

runFromStdin(dirname(fileURLToPath(import.meta.url)));
