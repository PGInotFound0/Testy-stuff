import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/server/app.js";
import { createAuth, migrateAuth } from "../src/server/auth.js";
import { openDatabase } from "../src/server/db.js";

export const TEST_SECRET = "test-suite-secret-at-least-32-chars!!";

export async function makeApp(): Promise<Express> {
  const db = openDatabase(":memory:");
  const auth = createAuth(db, { baseURL: "http://localhost:3000", secret: TEST_SECRET });
  await migrateAuth(auth);
  return createApp({ db, auth });
}

export async function signup(agent: request.Agent, user: { name: string; email: string; password: string }) {
  const res = await agent
    .post("/api/auth/sign-up/email")
    .send(user)
    .set("Origin", "http://localhost:3000");
  return res;
}
