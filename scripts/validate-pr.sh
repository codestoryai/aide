#!/bin/bash
set -e

# Run TypeScript checks
echo "Running TypeScript checks..."
npm run monaco-compile-check
npm run tsec-compile-check
npm run vscode-dts-compile-check

# Run linting
echo "Running linting checks..."
npm run eslint
npm run stylelint

# Run tests
echo "Running tests..."
npm run test-node
npm run test-browser

# Run smoke tests
echo "Running smoke tests..."
npm run smoketest

# Run layer validation
echo "Running layer validation..."
npm run valid-layers-check

# Run hygiene checks
echo "Running hygiene checks..."
npm run hygiene

echo "All checks passed successfully!"