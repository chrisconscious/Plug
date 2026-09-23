/**
 * Interactive, one-time provisioning script for the first Super Admin
 * account — replaces the Phase 1 "random password printed to the console
 * on boot" bootstrap mechanism (see docs/SECURITY.md item 9) now that a
 * real database exists.
 *
 * Deliberately NOT part of a migration or seed file: credentials must
 * never be checked into version control, even as a "dev-only" hash.
 *
 * Usage:  npm run db:create-super-admin
 *         (prompts for email + password interactively; password input is
 *         not echoed to the terminal)
 */
import { createInterface } from "readline";
import { Client } from "pg";
import { hashPassword } from "../../src/lib/security/password";

function prompt(question: string, opts?: { hidden?: boolean }): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (opts?.hidden) {
      // Minimal no-echo password input for a Node TTY, without pulling in
      // an external dependency.
      const stdin = process.stdin;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyStdin = stdin as any;
      let input = "";
      process.stdout.write(question);
      anyStdin.setRawMode?.(true);
      anyStdin.resume();
      anyStdin.setEncoding("utf8");
      const onData = (char: string) => {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          anyStdin.setRawMode?.(false);
          anyStdin.pause();
          anyStdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(input);
          return;
        }
        if (char === "\u0003") process.exit(1); // Ctrl+C
        if (char === "\u007f") { input = input.slice(0, -1); return; } // backspace
        input += char;
      };
      anyStdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Set DATABASE_URL before running this script.");
    process.exit(1);
  }

  const email = (await prompt("Super Admin email: ")).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("That doesn't look like a valid email address.");
    process.exit(1);
  }

  const password = await prompt("Super Admin password (input hidden): ", { hidden: true });
  if (password.length < 10) {
    console.error("Password must be at least 10 characters — see src/lib/validate.ts#isStrongPassword for the full policy enforced at signup time.");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      console.error(`A user with email ${email} already exists.`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    const result = await client.query(
      `INSERT INTO users (email, password_hash, role, disabled)
       VALUES ($1, $2, 'SUPER_ADMIN', false)
       RETURNING id, email, role, created_at`,
      [email, passwordHash]
    );
    console.log("Super Admin created:", result.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
