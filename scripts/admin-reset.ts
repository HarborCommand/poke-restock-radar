import "dotenv/config";
import { execFileSync } from "node:child_process";
import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import { z } from "zod";

const emailSchema = z.string().trim().email();
const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Password must stay under 128 characters")
  .regex(/[A-Z]/, "Include at least one uppercase letter")
  .regex(/[a-z]/, "Include at least one lowercase letter")
  .regex(/[0-9]/, "Include at least one number");

function command(name: "npm" | "npx") {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function preparePrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    execFileSync(command("npm"), ["run", "prisma:postgres"], { stdio: "inherit" });
    execFileSync(command("npx"), ["prisma", "generate", "--schema", ".prisma-postgres/schema.prisma"], { stdio: "inherit" });
    return;
  }
  execFileSync(command("npx"), ["prisma", "generate"], { stdio: "inherit" });
}

async function promptLine(label: string) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(label);
  } finally {
    rl.close();
  }
}

async function promptSecret(label: string) {
  if (!stdin.isTTY || !stdout.isTTY) return promptLine(label);

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const wasRaw = stdin.isRaw;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write(label);

    function cleanup() {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(wasRaw);
      stdout.write("\n");
    }

    function onKeypress(character: string, key: readline.Key) {
      if (key?.name === "return" || key?.name === "enter") {
        cleanup();
        resolve(value);
        return;
      }
      if (key?.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Admin reset cancelled."));
        return;
      }
      if (key?.name === "backspace") {
        if (value.length) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (character && character >= " " && !key?.ctrl && !key?.meta) {
        value += character;
        stdout.write("*");
      }
    }

    stdin.on("keypress", onKeypress);
  });
}

async function main() {
  preparePrismaClient();
  const { prisma } = await import("@/lib/db");

  const email = emailSchema.parse(await promptLine("Admin login email: "));
  const password = passwordSchema.parse(await promptSecret("New password: "));
  const confirmPassword = await promptSecret("Confirm new password: ");
  if (password !== confirmPassword) throw new Error("Passwords must match.");

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.$queryRaw<Array<{ id: string; role: string }>>`
    SELECT "id", "role" FROM "User" WHERE lower("email") = ${email.toLowerCase()} LIMIT 1
  `;
  const now = new Date();

  if (existing[0]) {
    await prisma.user.update({
      where: { id: existing[0].id },
      data: {
        email: email.toLowerCase(),
        name: existing[0].role === "ADMIN" ? undefined : "Radar Admin",
        role: "ADMIN",
        passwordHash,
        passwordChangedAt: now,
        disabledAt: null,
        sessionVersion: { increment: 1 },
        canAddSightings: true,
        canAddComps: true,
        canRunChecks: true,
        canReceivePushAlerts: true
      }
    });
    console.log(`Admin account updated for ${email.toLowerCase()}. Existing sessions were invalidated.`);
  } else {
    await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name: "Radar Admin",
        role: "ADMIN",
        passwordHash,
        passwordChangedAt: now,
        canAddSightings: true,
        canAddComps: true,
        canRunChecks: true,
        canReceivePushAlerts: true
      }
    });
    console.log(`Admin account created for ${email.toLowerCase()}.`);
  }

  console.log("Password hash saved to the database. The plain-text password was not logged or stored.");
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
