import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsciiRack } from './ascii-rack';

/** A system that does, or does not, ask for reduced motion. */
function stubMotionPreference(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduce'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('AsciiRack', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns by itself and can be paused', () => {
    stubMotionPreference(false);
    render(<AsciiRack />);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(screen.getByRole('button', { name: 'Spin it' })).toBeInTheDocument();
  });

  it('stands still when the system asks for reduced motion, until it is started', () => {
    stubMotionPreference(true);
    render(<AsciiRack />);

    fireEvent.click(screen.getByRole('button', { name: 'Spin it' }));

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('is one picture to a screen reader, drawn as text', () => {
    stubMotionPreference(false);
    render(<AsciiRack />);

    const rack = screen.getByRole('img', { name: /server rack drawn in ASCII/ });
    expect(rack.querySelectorAll('pre')).toHaveLength(3);
    expect(rack.textContent).toMatch(/[#@]/);
  });
});
