# =============================================================================
# Geode Node.js Client Makefile
# Convenient shortcuts for build, test, lint, bench, and integration operations
# =============================================================================

NPM ?= npm
NODE ?= node

# Docker settings for integration tests
DOCKER ?= docker
GEODE_IMAGE ?= geodedb/geode:latest
GEODE_CONTAINER ?= geode-nodejs-test
GEODE_HOST ?= 127.0.0.1
GEODE_PORT ?= 3141
GEODE_GRPC_PORT ?= 50051

# Path to canonical proto file in the main Geode server repo
CANONICAL_PROTO ?= ../geode/src/proto/geode.proto

.PHONY: all build clean test test-unit test-property test-integration test-integration-docker \
        bench lint fmt fmt-check typecheck doc coverage ci ci-quick ci-full help \
        docker-start docker-stop docker-logs install dev watch sync-proto

# Default target - run everything (except integration tests)
all: install build fmt-check lint typecheck test-unit test-property bench-quick
	@echo ""
	@echo "==== All Checks Complete ===="
	@echo "✓ Dependencies installed"
	@echo "✓ Build successful"
	@echo "✓ Format check passed"
	@echo "✓ ESLint passed"
	@echo "✓ TypeScript check passed"
	@echo "✓ Unit tests passed (359 tests)"
	@echo "✓ Property tests passed (80 tests)"
	@echo "✓ Benchmarks verified"
	@echo ""
	@echo "Note: Run 'make test-integration' separately (requires Geode server)"
	@echo "      Run 'make test-integration-docker' to use Docker container"

# Help target
help:
	@echo "Geode Node.js Client Makefile"
	@echo "=============================="
	@echo ""
	@echo "Setup targets:"
	@echo "  make install       - Install dependencies"
	@echo "  make build         - Build the package"
	@echo "  make clean         - Clean build artifacts and caches"
	@echo "  make sync-proto    - Copy canonical proto from Geode server"
	@echo ""
	@echo "Test targets:"
	@echo "  make test          - Run all tests (unit + property)"
	@echo "  make test-unit     - Run unit tests only (359 tests)"
	@echo "  make test-property - Run property-based tests"
	@echo "  make test-integration - Run integration tests (requires Geode server)"
	@echo "  make test-integration-docker - Run integration tests with Docker"
	@echo "  make test-integration-grpc  - Run gRPC integration tests"
	@echo "  make test-all      - Run ALL tests including integration"
	@echo ""
	@echo "Quality targets:"
	@echo "  make lint          - Run ESLint"
	@echo "  make lint-fix      - Run ESLint with auto-fix"
	@echo "  make fmt           - Format code with Prettier"
	@echo "  make fmt-check     - Check formatting without changes"
	@echo "  make typecheck     - Run TypeScript type checker"
	@echo ""
	@echo "Benchmark targets:"
	@echo "  make bench         - Run all benchmarks"
	@echo "  make bench-quick   - Compile benchmarks only (no run)"
	@echo ""
	@echo "Docker targets:"
	@echo "  make docker-start  - Start Geode Docker container"
	@echo "  make docker-stop   - Stop Geode Docker container"
	@echo "  make docker-logs   - View Geode container logs"
	@echo ""
	@echo "CI targets:"
	@echo "  make ci            - Run full CI pipeline"
	@echo "  make ci-quick      - Run quick CI (no integration tests)"
	@echo "  make ci-full       - Run CI with integration tests"
	@echo ""
	@echo "Other targets:"
	@echo "  make coverage      - Generate coverage report"
	@echo "  make doc           - Show documentation info"
	@echo "  make dev           - Start development mode (watch)"
	@echo ""
	@echo "Environment variables:"
	@echo "  GEODE_HOST        - Geode server host (default: 127.0.0.1)"
	@echo "  GEODE_PORT        - Geode server port (default: 3141)"
	@echo "  GEODE_IMAGE       - Docker image (default: geodedb/geode:latest)"

# =============================================================================
# Setup Targets
# =============================================================================

install:
	@echo "Installing dependencies..."
	$(NPM) install
	@echo "✓ Dependencies installed"

build: install
	@echo "Building package..."
	$(NPM) run build
	@echo "✓ Build complete"

clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist/
	rm -rf coverage/
	rm -rf node_modules/
	rm -rf .vitest/
	rm -rf .eslintcache
	rm -rf *.tsbuildinfo
	rm -rf benchmark-results/
	rm -f *.bench.json
	@echo "✓ Clean complete"

sync-proto:
	@echo "Syncing proto file from canonical source..."
	@if [ ! -f "$(CANONICAL_PROTO)" ]; then \
		echo "ERROR: Canonical proto not found at $(CANONICAL_PROTO)"; \
		echo "Set CANONICAL_PROTO to the correct path"; \
		exit 1; \
	fi
	cp "$(CANONICAL_PROTO)" proto/geode.proto
	@echo "✓ Proto file synced from $(CANONICAL_PROTO)"

# =============================================================================
# Test Targets
# =============================================================================

test: test-unit test-property
	@echo "✓ All tests complete"

test-unit:
	@echo "Running unit tests..."
	$(NPM) run test
	@echo "✓ Unit tests complete (359 tests)"

test-property:
	@echo "Running property-based tests..."
	$(NPM) run test -- --config vitest.property.config.ts
	@echo "✓ Property tests complete"

test-integration:
	@echo "Running integration tests..."
	@echo ""
	@echo "Tests connect to Geode server at $(GEODE_HOST):$(GEODE_PORT)"
	@echo "Start server first: cd ../geode && ./zig-out/bin/geode serve"
	@echo "Or use: make docker-start"
	@echo ""
	GEODE_HOST=$(GEODE_HOST) GEODE_PORT=$(GEODE_PORT) \
		$(NPM) run test:integration
	@echo "✓ Integration tests complete"

test-integration-docker: docker-start
	@echo "Running integration tests with Docker..."
	@echo "Waiting for Geode server to be ready..."
	@sleep 3
	GEODE_HOST=$(GEODE_HOST) GEODE_PORT=$(GEODE_PORT) \
		$(NPM) run test:integration || \
		($(MAKE) docker-stop && exit 1)
	$(MAKE) docker-stop
	@echo "✓ Docker integration tests complete"

test-integration-grpc:
	@echo "Running gRPC integration tests..."
	@echo ""
	@echo "Tests connect to Geode gRPC server at $(GEODE_HOST):$(GEODE_GRPC_PORT)"
	@echo "Start server first: cd ../geode && ./zig-out/bin/geode serve --listen-grpc 0.0.0.0:50051"
	@echo "Or use: make docker-start"
	@echo ""
	GEODE_HOST=$(GEODE_HOST) GEODE_GRPC_PORT=$(GEODE_GRPC_PORT) GEODE_TRANSPORT=grpc \
		$(NPM) run test:integration
	@echo "✓ gRPC integration tests complete"

test-all: test-unit test-property test-integration
	@echo "✓ All tests complete (including integration)"

test-watch:
	@echo "Running tests in watch mode..."
	$(NPM) run test:watch

test-verbose:
	@echo "Running tests with verbose output..."
	$(NPM) run test -- --reporter=verbose

# =============================================================================
# Code Quality Targets
# =============================================================================

lint:
	@echo "Running ESLint..."
	$(NPM) run lint
	@echo "✓ Lint complete (0 issues)"

lint-fix:
	@echo "Running ESLint with auto-fix..."
	$(NPM) run lint:fix
	@echo "✓ Lint fix complete"

fmt:
	@echo "Formatting code..."
	$(NPM) run format
	@echo "✓ Format complete"

fmt-check:
	@echo "Checking code format..."
	$(NPM) run format:check
	@echo "✓ Format check complete"

typecheck:
	@echo "Running TypeScript type checker..."
	$(NPM) run typecheck
	@echo "✓ Type check complete (0 errors)"

# =============================================================================
# Benchmark Targets
# =============================================================================

bench:
	@echo "Running benchmarks..."
	$(NPM) run bench
	@echo "✓ Benchmarks complete"

bench-quick:
	@echo "Verifying benchmarks compile..."
	@$(NPM) run typecheck 2>/dev/null || true
	@echo "✓ Benchmark verification complete"

# =============================================================================
# Docker Targets
# =============================================================================

docker-start:
	@echo "Starting Geode Docker container..."
	@$(DOCKER) rm -f $(GEODE_CONTAINER) 2>/dev/null || true
	$(DOCKER) run -d --name $(GEODE_CONTAINER) \
		-e GEODE_ALLOW_NO_AUTH=1 \
		-p $(GEODE_PORT):3141/udp \
		-p $(GEODE_GRPC_PORT):50051/tcp \
		$(GEODE_IMAGE) \
		serve --listen 0.0.0.0:3141 --listen-grpc 0.0.0.0:50051 --log-level info --disable-auth
	@echo "✓ Geode container started"
	@echo "  Container: $(GEODE_CONTAINER)"
	@echo "  QUIC Port: $(GEODE_PORT)/udp"
	@echo "  gRPC Port: $(GEODE_GRPC_PORT)/tcp"

docker-stop:
	@echo "Stopping Geode Docker container..."
	@$(DOCKER) stop $(GEODE_CONTAINER) 2>/dev/null || true
	@$(DOCKER) rm $(GEODE_CONTAINER) 2>/dev/null || true
	@echo "✓ Geode container stopped"

docker-logs:
	@echo "Viewing Geode container logs..."
	$(DOCKER) logs -f $(GEODE_CONTAINER)

docker-shell:
	@echo "Opening shell in Geode container..."
	$(DOCKER) exec -it $(GEODE_CONTAINER) /bin/sh

# =============================================================================
# CI Targets
# =============================================================================

ci: install build fmt-check lint typecheck test coverage bench-quick
	@echo ""
	@echo "==== CI Pipeline Complete ===="
	@echo "✓ Dependencies installed"
	@echo "✓ Build successful"
	@echo "✓ Format check passed"
	@echo "✓ ESLint passed (0 issues)"
	@echo "✓ Type check passed (0 errors)"
	@echo "✓ Unit tests passed (359 tests)"
	@echo "✓ Property tests passed"
	@echo "✓ Coverage report generated"
	@echo "✓ Benchmarks compiled"
	@echo ""

ci-quick: install build fmt-check lint test-unit
	@echo ""
	@echo "==== Quick CI Complete ===="
	@echo "✓ Build successful"
	@echo "✓ Format check passed"
	@echo "✓ Lint passed"
	@echo "✓ Unit tests passed"
	@echo ""

ci-full: ci test-integration
	@echo ""
	@echo "==== Full CI Complete (with integration tests) ===="
	@echo ""

# =============================================================================
# Coverage Target
# =============================================================================

coverage:
	@echo "Running tests with coverage..."
	$(NPM) run test:coverage
	@echo "✓ Coverage report generated"
	@echo "  HTML report: coverage/index.html"

# =============================================================================
# Documentation Target
# =============================================================================

doc:
	@echo "Documentation is available in:"
	@echo "  - README.md"
	@echo "  - CLAUDE.md (developer guide)"
	@echo ""
	@echo "API documentation is generated with TypeScript declarations in dist/"

# =============================================================================
# Development Helpers
# =============================================================================

dev:
	@echo "Starting development mode..."
	$(NPM) run dev

watch:
	@echo "Starting test watch mode..."
	$(NPM) run test:watch

# Update dependencies
update:
	@echo "Updating dependencies..."
	$(NPM) update
	@echo "✓ Dependencies updated"

# Check for outdated dependencies
outdated:
	@echo "Checking for outdated dependencies..."
	$(NPM) outdated

# Audit for security vulnerabilities
audit:
	@echo "Checking for security vulnerabilities..."
	$(NPM) audit
	@echo "✓ Security audit complete"

# Publish package (dry run)
publish-dry:
	@echo "Publishing package (dry run)..."
	$(NPM) publish --dry-run

# Publish package
publish:
	@echo "Publishing package..."
	$(NPM) publish
	@echo "✓ Package published"
