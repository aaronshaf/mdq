# ADR 0008: bunfig.toml Configuration

## Status

Accepted

## Context

Bun uses `bunfig.toml` for runtime and test configuration. Need to define our configuration.

## Decision

Use bunfig.toml for test configuration and runtime settings, matching cn patterns.

## Configuration

### bunfig.toml
```toml
[test]
# Coverage settings
coverage = true
coverageDir = "./coverage"

[install]
# Use exact versions for reproducibility
exact = true
```

## Key Settings

### Coverage Directory

```toml
coverageDir = "./coverage"
```

Standard location for coverage reports, gitignored.

### Exact Versions

```toml
[install]
exact = true
```

Ensures `bun add` uses exact versions, improving reproducibility.

## Test Execution

Combined with package.json scripts:

```json
{
  "scripts": {
    "test": "BUN_TEST_JOBS=1 NODE_ENV=test bun test",
    "test:coverage": "BUN_TEST_JOBS=1 NODE_ENV=test bun test --coverage"
  }
}
```

**Why `BUN_TEST_JOBS=1`?**
- Serial test execution
- More predictable test output
- Avoids potential race conditions with shared resources

**Why `NODE_ENV=test`?**
- Signals test environment to code
- Enables test-only behaviors if needed

## Consequences

### Positive
- Consistent test environment
- Reproducible builds with exact versions
- Standard coverage output location

### Negative
- Serial tests are slower than parallel
- Must remember to use env vars for test commands
