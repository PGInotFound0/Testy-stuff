import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App, type BoardAppService } from '../src/ui/App';

describe('App', () => {
  it('logs in, lists private boards, and opens the thread panel', async () => {
    const service: BoardAppService = {
      restore: vi.fn().mockResolvedValue(null),
      login: vi.fn().mockResolvedValue({
        userId: '@organizer:example.org',
        boards: [{ id: '!aid:example.org', name: 'Mutual Aid', topic: 'Needs and offers', encrypted: true }],
      }),
      logout: vi.fn(),
      sendPost: vi.fn(),
      sendReply: vi.fn(),
    };
    render(<App service={service} />);

    fireEvent.change(await screen.findByLabelText('Matrix username'), { target: { value: 'organizer' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter securely' }));

    expect(await screen.findByRole('button', { name: /Mutual Aid/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mutual Aid/ }));
    expect(screen.getByRole('heading', { name: 'Mutual Aid' })).toBeInTheDocument();
    expect(screen.getByLabelText('New post')).toBeInTheDocument();
  });

  it('returns to login and surfaces an error when remote logout fails', async () => {
    const service: BoardAppService = {
      restore: vi.fn().mockResolvedValue({ userId: '@organizer:example.org', boards: [] }),
      login: vi.fn(),
      logout: vi.fn().mockRejectedValue(new Error('Matrix logout failed')),
      sendPost: vi.fn(),
      sendReply: vi.fn(),
    };
    render(<App service={service} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByLabelText('Matrix username')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Matrix logout failed');
  });
});
