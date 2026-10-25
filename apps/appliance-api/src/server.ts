import { installFatalHandlers } from "./fatal.js";
import { assertProductionConfig, configFromEnv, createEnterpriseApi, depsFromEnv, repositoryFromEnv } from "./index.js";

installFatalHandlers();
let cfg0: ReturnType<typeof configFromEnv>;
try {
  cfg0 = configFromEnv();
  assertProductionConfig(cfg0);
} catch (e) {
  process.stderr.write(`${JSON.stringify({ msg: (e as Error).message, edition: "enterprise" })}\n`);
  process.exit(1);
}
const deps0 = depsFromEnv(cfg0);
const repo = await repositoryFromEnv(process.env, deps0.credential);
const server = createEnterpriseApi(cfg0, { ...deps0, repository: repo });
const port = Number(process.env.PORT ?? 8081);
server.listen(port, () => process.stderr.write(`{"msg":"appliance-api listening","port":${port},"edition":"enterprise"}\n`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
