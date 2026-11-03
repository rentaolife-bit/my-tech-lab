// 运行 tests/ 下全部测试，汇总通过/失败。
// 用法：node tests/run-all.js
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".test.js"))
    .sort();

let totalPassed = 0;
let totalFailed = 0;
let suitesFailed = 0;

for (const file of files) {
    const full = path.join(dir, file);
    const result = spawnSync(process.execPath, [full], { encoding: "utf8" });
    const out = `${result.stdout || ""}${result.stderr || ""}`;
    const m = out.match(/结果：(\d+) 通过 \/ (\d+) 失败/);
    const passed = m ? Number(m[1]) : 0;
    const failed = m ? Number(m[2]) : 0;
    totalPassed += passed;
    totalFailed += failed;
    if (!m || result.status !== 0 || failed > 0) suitesFailed += 1;
    const mark = m && failed === 0 && result.status === 0 ? "✅" : "❌";
    console.log(`${mark} ${file}  —  ${m ? `${passed} 通过 / ${failed} 失败` : "运行异常"}`);
    if (!m || result.status !== 0) {
        console.log(out.trim().split("\n").slice(-8).map((l) => `     ${l}`).join("\n"));
    }
}

console.log(`\n合计：${totalPassed} 通过 / ${totalFailed} 失败；异常测试文件：${suitesFailed}`);
process.exit(totalFailed > 0 || suitesFailed > 0 ? 1 : 0);
