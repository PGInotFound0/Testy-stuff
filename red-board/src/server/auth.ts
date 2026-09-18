import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { AppDatabase } from "./db.js";

export function createAuth(db: AppDatabase, opts: { baseURL: string; secret: string }) {
  return betterAuth({
    database: db as never,
    baseURL: opts.baseURL,
    secret: opts.secret,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 Tage
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    trustedOrigins: [opts.baseURL],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Legt BetterAuth-Tabellen an (user/session/account/verification), falls sie fehlen. */
export async function migrateAuth(auth: Auth): Promise<void> {
  const options = (auth as unknown as { options: Parameters<typeof getMigrations>[0] }).options;
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
}
