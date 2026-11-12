import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const DIRS = ["app", "components", "lib", "workers", "tests", "public"];
const FILES = ["README.md", ".env.example"];
const EXT = /\.(ts|tsx|css|md|json|csv|txt|example)$/;
const EM_DASH = String.fromCharCode(0x2014);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name) || name.startsWith(".env")) out.push(p);
  }
  return out;
}

describe("house style", () => {
  it("contains no em dash character in source, UI copy, data or README", () => {
    const files = [...DIRS.filter((d) => existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d))), ...FILES.map((f) => path.join(ROOT, f)).filter(existsSync)];
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(EM_DASH)).map((f) => path.relative(ROOT, f));
    expect(files.length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it("contains no TODO or placeholder markers in shipped code", () => {
    const files = ["app", "components", "lib", "workers"].flatMap((d) => walk(path.join(ROOT, d)));
    const offenders = files.filter((f) => /\b(TODO|FIXME|lorem ipsum|implement later)\b/i.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
