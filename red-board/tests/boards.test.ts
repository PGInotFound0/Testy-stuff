import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp, signup } from "./helpers.js";

const A = { name: "Rosa R.", email: "rosa@collective.org", password: "soliPass123" };
const B = { name: "Karl K.", email: "karl@collective.org", password: "soliPass123" };

describe("Boards & posts (CRUD, behind auth)", () => {
  it("create/list boards, post, reply, delete own but not others'", async () => {
    const app = await makeApp();
    const agentA = request.agent(app);
    await signup(agentA, A);

    // Create board
    const created = await agentA
      .post("/api/boards")
      .send({ name: "strike-org", description: "Everything about the labor fight" })
      .expect(201);
    const boardId = created.body.id as string;
    expect(created.body.name).toBe("strike-org");

    // Duplicate name → 409
    await agentA.post("/api/boards").send({ name: "strike-org" }).expect(409);
    // Name too short → 400
    await agentA.post("/api/boards").send({ name: "x" }).expect(400);

    // List contains the board
    const list = await agentA.get("/api/boards").expect(200);
    expect(list.body.map((b: { name: string }) => b.name)).toContain("strike-org");

    // Post + reply in thread
    const post = await agentA
      .post(`/api/boards/${boardId}/posts`)
      .send({ body: "Tomorrow 6 AM at the gate — everyone there!" })
      .expect(201);
    const reply = await agentA
      .post(`/api/boards/${boardId}/posts`)
      .send({ body: "Count me in ✊", parentId: post.body.id })
      .expect(201);
    expect(reply.body.parent_id).toBe(post.body.id);

    const feed = await agentA.get(`/api/boards/${boardId}/posts`).expect(200);
    expect(feed.body).toHaveLength(2);

    // Unknown board → 404
    await agentA.get("/api/boards/nope/posts").expect(404);

    // Second user may NOT delete someone else's post
    const agentB = request.agent(app);
    await signup(agentB, B);
    await agentB.delete(`/api/posts/${post.body.id}`).expect(403);

    // Author may delete their own post
    await agentA.delete(`/api/posts/${reply.body.id}`).expect(200);
    const after = await agentA.get(`/api/boards/${boardId}/posts`).expect(200);
    expect(after.body).toHaveLength(1);
  });

  it("member list shows everyone, emails only for yourself", async () => {
    const app = await makeApp();
    const agentA = request.agent(app);
    await signup(agentA, A);
    const agentB = request.agent(app);
    await signup(agentB, B);

    const members = await agentA.get("/api/members").expect(200);
    const names = members.body.map((m: { name: string }) => m.name);
    expect(names).toContain(A.name);
    expect(names).toContain(B.name);
    const self = members.body.find((m: { name: string }) => m.name === A.name);
    const other = members.body.find((m: { name: string }) => m.name === B.name);
    expect(self.email).toBe(A.email);
    expect(other.email).toBeNull();
  });
});
