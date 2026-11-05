import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeOwner } from './support/harness';
import { recordTranscripts, renderFile } from './support/transcripts';

const FILE = join(__dirname, '..', 'site', 'transcripts.js');

/**
 * The landing page's tour is output recorded from this application. This spec records it again and compares: if the code
 * changes what it says, the page has to change with it. `make transcripts` (RECORD=1) rewrites the file.
 */
describe('the recorded tour on the landing page', () => {
  afterAll(async () => {
    await closeOwner();
  });

  it('is what the application says today', async () => {
    const fresh = renderFile(await recordTranscripts());
    if (process.env.RECORD === '1') {
      writeFileSync(FILE, fresh);
      return;
    }
    expect(readFileSync(FILE, 'utf8')).toBe(fresh);
  }, 90_000);

  it('records the same thing twice (nothing in it depends on the run)', async () => {
    const first = renderFile(await recordTranscripts());
    const second = renderFile(await recordTranscripts());
    expect(second).toBe(first);
  }, 120_000);
});
