import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp, signup } from "./helpers.js";

describe("Auth flow (BetterAuth, session cookies)", () => {
  it("rejects the unauthenticated, sign-up → session → sign-out → sign-in", async () => {
    const app = await makeApp();

    // Protected without login
    await request(app).get("/api/boards").expect(401);
    await request(app).get("/api/me").expect(401);

    const agent = request.agent(app);
    const user = { name: "Rosa R.", email: "rosa@collective.org", password: "soliPass123" };

    const signUp = await signup(agent, user);
    expect([200, 201]).toContain(signUp.status);

    // Session cookie works: /api/me knows us
    const me = await agent.get("/api/me").expect(200);
    expect(me.body.email).toBe(user.email);
    expect(me.body.name).toBe(user.name);

    // Sign out → locked out again
    await agent.post("/api/auth/sign-out").expect(200);
    await agent.get("/api/me").expect(401);

    // Sign-in gets back in
    const agent2 = request.agent(app);
    const login = await agent2
      .post("/api/auth/sign-in/email")
      .set("Origin", "http://localhost:3000")
      .send({ email: user.email, password: user.password });
    expect([200, 201]).toContain(login.status);
    const me2 = await agent2.get("/api/me").expect(200);
    expect(me2.body.email).toBe(user.email);
  });

  it("rejects wrong passwords and duplicate emails", async () => {
    const app = await makeApp();
    const agent = request.agent(app);
    const user = { name: "Karl K.", email: "karl@collective.org", password: "soliPass123" };
    await signup(agent, user);

    const bad = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", "http://localhost:3000")
      .send({ email: user.email, password: "wrongwrong" });
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const dup = await signup(request.agent(app), user);
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });
});
