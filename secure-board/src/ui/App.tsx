import { type FormEvent, useEffect, useState } from 'react';
import type { Board } from '../domain/boards';

export interface Workspace {
  userId: string;
  boards: Board[];
}

export interface BoardAppService {
  restore(): Promise<Workspace | null>;
  login(username: string, password: string): Promise<Workspace>;
  logout(): Promise<void>;
  sendPost(roomId: string, body: string): Promise<void>;
  sendReply(roomId: string, rootEventId: string, body: string, replyToEventId?: string): Promise<void>;
}

export function App({ service }: { service: BoardAppService }) {
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    service.restore()
      .then((restored) => { if (active) setWorkspace(restored); })
      .catch(() => { if (active) setWorkspace(null); });
    return () => { active = false; };
  }, [service]);

  if (workspace === undefined) {
    return <main className="gate"><p className="eyebrow">SECURE BOARD / MATRIX</p><h1>Restoring encrypted session…</h1></main>;
  }

  if (!workspace) {
    const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError('');
      const form = new FormData(event.currentTarget);
      try {
        setWorkspace(await service.login(String(form.get('username')), String(form.get('password'))));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Login failed');
      }
    };

    return (
      <main className="gate">
        <section className="login-card">
          <p className="eyebrow">PRIVATE ROOMS. SHARED POWER.</p>
          <h1>SECURE<br /><span>BOARD</span></h1>
          <p className="lede">An encrypted organizing space backed by Matrix.</p>
          <form onSubmit={submitLogin}>
            <label>Matrix username<input name="username" autoComplete="username" required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
            {error && <p role="alert" className="error">{error}</p>}
            <button type="submit">Enter securely</button>
          </form>
          <p className="fineprint">Your password is sent only to the configured Matrix homeserver for login. Session credentials are kept in this origin's IndexedDB, not localStorage.</p>
        </section>
      </main>
    );
  }

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBoard) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body')).trim();
    if (!body) return;
    setError('');
    setSending(true);
    try {
      await service.sendPost(selectedBoard.id, body);
      form.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send post');
    } finally {
      setSending(false);
    }
  };

  const logout = async () => {
    setError('');
    try {
      await service.logout();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Matrix logout failed');
    } finally {
      setWorkspace(null);
      setSelectedBoard(null);
    }
  };

  return (
    <main className="board-shell">
      <header>
        <div><p className="eyebrow">SECURE BOARD / MATRIX E2EE</p><strong>{workspace.userId}</strong></div>
        <button className="quiet" onClick={logout}>Log out</button>
      </header>
      <aside aria-label="Private boards">
        <h1>BOARDS</h1>
        <p className="section-note">Joined private rooms</p>
        <nav>
          {workspace.boards.map((board) => (
            <button key={board.id} className={selectedBoard?.id === board.id ? 'active' : ''} onClick={() => setSelectedBoard(board)}>
              <span>{board.name}</span><small>{board.encrypted ? '● E2EE' : '⚠ BLOCKED'}</small>
            </button>
          ))}
        </nav>
      </aside>
      <section className="thread-panel">
        {selectedBoard ? (
          <>
            <div className="panel-title"><p className="eyebrow">PRIVATE BOARD</p><h2>{selectedBoard.name}</h2><p>{selectedBoard.topic || 'No board description.'}</p></div>
            <div className="empty-thread"><strong>ROOT POSTS BECOME THREADS</strong><p>Post an update, request, or proposal. Replies use Matrix <code>m.thread</code> relations.</p></div>
            {error && <p role="alert" className="error">{error}</p>}
            <form className="composer" onSubmit={submitPost}>
              <label htmlFor="new-post">New post</label>
              <textarea id="new-post" name="body" rows={3} placeholder="Start a thread…" required />
              <button disabled={sending || !selectedBoard.encrypted}>{selectedBoard.encrypted ? (sending ? 'Sending…' : 'Publish encrypted') : 'Encryption required'}</button>
            </form>
          </>
        ) : <div className="select-board"><p className="eyebrow">NO BOARD SELECTED</p><h2>CHOOSE A PRIVATE ROOM</h2><p>Your joined private Matrix rooms appear at left.</p></div>}
      </section>
    </main>
  );
}
