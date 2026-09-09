import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp, signup } from "./helpers.js";

const A = { name: "Rosi R.", email: "rosi@kollektiv.org", password: "soliPass123" };
const B = { name: "Karl K.", email: "karl@kollektiv.org", password: "soliPass123" };

describe("Tafeln & Beiträge (CRUD, hinter Auth)", () => {
  it("Board anlegen/listen, posten, antworten, eigene löschen, fremde nicht", async () => {
    const app = await makeApp();
    const agentA = request.agent(app);
    await signup(agentA, A);

    // Board anlegen
    const created = await agentA
      .post("/api/boards")
      .send({ name: "Streik-Org", description: "Alles zum Arbeitskampf" })
      .expect(201);
    const boardId = created.body.id as string;
    expect(created.body.name).toBe("Streik-Org");

    // Doppelter Name → 409
    await agentA.post("/api/boards").send({ name: "Streik-Org" }).expect(409);
    // Zu kurzer Name → 400
    await agentA.post("/api/boards").send({ name: "x" }).expect(400);

    // Liste enthält die Tafel
    const list = await agentA.get("/api/boards").expect(200);
    expect(list.body.map((b: { name: string }) => b.name)).toContain("Streik-Org");

    // Beitrag + Antwort im Thread
    const post = await agentA
      .post(`/api/boards/${boardId}/posts`)
      .send({ body: "Morgen 6 Uhr vorm Tor — alle da!" })
      .expect(201);
    const reply = await agentA
      .post(`/api/boards/${boardId}/posts`)
      .send({ body: "Bin dabei ✊", parentId: post.body.id })
      .expect(201);
    expect(reply.body.parent_id).toBe(post.body.id);

    const feed = await agentA.get(`/api/boards/${boardId}/posts`).expect(200);
    expect(feed.body).toHaveLength(2);

    // Unbekannte Tafel → 404
    await agentA.get("/api/boards/nope/posts").expect(404);

    // Zweite Nutzerin darf fremden Beitrag NICHT löschen
    const agentB = request.agent(app);
    await signup(agentB, B);
    await agentB.delete(`/api/posts/${post.body.id}`).expect(403);

    // Autorin darf eigenen Beitrag löschen
    await agentA.delete(`/api/posts/${reply.body.id}`).expect(200);
    const after = await agentA.get(`/api/boards/${boardId}/posts`).expect(200);
    expect(after.body).toHaveLength(1);
  });

  it("Mitgliederliste zeigt alle, E-Mails nur für sich selbst", async () => {
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
