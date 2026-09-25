import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient } from "./auth-client.js";
import { api, type Board, type Member, type Post } from "./api.js";

interface Me {
  id: string;
  email: string;
  name: string;
  admin: boolean;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function AuthScreen({ onDone }: { onDone: (me: Me) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const r = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
        if (r.error) throw new Error(r.error.message ?? "Sign-up failed.");
      } else {
        const r = await authClient.signIn.email({ email: email.trim(), password });
        if (r.error) throw new Error(r.error.message ?? "Sign-in failed.");
      }
      onDone(await api.me());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <p className="kicker">Solidarity message board</p>
        <h1>RED BOARD</h1>
        <p className="sub">
          No corporations. No tracking. Just comrades, boards, and plain words.
        </p>
        <div className="tabs" role="tablist">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            type="button"
          >
            SIGN IN
          </button>
          <button
            className={mode === "signup" ? "active" : ""}
            onClick={() => setMode("signup")}
            type="button"
          >
            JOIN UP
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <label>
              FIGHT NAME
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rosa R."
                required
                minLength={2}
                maxLength={60}
                autoComplete="username"
              />
            </label>
          )}
          <label>
            EMAIL
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@collective.org"
              required
              autoComplete="email"
            />
          </label>
          <label>
            PASSWORD
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="min. 8 characters"
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </label>
          {error && <p className="error">⚠ {error}</p>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "ONE SEC …" : mode === "signup" ? "CREATE ACCOUNT ✊" : "GET IN THERE ✊"}
          </button>
        </form>
        <p className="hint">
          Server-hosted with login &amp; TLS — <strong>no</strong> end-to-end encryption.
        </p>
      </div>
    </div>
  );
}

function Thread({
  post,
  replies,
  me,
  onReply,
  onDelete,
}: {
  post: Post;
  replies: Post[];
  me: Me;
  onReply: (parent: Post) => void;
  onDelete: (post: Post) => void;
}) {
  const canDelete = post.author_id === me.id || me.admin;
  return (
    <article className="post">
      <header>
        <span className="author">{post.author_name}</span>
        <span className="time">{fmtDate(post.created_at)}</span>
      </header>
      <p className="body">{post.body}</p>
      <div className="actions">
        <button type="button" onClick={() => onReply(post)}>
          ↩ REPLY
        </button>
        {canDelete && (
          <button type="button" className="danger" onClick={() => onDelete(post)}>
            ✕ DELETE
          </button>
        )}
      </div>
      {replies.length > 0 && (
        <div className="replies">
          {replies.map((r) => (
            <Thread key={r.id} post={r} replies={[]} me={me} onReply={onReply} onDelete={onDelete} />
          ))}
        </div>
      )}
    </article>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardDesc, setNewBoardDesc] = useState("");
  const [composer, setComposer] = useState("");
  const [replyTo, setReplyTo] = useState<Post | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const refreshBoards = useCallback(async () => {
    try {
      const list = await api.boards();
      setBoards(list);
      setActiveBoard((cur) => {
        if (cur) return list.find((b) => b.id === cur.id) ?? null;
        return list[0] ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load boards.");
    }
  }, []);

  useEffect(() => {
    if (me) void refreshBoards();
  }, [me, refreshBoards]);

  const refreshPosts = useCallback(async () => {
    if (!activeBoard) return;
    try {
      setPosts(await api.posts(activeBoard.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load posts.");
    }
  }, [activeBoard]);

  useEffect(() => {
    if (me && activeBoard) {
      setReplyTo(null);
      void refreshPosts();
    }
  }, [me, activeBoard, refreshPosts]);

  const topLevel = useMemo(() => posts.filter((p) => !p.parent_id), [posts]);
  const repliesBy = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      if (p.parent_id) {
        const arr = map.get(p.parent_id) ?? [];
        arr.push(p);
        map.set(p.parent_id, arr);
      }
    }
    return map;
  }, [posts]);

  async function createBoard(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const b = await api.createBoard(newBoardName.trim(), newBoardDesc.trim());
      setNewBoardName("");
      setNewBoardDesc("");
      await refreshBoards();
      setActiveBoard(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create board.");
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBoard || !composer.trim()) return;
    setError(null);
    try {
      await api.sendPost(activeBoard.id, composer.trim(), replyTo?.id ?? null);
      setComposer("");
      setReplyTo(null);
      await refreshPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed.");
    }
  }

  async function remove(post: Post) {
    if (!window.confirm("Really delete this post?")) return;
    try {
      await api.deletePost(post.id);
      await refreshPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function loadMembers() {
    try {
      setMembers(await api.members());
      setShowMembers((s) => !s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load members.");
    }
  }

  async function logout() {
    await authClient.signOut();
    setMe(null);
    setBoards([]);
    setPosts([]);
    setActiveBoard(null);
    setMembers([]);
    setShowMembers(false);
  }

  if (loading) return <div className="boot">LOADING RED BOARD …</div>;
  if (!me) return <AuthScreen onDone={setMe} />;

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <span className="star">★</span> RED BOARD
        </div>
        <div className="userbox">
          <span className="who">
            ✊ {me.name}
            {me.admin && <em className="admin"> ADMIN</em>}
          </span>
          <button type="button" onClick={() => void logout()}>
            LOG OUT
          </button>
        </div>
      </header>

      {error && (
        <p className="banner-error" role="alert">
          ⚠ {error} <button type="button" onClick={() => setError(null)}>✕</button>
        </p>
      )}

      <div className="main">
        <aside className="sidebar">
          <h2>BOARDS</h2>
          <nav>
            {boards.map((b) => (
              <button
                key={b.id}
                type="button"
                className={activeBoard?.id === b.id ? "active" : ""}
                onClick={() => setActiveBoard(b)}
              >
                # {b.name.toUpperCase()}
              </button>
            ))}
            {boards.length === 0 && <p className="empty">No boards yet. Open one!</p>}
          </nav>
          <form className="new-board" onSubmit={(e) => void createBoard(e)}>
            <h3>NEW BOARD</h3>
            <input
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              placeholder="Name, e.g. strike-org"
              required
              minLength={2}
              maxLength={80}
            />
            <input
              value={newBoardDesc}
              onChange={(e) => setNewBoardDesc(e.target.value)}
              placeholder="What's it about? (optional)"
              maxLength={500}
            />
            <button className="primary" type="submit">
              + OPEN
            </button>
          </form>
          <button type="button" className="ghost" onClick={() => void loadMembers()}>
            {showMembers ? "HIDE MEMBERS" : "WHO'S HERE? (MEMBERS)"}
          </button>
          {showMembers && (
            <ul className="members">
              {members.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong>
                  {m.admin && <em className="admin"> ADMIN</em>}
                  {m.email && <span className="mail"> · {m.email}</span>}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="board">
          {activeBoard ? (
            <>
              <div className="board-head">
                <h2># {activeBoard.name.toUpperCase()}</h2>
                {activeBoard.description && <p>{activeBoard.description}</p>}
              </div>
              <div className="feed">
                {topLevel.map((p) => (
                  <Thread
                    key={p.id}
                    post={p}
                    replies={repliesBy.get(p.id) ?? []}
                    me={me}
                    onReply={setReplyTo}
                    onDelete={(x) => void remove(x)}
                  />
                ))}
                {topLevel.length === 0 && (
                  <p className="empty">Still quiet here. Kick it off, comrade!</p>
                )}
              </div>
              <form className="composer" onSubmit={(e) => void send(e)}>
                {replyTo && (
                  <p className="reply-hint">
                    ↩ Reply to <strong>{replyTo.author_name}</strong>: “
                    {replyTo.body.slice(0, 80)}”
                    <button type="button" onClick={() => setReplyTo(null)}>
                      ✕
                    </button>
                  </p>
                )}
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Say it plain and solidary … (Enter = new line)"
                  rows={3}
                  maxLength={5000}
                />
                <button className="primary" type="submit" disabled={!composer.trim()}>
                  POST IT ✊
                </button>
              </form>
            </>
          ) : (
            <p className="empty">Pick a board on the left — or open a new one.</p>
          )}
        </section>
      </div>

      <footer>
        RED BOARD · Server-hosted (TLS + login), <strong>no</strong> end-to-end encryption ·
        Speak openly, but with sense.
      </footer>
    </div>
  );
}
