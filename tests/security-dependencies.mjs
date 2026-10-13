import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { deepmerge, deepmergeInto } = require("deepmerge-ts");

// GHSA-ggr8-5vv4-36mx: both public merge paths must handle cycles without
// exhausting the stack. Keep the plain-record shape used by Prisma covered.
for (const [name, merge] of [["deepmerge", deepmerge], ["deepmergeInto", deepmergeInto]]) {
  const left = {};
  const right = {};
  left.self = left;
  right.self = right;
  assert.doesNotThrow(() => merge(left, right));
  console.log(`PASS ${name}: recursive object graph does not exhaust the stack`);
}
const config = {
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: "file:synthetic-dependency-test.db" },
};
assert.deepEqual(deepmerge({}, config), config);
console.log("PASS Prisma plain-record configuration merge is preserved");

// Exercise the installed protocol handlers with synthetic packets only. No
// network server, real credentials, database, or large allocation is needed.
const mysqlRoot = path.dirname(require.resolve("mysql2/package.json"));
const { authSwitchRequest } = require(path.join(mysqlRoot, "lib/commands/auth_switch.js"));
const AuthSwitchRequest = require(path.join(mysqlRoot, "lib/packets/auth_switch_request.js"));
const packet = new AuthSwitchRequest({
  pluginName: "mysql_clear_password",
  pluginData: Buffer.alloc(0),
}).toPacket();
packet.offset = 4;
let credentialWrites = 0;
const connection = {
  config: { password: "synthetic-not-a-secret" },
  writePacket() { credentialWrites++; },
};
assert.throws(
  () => authSwitchRequest(packet, connection, { emit() {} }),
  { code: "MYSQL_CLEAR_PASSWORD_NOT_ENABLED" },
);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(credentialWrites, 0);
console.log("PASS GHSA-3f6p-5ww8-9rcr: default cleartext downgrade is rejected before writing credentials");

const { enableCompression } = require(path.join(mysqlRoot, "lib/compressed_protocol.js"));
const inflatedResult = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Compressed packet handler did not complete")), 5_000);
  const finish = (result) => { clearTimeout(timer); resolve(result); };
  const compressed = {
    write() {},
    handlePacket() {},
    _bumpCompressedSequenceId() {},
    _handleNetworkError(error) { finish({ errorCode: error.code, decodedBytes: 0 }); },
  };
  enableCompression(compressed);
  compressed._inflatedPacketsParser.execute = (buffer) => finish({ decodedBytes: buffer.length });
  compressed._handleCompressedPacket({
    readInt24: () => 64,
    readBuffer: () => deflateSync(Buffer.alloc(128)),
    numPackets: 1,
  });
});
assert.deepEqual(inflatedResult, { errorCode: "ERR_BUFFER_TOO_LARGE", decodedBytes: 0 });
console.log("PASS GHSA-rgwj-5xj2-c3m3: inflation exceeding the declared packet length is rejected");

// This focused regression does not replace npm audit. The separate audit gate
// continues to block unresolved advisories, including the braces dependency.
await import("./security-lint-profile.mjs");
await import("./unicode-safety.mjs");
