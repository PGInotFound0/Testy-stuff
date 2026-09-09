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
    return new Date(iso).toLocaleString("de-DE", {
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
        if (r.error) throw new Error(r.error.message ?? "Registrierung fehlgeschlagen.");
      } else {
        const r = await authClient.signIn.email({ email: email.trim(), password });
        if (r.error) throw new Error(r.error.message ?? "Login fehlgeschlagen.");
      }
      onDone(await api.me());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <p className="kicker">Solidarisches Nachrichtenbrett</p>
        <h1>ROTE TAFEL</h1>
        <p className="sub">
          Kein Konzern. Kein Tracking. Nur Genoss:innen, Tafeln und klare Worte.
        </p>
        <div className="tabs" role="tablist">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            type="button"
          >
            ANMELDEN
          </button>
          <button
            className={mode === "signup" ? "active" : ""}
            onClick={() => setMode("signup")}
            type="button"
          >
            MITMACHEN
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <label>
              KAMPFNAME
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Rosi R."
                required
                minLength={2}
                maxLength={60}
                autoComplete="username"
              />
            </label>
          )}
          <label>
            E-MAIL
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="du@kollektiv.org"
              required
              autoComplete="email"
            />
          </label>
          <label>
            PASSWORT
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="mind. 8 Zeichen"
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </label>
          {error && <p className="error">⚠ {error}</p>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "MOMENT …" : mode === "signup" ? "KONTO ERSTELLEN ✊" : "REIN DA ✊"}
          </button>
        </form>
        <p className="hint">
          Server-gehostet mit Login &amp; TLS — <strong>keine</strong> Ende-zu-Ende-Verschlüsselung.
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
          ↩ ANTWORTEN
        </button>
        {canDelete && (
          <button type="button" className="danger" onClick={() => onDelete(post)}>
            ✕ LÖSCHEN
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
      setError(err instanceof Error ? err.message : "Tafeln konnten nicht geladen werden.");
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
      setError(err instanceof Error ? err.message : "Beiträge konnten nicht geladen werden.");
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
      setError(err instanceof Error ? err.message : "Tafel konnte nicht erstellt werden.");
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
      setError(err instanceof Error ? err.message : "Senden fehlgeschlagen.");
    }
  }

  async function remove(post: Post) {
    if (!window.confirm("Beitrag wirklich löschen?")) return;
    try {
      await api.deletePost(post.id);
      await refreshPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen.");
    }
  }

  async function loadMembers() {
    try {
      setMembers(await api.members());
      setShowMembers((s) => !s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mitglieder konnten nicht geladen werden.");
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

  if (loading) return <div className="boot">ROTE TAFEL WIRD GELADEN …</div>;
  if (!me) return <AuthScreen onDone={setMe} />;

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <span className="star">★</span> ROTE TAFEL
        </div>
        <div className="userbox">
          <span className="who">
            ✊ {me.name}
            {me.admin && <em className="admin"> ADMIN</em>}
          </span>
          <button type="button" onClick={() => void logout()}>
            RAUS
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
          <h2>TAFELN</h2>
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
            {boards.length === 0 && <p className="empty">Noch keine Tafel. Eröffne eine!</p>}
          </nav>
          <form className="new-board" onSubmit={(e) => void createBoard(e)}>
            <h3>NEUE TAFEL</h3>
            <input
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              placeholder="Name, z. B. Streik-Org"
              required
              minLength={2}
              maxLength={80}
            />
            <input
              value={newBoardDesc}
              onChange={(e) => setNewBoardDesc(e.target.value)}
              placeholder="Worum geht's? (optional)"
              maxLength={500}
            />
            <button className="primary" type="submit">
              + ERÖFFNEN
            </button>
          </form>
          <button type="button" className="ghost" onClick={() => void loadMembers()}>
            {showMembers ? "MITGLIEDER VERBERGEN" : "WER IST DABEI? (MITGLIEDER)"}
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
                  <p className="empty">Noch still hier. Mach den Anfang, Genoss:in!</p>
                )}
              </div>
              <form className="composer" onSubmit={(e) => void send(e)}>
                {replyTo && (
                  <p className="reply-hint">
                    ↩ Antwort an <strong>{replyTo.author_name}</strong>: „
                    {replyTo.body.slice(0, 80)}“
                    <button type="button" onClick={() => setReplyTo(null)}>
                      ✕
                    </button>
                  </p>
                )}
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Sag's klar und solidarisch … (Enter = Zeilenumbruch)"
                  rows={3}
                  maxLength={5000}
                />
                <button className="primary" type="submit" disabled={!composer.trim()}>
                  ABSCHICKEN ✊
                </button>
              </form>
            </>
          ) : (
            <p className="empty">Wähl links eine Tafel — oder eröffne eine neue.</p>
          )}
        </section>
      </div>

      <footer>
        ROTE TAFEL · Server-gehostet (TLS + Login), <strong>kein</strong> Ende-zu-Ende-Verschlüsselung ·
        Sprich offen, aber mit Verstand.
      </footer>
    </div>
  );
}
