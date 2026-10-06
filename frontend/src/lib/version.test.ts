/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, APP_VERSION_LABEL } from './version';

describe('app version', () => {
  it('comes from package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION_LABEL).toBe(`v${pkg.version.split('.').slice(0, 2).join('.')}`);
  });

  it('matches the backend release number', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../backend/internal/version/version.go'),
      'utf-8',
    );
    const match = source.match(/const Version = "([^"]+)"/);
    expect(match?.[1]).toBe(APP_VERSION);
  });
});
