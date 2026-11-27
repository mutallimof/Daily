// Signs in to your Lifeplan account for the Languages scripts, so every row they write belongs to you.
// The email and password come from LANG_EMAIL and LANG_PASSWORD; when they are not set, you are asked for them in the
// terminal (the password is not shown as you type). Nothing is saved anywhere.
import { createInterface } from "node:readline";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    w._writeToOutput = (s) => {
      if (!muted) w.output.write(s);
      else if (s.trim()) w.output.write("*");
    };
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

export async function signIn(): Promise<{ supabase: SupabaseClient; userId: string }> {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    console.error("The Supabase address and key are missing: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or the VITE_ versions) must be in .env.");
    process.exit(1);
  }
  let email = process.env["LANG_EMAIL"]?.trim();
  let password = process.env["LANG_PASSWORD"];
  if (!email || !password) {
    if (!process.stdin.isTTY) {
      console.error("Set LANG_EMAIL and LANG_PASSWORD (your Lifeplan login), or run this in a terminal to be asked for them.");
      process.exit(1);
    }
    console.log("Sign in with your Lifeplan account (the one you use in the app).");
    email = email || (await ask("Email: "));
    password = password || (await ask("Password: ", true));
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const res = await supabase.auth.signInWithPassword({ email, password });
  if (res.error || !res.data.user) {
    console.error("Could not sign in:", res.error?.message ?? "no user");
    process.exit(1);
  }
  return { supabase, userId: res.data.user.id };
}
