#!/usr/bin/env bash
# ==============================================================================
# TheHomez — Idempotent MongoDB Replica-Set Initializer
# Uses modern MongoDB 'hello' command for state detection and verification.
# ==============================================================================
#Set bash strict mode 
set -euo pipefail
#MongoDB connection parameters with defaults
MONGO_HOST="${MONGO_HOST:-mongo}"
MONGO_PORT="${MONGO_PORT:-27017}"
REPLICA_SET_NAME="${REPLICA_SET_NAME:-rs0}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-60}"
#echo script start time and complete
echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") Starting replica-set initialization on ${MONGO_HOST}:${MONGO_PORT}..."

# Step 1: Wait for MongoDB instance to accept connections
start_time=$(date +%s)
connected=false

while [ "$connected" = false ]; do
  if mongosh --host "${MONGO_HOST}:${MONGO_PORT}" --quiet --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
    connected=true
    echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") MongoDB is reachable and accepting connections."
  else
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))
    if [ "$elapsed" -ge "$MAX_WAIT_SECONDS" ]; then
      echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") ERROR: Timed out after ${MAX_WAIT_SECONDS}s waiting for MongoDB to become reachable." >&2
      exit 1
    fi
    echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") Waiting for MongoDB to accept connections... (${elapsed}s elapsed)"
    sleep 2
  fi
done

# Step 2: Check current replica-set status using modern 'hello' command
echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") Inspecting replica-set status using 'hello' command..."

HELLO_RESULT=$(mongosh --host "${MONGO_HOST}:${MONGO_PORT}" --quiet --eval "
  try {
    const res = db.runCommand({ hello: 1 });
    print(JSON.stringify({
      setName: res.setName || null,
      isWritablePrimary: !!res.isWritablePrimary,
      secondary: !!res.secondary,
      msg: res.msg || null
    }));
  } catch (err) {
    print(JSON.stringify({ error: err.message }));
  }
")
#echo the diagnostic result for debugging
echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") Diagnostic status: ${HELLO_RESULT}"

IS_INITIALIZED=$(echo "${HELLO_RESULT}" | grep -o '"setName":"[^"]*"' || true)

if [ -n "$IS_INITIALIZED" ]; then
  echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") Replica set is already initialized (${IS_INITIALIZED})."
else
  echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") Initializing replica set '${REPLICA_SET_NAME}' with member '${MONGO_HOST}:${MONGO_PORT}'..."
  INIT_OUTPUT=$(mongosh --host "${MONGO_HOST}:${MONGO_PORT}" --quiet --eval "
    try {
      const result = rs.initiate({
        _id: '${REPLICA_SET_NAME}',
        members: [{ _id: 0, host: '${MONGO_HOST}:${MONGO_PORT}' }]
      });
      print(JSON.stringify(result));
    } catch (e) {
      if (e.code === 23 || (e.message && e.message.includes('already initialized'))) {
        print(JSON.stringify({ ok: 1, info: 'AlreadyInitialized' }));
      } else {
        print(JSON.stringify({ ok: 0, error: e.message, code: e.code }));
      }
    }
  ")
  echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") rs.initiate() result: ${INIT_OUTPUT}"
fi

# Step 3: Wait for node to be elected as writable PRIMARY
echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") Waiting for replica set node to elect PRIMARY..."

primary_elected=false
poll_start=$(date +%s)
#while loop to poll the node's state until it becomes PRIMARY or timeout occurs and exit with error
while [ "$primary_elected" = false ]; do
  IS_PRIMARY=$(mongosh --host "${MONGO_HOST}:${MONGO_PORT}" --quiet --eval "
    try {
      const res = db.runCommand({ hello: 1 });
      print(res.isWritablePrimary === true ? 'PRIMARY' : 'PENDING');
    } catch (err) {
      print('ERROR');
    }
  " | tr -d '[:space:]')

  if [ "$IS_PRIMARY" = "PRIMARY" ]; then
    primary_elected=true
    echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") SUCCESS: Node is verified as writable PRIMARY for replica set '${REPLICA_SET_NAME}'."
  else
    current_time=$(date +%s)
    elapsed=$((current_time - poll_start))
    if [ "$elapsed" -ge "$MAX_WAIT_SECONDS" ]; then
      echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") ERROR: PRIMARY election timed out after ${MAX_WAIT_SECONDS}s. Current state: ${IS_PRIMARY}" >&2
      exit 1
    fi
    echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") Election in progress (status: ${IS_PRIMARY}, ${elapsed}s elapsed)..."
    sleep 2
  fi
done

echo "[mongo-init] $(date -u +"%Y-%m-%dT%H:%M:%SZ") MongoDB replica-set initialization finished successfully."
exit 0
