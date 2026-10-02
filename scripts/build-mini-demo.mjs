// 演示构建必须通过明确命令选择，正式构建缺少凭证时不降级。
process.env.MINI_MODE = "demo";
await import("./build-mini.mjs");
