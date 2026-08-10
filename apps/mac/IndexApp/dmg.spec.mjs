import { expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';

const root = new URL('.', import.meta.url).pathname;

function pngSize(bytes) {
  const magic = Buffer.from(bytes.subarray(0, 8)).toString('hex');
  expect(magic).toBe('89504e470d0a1a0a');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

test('background generator emits 1x and 2x PNGs with expected dimensions', async () => {
  const work = `${Bun.env.TMPDIR ?? '/tmp'}/index-dmg-bg-${crypto.randomUUID()}`;
  await mkdir(work, { recursive: true });
  try {
    const compile = Bun.spawnSync(
      ['swiftc', '-O', '-o', `${work}/dmg-background`, new URL('./dmg-background.swift', import.meta.url).pathname],
      { cwd: root },
    );
    expect(compile.stderr.toString()).toBe('');
    expect(compile.exitCode).toBe(0);

    const run = Bun.spawnSync([`${work}/dmg-background`, work], { cwd: root });
    expect(run.exitCode).toBe(0);

    const oneX = await Bun.file(`${work}/dmg-background.png`).bytes();
    expect(pngSize(oneX)).toEqual({ width: 540, height: 380 });
    const twoX = await Bun.file(`${work}/dmg-background@2x.png`).bytes();
    expect(pngSize(twoX)).toEqual({ width: 1080, height: 760 });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
