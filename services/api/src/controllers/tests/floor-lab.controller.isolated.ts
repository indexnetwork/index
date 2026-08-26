import { afterEach, describe, expect, test } from 'bun:test';

import { FloorLabController } from '../floor-lab.controller';

describe('FloorLabController', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  test('returns 404 outside development', async () => {
    process.env.NODE_ENV = 'production';
    const controller = new FloorLabController();
    await expect(controller.start(new Request('http://localhost/api/dev/floor/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seats: [
          { name: 'A', intent: 'Looking for investors' },
          { name: 'B', intent: 'Looking to invest' },
        ],
      }),
    }))).rejects.toThrow('Not found');
  });

  test('validates exactly two seats', async () => {
    process.env.NODE_ENV = 'development';
    const controller = new FloorLabController();
    const response = await controller.start(new Request('http://localhost/api/dev/floor/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seats: [{ name: 'A', intent: 'Only one' }],
      }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'exactly two seats are required' });
  });
});
