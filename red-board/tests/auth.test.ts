import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp, signup } from "./helpers.js";

describe("Auth-Flow (BetterAuth, Session-Cookies)", () => {
  it("weist Unangemeldete ab, Registrierung → Session → Logout → Login", async () => {
    const app = await makeApp();

    // Geschützt ohne Login
    await request(app).get("/api/boards").expect(401);
    await request(app).get("/api/me").expect(401);

    const agent = request.agent(app);
    const user = { name: "Rosi R.", email: "rosi@kollektiv.org", password: "soliPass123" };

    const signUp = await signup(agent, user);
    expect([200, 201]).toContain(signUp.status);

    // Session-Cookie trägt: /api/me kennt uns
    const me = await agent.get("/api/me").expect(200);
    expect(me.body.email).toBe(user.email);
    expect(me.body.name).toBe(user.name);

    // Logout → wieder draußen
    await agent.post("/api/auth/sign-out").expect(200);
    await agent.get("/api/me").expect(401);

    // Login geht wieder rein
    const agent2 = request.agent(app);
    const login = await agent2
      .post("/api/auth/sign-in/email")
      .set("Origin", "http://localhost:3000")
      .send({ email: user.email, password: user.password });
    expect([200, 201]).toContain(login.status);
    const me2 = await agent2.get("/api/me").expect(200);
    expect(me2.body.email).toBe(user.email);
  });

  it("lehnt falsches Passwort und Doppelemail ab", async () => {
    const app = await makeApp();
    const agent = request.agent(app);
    const user = { name: "Karl K.", email: "karl@kollektiv.org", password: "soliPass123" };
    await signup(agent, user);

    const bad = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", "http://localhost:3000")
      .send({ email: user.email, password: "falschfalsch" });
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const dup = await signup(request.agent(app), user);
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });
});
