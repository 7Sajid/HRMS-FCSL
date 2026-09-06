import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** `--name "Karim Hossain" --role RM` → { name: "...", role: "RM" }. */
export function args(argv = process.argv.slice(2)): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function required(values: Record<string, string | true>, key: string, usage: string): string {
  const value = values[key];
  if (typeof value !== "string" || !value.trim()) {
    console.error(`\nMissing --${key}\n\n  ${usage}\n`);
    process.exit(1);
  }
  return value.trim();
}

export function optional(values: Record<string, string | true>, key: string): string | undefined {
  const value = values[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function die(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

export async function finish(): Promise<void> {
  await prisma.$disconnect();
}

/** A framed block, because these scripts print things people have to copy. */
export function box(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  console.log(`\n┌${"─".repeat(width)}┐`);
  for (const line of lines) console.log(`│ ${line.padEnd(width - 2)} │`);
  console.log(`└${"─".repeat(width)}┘\n`);
}
