#!/usr/bin/env bash
#
# check-proto.sh -- drift guard.
#
# Regenerates the bindings into a temporary file and diffs them against the
# committed src/generated/geode.ts. Fails (exit 1) if they differ, meaning the
# generated bindings are stale relative to the proto and `npm run proto` must be
# re-run and the result committed.
#
# CI-safe: no network, no server. Requires protoc + the ts-proto plugin (same as
# `npm run proto`). The vendored proto is used as the source; the canonical sync
# step in generate-proto.sh is skipped here so this check is purely about whether
# the committed generated file matches the committed proto.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMMITTED="${PROJECT_DIR}/src/generated/geode.ts"

export PATH="${HOME}/.local/bin:${PROJECT_DIR}/.tools/protoc/bin:${PATH}"

PLUGIN="${PROJECT_DIR}/node_modules/.bin/protoc-gen-ts_proto"
VENDORED_PROTO="${PROJECT_DIR}/proto/geode.proto"

if ! command -v protoc >/dev/null 2>&1; then
  echo "error: protoc not found on PATH. Run scripts/install-protoc.sh first." >&2
  exit 1
fi
if [ ! -x "$PLUGIN" ]; then
  echo "error: ts-proto plugin not found at ${PLUGIN}. Run 'npm install'." >&2
  exit 1
fi
if [ ! -f "$COMMITTED" ]; then
  echo "error: committed bindings missing at ${COMMITTED}. Run 'npm run proto'." >&2
  exit 1
fi

TMP_OUT="$(mktemp -d)"
trap 'rm -rf "$TMP_OUT"' EXIT

TS_PROTO_OPTS="esModuleInterop=true,importSuffix=.js,forceLong=number,outputServices=false,useOptionals=messages,snakeToCamel=true,unrecognizedEnum=false"

protoc \
  --plugin="protoc-gen-ts_proto=${PLUGIN}" \
  --ts_proto_out="$TMP_OUT" \
  --ts_proto_opt="$TS_PROTO_OPTS" \
  --proto_path="${PROJECT_DIR}/proto" \
  "$VENDORED_PROTO"

if diff -u "$COMMITTED" "${TMP_OUT}/geode.ts"; then
  echo "OK: generated bindings are up to date with proto/geode.proto"
else
  echo "error: src/generated/geode.ts is stale. Run 'npm run proto' and commit the result." >&2
  exit 1
fi
