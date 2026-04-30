import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm" : "npm";

const commands = [
  ["server", ["run", "dev:server"]],
  ["web", ["run", "dev:web"]]
];

const children = commands.map(([name, args]) => {
  const child = spawn(npm, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: isWindows
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
      children.forEach((other) => {
        if (other !== child && !other.killed) {
          other.kill();
        }
      });
      process.exitCode = code;
    }
  });

  return child;
});

process.on("SIGINT", () => {
  children.forEach((child) => child.kill("SIGINT"));
});
