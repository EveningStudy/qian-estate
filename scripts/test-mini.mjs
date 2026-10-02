import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const files = readdirSync("mini/tests").filter((name) =>
  name.endsWith(".test.cjs"),
);
if (!files.length)
  throw new Error("没有找到原生小程序逻辑测试，拒绝将零测试报告为通过。");
for (const args of [
  ["scripts/build-mini-demo.mjs"],
  ["mini/tests/static.mjs"],
  ["--test", ...files.map((name) => "mini/tests/" + name)],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, MINI_MODE: "demo" },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
