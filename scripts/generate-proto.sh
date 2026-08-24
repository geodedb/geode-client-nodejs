#!/usr/bin/env bash
#
# generate-proto.sh
#
# Generates the TypeScript protobuf bindings (src/generated/geode.ts) from the
# canonical geode server proto using protoc + ts-proto.
#
# Pipeline:
#   1. Copy the canonical proto (../geode/src/proto/geode.proto) into the
#      vendored location (proto/geode.proto). If the canonical proto is missing
#      (e.g. CI without the sibling server repo checked out), the existing
#      vendored proto is kept and a warning is emitted -- generation still runs
#      against the vendored copy so the build is reproducible offline.
#   2. Run protoc with the ts-proto plugin to (re)generate src/generated/geode.ts.
#
# ts-proto options are pinned for ESM correctness (NodeNext module resolution):
#   - esModuleInterop=true    : default-import interop for generated helpers
#   - importSuffix=.js        : emit .js suffixes on relative imports so the
#                               ESM-only build resolves under NodeNext
#   - forceLong=bigint        : int64/uint64 decode to JS bigint. `number` is NOT
#                               usable here: ts-proto's longToNumber THROWS for
#                               any value above 2^53, and server-assigned graph
#                               ids routinely exceed that (ENG-3908). proto.ts
#                               narrows bigints back to `number` at the JS
#                               boundary when they are safe integers.
#   - outputServices=false    : no gRPC service stubs (wire codec only)
#   - useOptionals=messages   : message-typed (incl. oneof) fields are optional,
#                               matching the hand-written interface shape
#   - oneof=unions is NOT used : keep flat optional oneof fields (e.g. msg.hello?)
#                               so the existing public API/consumers are unchanged
#
# An optional first argument overrides the output path (used by proto:check to
# regenerate into a temp file for drift detection).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

CANONICAL_PROTO="${PROJECT_DIR}/../geode/src/proto/geode.proto"
VENDORED_PROTO="${PROJECT_DIR}/proto/geode.proto"
OUT_FILE="${1:-${PROJECT_DIR}/src/generated/geode.ts}"

# Ensure the locally-installed protoc is on PATH (see scripts/install-protoc.sh).
export PATH="${HOME}/.local/bin:${PROJECT_DIR}/.tools/protoc/bin:${PATH}"

if ! command -v protoc >/dev/null 2>&1; then
  echo "error: protoc not found on PATH. Run scripts/install-protoc.sh first." >&2
  exit 1
fi

PLUGIN="${PROJECT_DIR}/node_modules/.bin/protoc-gen-ts_proto"
if [ ! -x "$PLUGIN" ]; then
  echo "error: ts-proto plugin not found at ${PLUGIN}. Run 'npm install'." >&2
  exit 1
fi

# Step 1: sync the vendored proto from canonical (guarded).
mkdir -p "${PROJECT_DIR}/proto"
if [ -f "$CANONICAL_PROTO" ]; then
  cp "$CANONICAL_PROTO" "$VENDORED_PROTO"
  echo "Synced vendored proto from canonical: ${CANONICAL_PROTO}"
else
  echo "warning: canonical proto not found at ${CANONICAL_PROTO}; keeping vendored ${VENDORED_PROTO}" >&2
fi

if [ ! -f "$VENDORED_PROTO" ]; then
  echo "error: no proto available to generate from (${VENDORED_PROTO} missing)." >&2
  exit 1
fi

# Step 2: generate the TypeScript bindings.
OUT_DIR="$(dirname "$OUT_FILE")"
mkdir -p "$OUT_DIR"

TS_PROTO_OPTS="esModuleInterop=true,importSuffix=.js,forceLong=bigint,outputServices=false,useOptionals=messages,snakeToCamel=true,unrecognizedEnum=false"

# protoc emits to <out>/<path-relative-to-proto-root>.ts. We point the proto
# root at proto/ so it emits geode.ts directly into a temp dir, then move it to
# the requested OUT_FILE.
TMP_OUT="$(mktemp -d)"
trap 'rm -rf "$TMP_OUT"' EXIT

protoc \
  --plugin="protoc-gen-ts_proto=${PLUGIN}" \
  --ts_proto_out="$TMP_OUT" \
  --ts_proto_opt="$TS_PROTO_OPTS" \
  --proto_path="${PROJECT_DIR}/proto" \
  "$VENDORED_PROTO"

mv "${TMP_OUT}/geode.ts" "$OUT_FILE"

echo "Generated ${OUT_FILE}"
