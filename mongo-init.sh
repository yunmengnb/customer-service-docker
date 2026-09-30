#!/bin/sh
# 忆梦云团队开发
set -eu

replica_set="${MONGO_REPLICA_SET:-kf-rs0}"
member_host="${MONGO_REPLICA_HOST:-mongo:27017}"
uri="${MONGO_INIT_URI:-mongodb://mongo:27017/admin?directConnection=true}"
timeout_seconds="${MONGO_INIT_TIMEOUT_SECONDS:-120}"

case "$replica_set" in (*[!A-Za-z0-9_-]*|'') echo '[MongoInit] 非法副本集名称' >&2; exit 2;; esac
case "$member_host" in (*[!A-Za-z0-9_.:-]*|'') echo '[MongoInit] 非法成员地址' >&2; exit 2;; esac
case "$timeout_seconds" in (*[!0-9]*|'') echo '[MongoInit] 非法超时时间' >&2; exit 2;; esac

deadline=$(( $(date +%s) + timeout_seconds ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if mongosh "$uri" --quiet --eval "quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

mongosh "$uri" --quiet --eval '
const setName = process.env.MONGO_REPLICA_SET || "kf-rs0";
const memberHost = process.env.MONGO_REPLICA_HOST || "mongo:27017";
let initialized = false;
try {
  const status = db.adminCommand({ replSetGetStatus: 1 });
  initialized = status.ok === 1;
  if (initialized && status.set !== setName) throw new Error(`REPLICA_SET_MISMATCH:${status.set}`);
} catch (error) {
  if (error.code !== 76 && error.code !== 94 && !/not yet initialized/i.test(error.message)) throw error;
}
if (!initialized) {
  const result = db.adminCommand({ replSetInitiate: { _id: setName, members: [{ _id: 0, host: memberHost }] } });
  if (result.ok !== 1 && result.codeName !== "AlreadyInitialized") throw new Error(`REPLICA_INIT_FAILED:${result.errmsg || result.codeName}`);
  print(`[MongoInit] 已提交副本集初始化: ${setName}`);
}
'

while [ "$(date +%s)" -lt "$deadline" ]; do
  if mongosh "$uri" --quiet --eval '
    const hello = db.adminCommand({ hello: 1 });
    const expected = process.env.MONGO_REPLICA_SET || "kf-rs0";
    if (hello.setName !== expected || hello.isWritablePrimary !== true) quit(1);
    const session = db.getMongo().startSession();
    const probeDbName = "kf_replica_capability_probe";
    const probe = session.getDatabase(probeDbName).getCollection("transactions");
    try {
      session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority", wtimeout: 10000 } });
      probe.insertOne({ checkedAt: new Date() });
      session.commitTransaction();
      db.getSiblingDB(probeDbName).dropDatabase({ writeConcern: { w: "majority", wtimeout: 10000 } });
    } finally {
      session.endSession();
    }
    quit(0);
  ' >/dev/null 2>&1; then
    echo "[MongoInit] PRIMARY、majority 与事务能力已就绪: $replica_set/$member_host"
    exit 0
  fi
  sleep 1
done

echo '[MongoInit] 等待 PRIMARY 或事务能力超时' >&2
exit 1
