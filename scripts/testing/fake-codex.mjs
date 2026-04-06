import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? "success";
const recordPath = process.env.FAKE_CODEX_RECORD_PATH
  ? resolve(process.env.FAKE_CODEX_RECORD_PATH)
  : undefined;
const responseText = process.env.FAKE_CODEX_RESPONSE ?? "{\"ok\":true}";
const threadId = process.env.FAKE_CODEX_THREAD_ID ?? "thread_fake_123";
const authMode = process.env.FAKE_CODEX_AUTH_MODE ?? "chatgpt";
const loginStatusMode = process.env.FAKE_CODEX_LOGIN_STATUS ?? "ok";

const argValue = (flag) => {
  const index = argv.indexOf(flag);
  if (index < 0 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1];
};

const outputPath = argValue("--output-last-message");
const profileIndex = argv.indexOf("--profile");
const profile = profileIndex >= 0 ? argv[profileIndex + 1] : undefined;
const execIndex = argv.indexOf("exec");
const loginStatus = argv[0] === "login" && argv[1] === "status";
const usedResume =
  execIndex >= 0 &&
  argv[execIndex + 1] === "resume" &&
  typeof argv[argv.length - 2] === "string";
let stdinText = "";

const failSyntax = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
  process.exit();
};

if (argv[0] === "--version") {
  process.stdout.write("fake-codex 0.0.0\n");
  process.exitCode = 0;
  process.exit();
}

if (loginStatus) {
  if (recordPath) {
    const record = {
      argv,
      stdin: "",
      output_path: null,
      profile: null,
      used_resume: false,
      auth_mode: authMode
    };
    let existing = [];
    try {
      existing = JSON.parse(await readFile(recordPath, "utf8"));
      if (!Array.isArray(existing)) {
        existing = [];
      }
    } catch {
      existing = [];
    }
    existing.push(record);
    await writeFile(recordPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
  }

  if (loginStatusMode !== "ok") {
    process.stderr.write("fake codex login status forced failure\n");
    process.exitCode = 1;
    process.exit();
  }

  process.stdout.write(`Logged in with ${authMode} auth\n`);
  process.exitCode = 0;
  process.exit();
}

if (execIndex !== 0) {
  failSyntax("fake codex expected 'exec' as the first CLI argument");
}

const stdinChunks = [];

for await (const chunk of process.stdin) {
  stdinChunks.push(chunk);
}

stdinText = Buffer.concat(stdinChunks).toString("utf8");

if (argv.slice(0, execIndex).some((value) => value === "--profile" || value === "-c")) {
  failSyntax("fake codex expected Codex exec options after the 'exec' subcommand");
}

if (usedResume && argv.includes("--profile")) {
  failSyntax("fake codex expected 'codex exec resume' to omit --profile");
}

if (usedResume && argv.includes("--output-schema")) {
  failSyntax("fake codex expected 'codex exec resume' to omit --output-schema");
}

if (recordPath) {
  const record = {
    argv,
    stdin: stdinText,
    output_path: outputPath ?? null,
    profile: profile ?? null,
    used_resume: usedResume
  };
  let existing = [];
  try {
    existing = JSON.parse(await readFile(recordPath, "utf8"));
    if (!Array.isArray(existing)) {
      existing = [];
    }
  } catch {
    existing = [];
  }
  existing.push(record);
  await writeFile(recordPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
}

if (mode === "fail") {
  process.stderr.write("fake codex forced failure\n");
  process.exitCode = 1;
  process.exit();
}

if (outputPath && mode !== "missing-response") {
  await writeFile(resolve(outputPath), responseText, "utf8");
}

process.stdout.write(
  `${JSON.stringify({ type: "thread.started", thread_id: threadId })}\n`
);
process.stdout.write(
  `${JSON.stringify({ type: "message.completed", role: "assistant" })}\n`
);
process.exitCode = 0;
