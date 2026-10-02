import { createApp } from "./app.js";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";

const config = loadConfig();
const port = config.PORT;
// 配置校验先于数据库打开及端口监听。
const app = config.DATA_DIR
  ? createApp(resolve(config.DATA_DIR, "qian-estate.sqlite"))
  : createApp();
const server = app.listen(port, config.HOST, () =>
  console.log(
    JSON.stringify({
      event: "服务已启动",
      environment: config.NODE_ENV,
      host: config.HOST,
      port,
    }),
  ),
);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.on("error", () => {
  console.error("服务监听失败，请检查端口占用和监听地址。");
  app.locals.close();
  process.exitCode = 1;
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  setTimeout(() => {
    server.closeAllConnections();
  }, 5000).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
