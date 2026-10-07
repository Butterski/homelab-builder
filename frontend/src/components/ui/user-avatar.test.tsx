import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { initialsOf, isGeneratedAvatar } from '../../lib/avatar';
import { UserAvatar } from './user-avatar';

describe('UserAvatar', () => {
  it('shows the picture the sign-in provider gave', () => {
    const { container } = render(
      <UserAvatar name="Ada Lovelace" src="https://lh3.example.com/ada.jpg" />,
    );

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://lh3.example.com/ada.jpg',
    );
    expect(screen.queryByText('AL')).not.toBeInTheDocument();
  });

  it('draws initials when there is no picture', () => {
    const { container } = render(<UserAvatar name="Ada Lovelace" />);

    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('draws initials instead of fetching a generated cartoon', () => {
    // What the backend stores for the local owner and for a development login.
    const { container } = render(
      <UserAvatar
        name="Local Admin"
        src="https://api.dicebear.com/7.x/avataaars/svg?seed=local-admin"
      />,
    );

    expect(screen.getByText('LA')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to initials when the picture does not load', () => {
    const { container } = render(
      <UserAvatar name="Ada Lovelace" src="https://lh3.example.com/gone.jpg" />,
    );

    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('initialsOf', () => {
  it('takes the first and the last word', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('Ada King Lovelace')).toBe('AL');
    expect(initialsOf('local')).toBe('L');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
  });
});

describe('isGeneratedAvatar', () => {
  it('knows the avatar service by its host, not by a mention of it', () => {
    expect(isGeneratedAvatar('https://api.dicebear.com/7.x/initials/svg?seed=a')).toBe(true);
    expect(isGeneratedAvatar('https://dicebear.com/x.svg')).toBe(true);
    expect(isGeneratedAvatar('https://example.com/dicebear.com/a.png')).toBe(false);
    expect(isGeneratedAvatar('https://notdicebear.com/a.png')).toBe(false);
    expect(isGeneratedAvatar(undefined)).toBe(false);
  });
});
