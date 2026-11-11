/**
 * @file Loaded before every test file (`--import` in the `test` script): the folders the server writes
 * to (database backups, imported resources) go to a temporary folder of the test process, removed at its
 * end, so that running the tests never touches the files of the project or of a server in service.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'brindiwanko-test-'));
process.env.DATA_DIR = join(dir, 'data');
process.env.UPLOADS_DIR = join(dir, 'uploads');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
