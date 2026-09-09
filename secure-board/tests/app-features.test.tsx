import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App, type BoardAppService, type Workspace } from '../src/ui/App';

function service(overrides: Partial<BoardAppService> = {}): BoardAppService {
  return {
    restore: vi.fn().mockResolvedValue(null), login: vi.fn(), logout: vi.fn(),
    sendPost: vi.fn(), sendReply: vi.fn(), register: vi.fn(), subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(), createBoard: vi.fn(), inviteMember: vi.fn(), redact: vi.fn(), ...overrides,
  };
}

const workspace: Workspace = {
  userId: '@alice:example.org',
  boards: [{ id: '!board:example.org', name: 'Tenant Union', encrypted: true }],
  posts: { '!board:example.org': [{
    id: '$root', body: 'Organize', sender: '@alice:example.org', timestamp: 1,
    replies: [{ id: '$reply', body: 'Count me in', sender: '@bob:example.org', timestamp: 2 }],
  }] },
};

describe('App usable board features', () => {
  it('registers an account using a registration token from an explicit logged-out mode', async () => {
    const register = vi.fn().mockResolvedValue({ userId: '@new:example.org', boards: [], posts: {} });
    const appService = service({ register });
    render(<App service={appService} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }));
    fireEvent.change(screen.getByLabelText('New Matrix username'), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'strong pass' } });
    fireEvent.change(screen.getByLabelText('Registration token'), { target: { value: 'token-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register securely' }));
    expect(register).toHaveBeenCalledWith('new', 'strong pass', 'token-123');
    expect(await screen.findByText('@new:example.org')).toBeInTheDocument();
  });

  it('subscribes to live workspaces and cleans up on component teardown', async () => {
    let publish: ((workspace: Workspace) => void) | undefined;
    const unsubscribe = vi.fn();
    const appService = service({
      restore: vi.fn().mockResolvedValue(workspace),
      subscribe: vi.fn((listener) => { publish = listener; return unsubscribe; }),
    });
    const rendered = render(<App service={appService} />);
    await screen.findByText('Organize');
    const originalPost = workspace.posts!['!board:example.org']![0]!;
    publish?.({ ...workspace, posts: { '!board:example.org': [{ ...originalPost, body: 'Updated live' }] } });
    expect(await screen.findByText('Updated live')).toBeInTheDocument();
    rendered.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(appService.dispose).toHaveBeenCalledOnce();
  });

  it('creates boards, invites existing Matrix IDs, and explains that invites do not create accounts', async () => {
    const createBoard = vi.fn();
    const inviteMember = vi.fn();
    const appService = service({ restore: vi.fn().mockResolvedValue(workspace), createBoard, inviteMember });
    render(<App service={appService} />);
    await screen.findByText('Tenant Union');
    fireEvent.change(screen.getByLabelText('Board name'), { target: { value: 'Mutual Aid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create encrypted board' }));
    expect(createBoard).toHaveBeenCalledWith('Mutual Aid');

    fireEvent.click(screen.getByRole('button', { name: /Tenant Union/ }));
    expect(screen.getByText(/room invite.*does not create an account/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Matrix user ID'), { target: { value: '@bob:example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite to board' }));
    expect(inviteMember).toHaveBeenCalledWith('!board:example.org', '@bob:example.org');
  });

  it('blocks duplicate board creation and invite submissions before React rerenders', async () => {
    const createBoard = vi.fn(() => new Promise<never>(() => undefined));
    const inviteMember = vi.fn(() => new Promise<never>(() => undefined));
    const appService = service({ restore: vi.fn().mockResolvedValue(workspace), createBoard, inviteMember });
    render(<App service={appService} />);
    await screen.findByText('Tenant Union');

    fireEvent.change(screen.getByLabelText('Board name'), { target: { value: 'Mutual Aid' } });
    const createForm = screen.getByLabelText('Board name').closest('form')!;
    act(() => {
      createForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      createForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(createBoard).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /Tenant Union/ }));
    fireEvent.change(screen.getByLabelText('Matrix user ID'), { target: { value: '@bob:example.org' } });
    const inviteForm = screen.getByLabelText('Matrix user ID').closest('form')!;
    act(() => {
      inviteForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      inviteForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(inviteMember).toHaveBeenCalledOnce();
  });

  it('blocks duplicate redactions before React rerenders', async () => {
    const redact = vi.fn(() => new Promise<never>(() => undefined));
    const appService = service({ restore: vi.fn().mockResolvedValue(workspace), redact });
    render(<App service={appService} />);
    fireEvent.click((await screen.findByText('Organize')).closest('button')!);
    const redactButton = screen.getByRole('button', { name: 'Redact post Organize' });

    act(() => {
      redactButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      redactButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(redact).toHaveBeenCalledOnce();
  });

  it('surfaces posting failures without clearing the draft', async () => {
    const sendPost = vi.fn().mockRejectedValue(new Error('Homeserver rejected the post'));
    const appService = service({ restore: vi.fn().mockResolvedValue(workspace), sendPost });
    render(<App service={appService} />);
    const composer = await screen.findByLabelText('New post');
    fireEvent.change(composer, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish encrypted' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Homeserver rejected the post');
    expect(composer).toHaveValue('Keep this draft');
  });

  it('posts roots once, replies to the latest thread event, redacts, and surfaces permission errors', async () => {
    let finishPost: (() => void) | undefined;
    let finishReply: (() => void) | undefined;
    const sendPost = vi.fn(() => new Promise<void>((resolve) => { finishPost = resolve; }));
    const sendReply = vi.fn(() => new Promise<void>((resolve) => { finishReply = resolve; }));
    const redact = vi.fn().mockRejectedValue(new Error('You do not have permission to redact this event'));
    const appService = service({ restore: vi.fn().mockResolvedValue(workspace), sendPost, sendReply, redact });
    render(<App service={appService} />);
    fireEvent.click(await screen.findByRole('button', { name: /Tenant Union/ }));

    fireEvent.change(screen.getByLabelText('New post'), { target: { value: 'New root' } });
    const publish = screen.getByRole('button', { name: 'Publish encrypted' });
    fireEvent.click(publish);
    fireEvent.click(publish);
    expect(sendPost).toHaveBeenCalledOnce();
    expect(publish).toHaveTextContent('Sending…');
    finishPost?.();

    fireEvent.click(screen.getByText('Organize').closest('button')!);
    fireEvent.change(await screen.findByLabelText('Thread reply'), { target: { value: 'Latest answer' } });
    const replyButton = screen.getByRole('button', { name: 'Reply encrypted' });
    fireEvent.click(replyButton);
    fireEvent.click(replyButton);
    expect(sendReply).toHaveBeenCalledOnce();
    expect(sendReply).toHaveBeenCalledWith('!board:example.org', '$root', 'Latest answer', '$reply');
    expect(replyButton).toHaveTextContent('Replying…');
    finishReply?.();

    fireEvent.click(screen.getByRole('button', { name: 'Redact reply Count me in' }));
    expect(redact).toHaveBeenCalledWith('!board:example.org', '$reply');
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.getByText(/does not erase copies already received/i)).toBeInTheDocument();
  });
});
