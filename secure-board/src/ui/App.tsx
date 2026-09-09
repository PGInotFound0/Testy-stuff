import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { Board } from '../domain/boards';
import type { BoardPost } from '../domain/posts';

export interface Workspace {
  userId: string;
  boards: Board[];
  posts?: Record<string, BoardPost[]>;
}

export interface BoardAppService {
  restore(): Promise<Workspace | null>;
  login(username: string, password: string): Promise<Workspace>;
  register?(username: string, password: string, token: string): Promise<Workspace>;
  logout(): Promise<void>;
  subscribe?(listener: (workspace: Workspace) => void): () => void;
  dispose?(): void;
  sendPost(roomId: string, body: string): Promise<void>;
  sendReply(roomId: string, rootEventId: string, body: string, replyToEventId?: string): Promise<void>;
  createBoard?(name: string): Promise<unknown>;
  inviteMember?(roomId: string, userId: string): Promise<void>;
  redact?(roomId: string, eventId: string): Promise<void>;
}

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function App({ service }: { service: BoardAppService }) {
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authenticating, setAuthenticating] = useState(false);
  const [sendingPost, setSendingPost] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [redactingId, setRedactingId] = useState<string | null>(null);
  const authPending = useRef(false);
  const postPending = useRef(false);
  const replyPending = useRef(false);
  const boardPending = useRef(false);
  const invitePending = useRef(false);
  const redactPending = useRef(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = service.subscribe?.((updated) => { if (active) setWorkspace(updated); });
    service.restore()
      .then((restored) => { if (active) setWorkspace(restored); })
      .catch((caught) => {
        if (active) {
          setError(errorMessage(caught, 'Session restore failed'));
          setWorkspace(null);
        }
      });
    return () => {
      active = false;
      unsubscribe?.();
      service.dispose?.();
    };
  }, [service]);

  useEffect(() => {
    if (!workspace) return;
    const current = workspace.boards.find((board) => board.id === selectedBoard?.id);
    if (current !== selectedBoard) setSelectedBoard(current ?? workspace.boards[0] ?? null);
    if (!current && selectedBoard) setSelectedPostId(null);
  }, [workspace, selectedBoard]);

  if (workspace === undefined) {
    return <main className="gate"><p className="eyebrow">SECURE BOARD / MATRIX</p><h1>Restoring encrypted session…</h1></main>;
  }

  if (!workspace) {
    const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (authPending.current) return;
      authPending.current = true;
      setAuthenticating(true);
      setError('');
      const form = new FormData(event.currentTarget);
      try {
        if (authMode === 'register') {
          if (!service.register) throw new Error('Token registration is not available');
          setWorkspace(await service.register(String(form.get('username')), String(form.get('password')), String(form.get('token'))));
        } else {
          setWorkspace(await service.login(String(form.get('username')), String(form.get('password'))));
        }
      } catch (caught) {
        setError(errorMessage(caught, authMode === 'register' ? 'Registration failed' : 'Login failed'));
      } finally {
        authPending.current = false;
        setAuthenticating(false);
      }
    };

    return (
      <main className="gate">
        <section className="login-card">
          <p className="eyebrow">PRIVATE ROOMS. SHARED POWER.</p>
          <h1>SECURE<br /><span>BOARD</span></h1>
          <p className="lede">An encrypted organizing space backed by Matrix.</p>
          <div className="mode-switch">
            <button type="button" onClick={() => setAuthMode('login')} aria-pressed={authMode === 'login'}>Sign in</button>
            <button type="button" onClick={() => setAuthMode('register')} aria-pressed={authMode === 'register'}>Create account</button>
          </div>
          <form onSubmit={submitAuth}>
            <label>{authMode === 'register' ? 'New Matrix username' : 'Matrix username'}<input name="username" autoComplete="username" required /></label>
            <label>{authMode === 'register' ? 'New password' : 'Password'}<input name="password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required /></label>
            {authMode === 'register' && <label>Registration token<input name="token" type="password" autoComplete="off" required /></label>}
            {error && <p role="alert" className="error">{error}</p>}
            <button type="submit" disabled={authenticating}>{authenticating ? 'Working…' : authMode === 'register' ? 'Register securely' : 'Enter securely'}</button>
          </form>
          <p className="fineprint">Credentials and registration tokens go only to the configured Matrix homeserver. Registration proceeds only when the remaining UIAA stages are token + optional dummy; it cannot bypass terms, CAPTCHA, email, or SSO.</p>
        </section>
      </main>
    );
  }

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBoard || postPending.current) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body')).trim();
    if (!body) return;
    postPending.current = true;
    setError(''); setSendingPost(true);
    try { await service.sendPost(selectedBoard.id, body); form.reset(); }
    catch (caught) { setError(errorMessage(caught, 'Could not send post')); }
    finally { postPending.current = false; setSendingPost(false); }
  };

  const submitReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBoard || !selectedPostId || replyPending.current) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body')).trim();
    if (!body) return;
    const post = (workspace.posts?.[selectedBoard.id] ?? []).find((candidate) => candidate.id === selectedPostId);
    if (!post) return;
    const latestEventId = post.replies.at(-1)?.id ?? post.id;
    replyPending.current = true;
    setError(''); setSendingReply(true);
    try { await service.sendReply(selectedBoard.id, post.id, body, latestEventId); form.reset(); }
    catch (caught) { setError(errorMessage(caught, 'Could not send reply')); }
    finally { replyPending.current = false; setSendingReply(false); }
  };

  const submitBoard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (boardPending.current) return;
    boardPending.current = true;
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name'));
    setCreating(true); setError('');
    try { if (!service.createBoard) throw new Error('Board creation is not available'); await service.createBoard(name); form.reset(); }
    catch (caught) { setError(errorMessage(caught, 'Could not create board')); }
    finally { boardPending.current = false; setCreating(false); }
  };

  const submitInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBoard || invitePending.current) return;
    invitePending.current = true;
    const form = event.currentTarget;
    const userId = String(new FormData(form).get('userId')).trim();
    setInviting(true); setError('');
    try { if (!service.inviteMember) throw new Error('Board invitations are not available'); await service.inviteMember(selectedBoard.id, userId); form.reset(); }
    catch (caught) { setError(errorMessage(caught, 'Could not invite member')); }
    finally { invitePending.current = false; setInviting(false); }
  };

  const redact = async (eventId: string) => {
    if (!selectedBoard || redactPending.current) return;
    redactPending.current = true;
    setRedactingId(eventId); setError('');
    try { if (!service.redact) throw new Error('Redaction is not available'); await service.redact(selectedBoard.id, eventId); }
    catch (caught) { setError(errorMessage(caught, 'Could not redact event')); }
    finally { redactPending.current = false; setRedactingId(null); }
  };

  const logout = async () => {
    setError('');
    try { await service.logout(); }
    catch (caught) { setError(errorMessage(caught, 'Matrix logout failed')); }
    finally { setWorkspace(null); setSelectedBoard(null); setSelectedPostId(null); }
  };

  const posts = selectedBoard ? workspace.posts?.[selectedBoard.id] ?? [] : [];
  const selectedPost = posts.find((post) => post.id === selectedPostId);

  return (
    <main className="board-shell">
      <header>
        <div><p className="eyebrow">SECURE BOARD / MATRIX E2EE</p><strong>{workspace.userId}</strong></div>
        <button className="quiet" onClick={logout}>Log out</button>
      </header>
      <aside aria-label="Private boards">
        <h1>BOARDS</h1><p className="section-note">Joined invite-only rooms</p>
        <form onSubmit={submitBoard}><label>Board name<input name="name" maxLength={80} required /></label><button disabled={creating}>{creating ? 'Creating…' : 'Create encrypted board'}</button></form>
        <nav>{workspace.boards.map((board) => (
          <button key={board.id} className={selectedBoard?.id === board.id ? 'active' : ''} onClick={() => { setSelectedBoard(board); setSelectedPostId(null); }}>
            <span>{board.name}</span><small>{board.encrypted ? '● E2EE' : '⚠ BLOCKED'}</small>
          </button>
        ))}</nav>
      </aside>
      <section className="thread-panel">
        {selectedBoard ? <>
          <div className="panel-title"><p className="eyebrow">PRIVATE BOARD</p><h2>{selectedBoard.name}</h2><p>{selectedBoard.topic || 'No board description.'}</p></div>
          <form onSubmit={submitInvite}><label>Matrix user ID<input name="userId" placeholder="@name:server.example" required /></label><button disabled={inviting}>{inviting ? 'Inviting…' : 'Invite to board'}</button></form>
          <p className="fineprint">This sends a board room invite to an existing Matrix account; it does not create an account.</p>
          <div className="posts">{posts.map((post) => <article key={post.id}>
            <button type="button" onClick={() => setSelectedPostId(post.id)}><strong>{post.body}</strong><small>{post.sender}</small></button>
            <button type="button" disabled={redactingId === post.id} onClick={() => redact(post.id)} aria-label={`Redact post ${post.body}`}>Redact</button>
            <ul>{post.replies.map((reply) => <li key={reply.id}>{reply.body} <small>{reply.sender}</small> <button type="button" onClick={() => redact(reply.id)} aria-label={`Redact reply ${reply.body}`}>Redact</button></li>)}</ul>
          </article>)}</div>
          {selectedPost && <form className="composer" onSubmit={submitReply}><label htmlFor="thread-reply">Thread reply</label><textarea id="thread-reply" name="body" required /><button disabled={sendingReply}>{sendingReply ? 'Replying…' : 'Reply encrypted'}</button></form>}
          {error && <p role="alert" className="error">{error}</p>}
          <p className="fineprint">Matrix redaction hides content when authorized; it does not erase copies already received by other devices or users.</p>
          <form className="composer" onSubmit={submitPost}><label htmlFor="new-post">New post</label><textarea id="new-post" name="body" rows={3} placeholder="Start a thread…" required /><button disabled={sendingPost || !selectedBoard.encrypted}>{selectedBoard.encrypted ? (sendingPost ? 'Sending…' : 'Publish encrypted') : 'Encryption required'}</button></form>
        </> : <div className="select-board"><p className="eyebrow">NO BOARD SELECTED</p><h2>CHOOSE A PRIVATE ROOM</h2><p>Your joined invite-only Matrix rooms appear at left.</p></div>}
      </section>
    </main>
  );
}
