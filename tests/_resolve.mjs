// Lets the test runner import the app's TypeScript directly.
//
// Node's ESM resolver needs a file extension and knows nothing about the "@/" path alias from
// tsconfig, so `import "../lib/tax/realized.ts"` fails the moment that file imports "@/lib/…".
// This hook fills in both. It lives in one place because it did not: twelve test files each
// carried their own copy, eleven of which handled only relative paths, so adding one aliased
// import to a lib file broke unrelated suites with a module-not-found error that pointed nowhere
// near the change.
//
// Imported for side effects — `import "./_resolve.mjs";` before any dynamic import of app code.
// Static imports are evaluated first, so the hook is registered by the time the test body runs.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const REPO_ROOT = new URL("../", import.meta.url);

function firstExisting(specifier, base) {
  for (const ext of EXTENSIONS) {
    const candidate = new URL(specifier + ext, base);
    if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // The alias never resolves on its own, so it is handled before delegating.
    if (specifier.startsWith("@/")) {
      const resolved = firstExisting(specifier.slice(2), REPO_ROOT);
      if (resolved) return resolved;
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith(".") || !context.parentURL) throw err;
      const resolved = firstExisting(specifier, context.parentURL);
      if (resolved) return resolved;
      throw err;
    }
  },
});
