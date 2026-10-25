import { describe, expect, it } from 'vitest';
import { chromePath } from './render.mjs';

describe('chromePath', () => {
  const has =
    (...paths) =>
    (p) =>
      paths.includes(p);
  it('takes the first candidate that exists', () => {
    expect(
      chromePath({
        env: {},
        exists: has('/b', '/c'),
        candidates: ['/a', '/b', '/c'],
      })
    ).toBe('/b');
  });
  it('takes CAPTURE_CHROME over the candidates, and refuses one that is not there', () => {
    expect(
      chromePath({
        env: { CAPTURE_CHROME: '/opt/chrome' },
        exists: has('/opt/chrome', '/a'),
        candidates: ['/a'],
      })
    ).toBe('/opt/chrome');
    expect(() =>
      chromePath({
        env: { CAPTURE_CHROME: '/nope' },
        exists: has('/a'),
        candidates: ['/a'],
      })
    ).toThrow(/CAPTURE_CHROME does not exist/);
  });
  it('names what it tried when there is no browser', () => {
    expect(() => chromePath({ env: {}, exists: () => false, candidates: ['/a'] })).toThrow(
      /tried \/a/
    );
  });
});
