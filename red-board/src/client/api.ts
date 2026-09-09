export interface Board {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
}

export interface Post {
  id: string;
  board_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface Member {
  id: string;
  name: string;
  email: string | null;
  joinedAt: string;
  admin: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

export const api = {
  me: () => req<{ id: string; email: string; name: string; admin: boolean }>("/api/me"),
  boards: () => req<Board[]>("/api/boards"),
  createBoard: (name: string, description: string) =>
    req<Board>("/api/boards", { method: "POST", body: JSON.stringify({ name, description }) }),
  posts: (boardId: string) => req<Post[]>(`/api/boards/${boardId}/posts`),
  sendPost: (boardId: string, body: string, parentId: string | null) =>
    req<Post>(`/api/boards/${boardId}/posts`, {
      method: "POST",
      body: JSON.stringify({ body, parentId }),
    }),
  deletePost: (postId: string) => req<{ ok: boolean }>(`/api/posts/${postId}`, { method: "DELETE" }),
  members: () => req<Member[]>("/api/members"),
};
