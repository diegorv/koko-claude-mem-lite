import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// Redirect data dir to a temp directory so tests never touch ~/.memory-lite/
const testDataDir = mkdtempSync(join(tmpdir(), 'memory-lite-test-'));
process.env.MEMORY_LITE_DATA_DIR = testDataDir;
