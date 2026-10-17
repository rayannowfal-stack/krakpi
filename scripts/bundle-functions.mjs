// Rebuilds supabase/dashboard-paste/*.ts: one self-contained file per function,
// for pasting into the Supabase website editor. Run: npm run bundle:functions
import { build } from "esbuild";

const fns = ["ai-check", "ai-review", "admin-users", "weekly-jobs", "whatsapp"];
for (const f of fns) {
  await build({
    entryPoints: [`supabase/functions/${f}/index.ts`],
    bundle: true, format: "esm", platform: "neutral", target: "es2022",
    external: ["npm:*", "jsr:*"],
    outfile: `supabase/dashboard-paste/${f}.ts`,
    banner: { js: `// ${f} — single-file version to paste into Supabase → Edge Functions → Deploy a new function → Via Editor (function name: ${f}). Generated from supabase/functions/${f}; edit the originals, not this file.` },
    logLevel: "error",
  });
  console.log("built", f);
}
