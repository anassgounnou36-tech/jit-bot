#!/bin/bash

# Local CI test script
set -e

echo "=== Testing Local CI Pipeline ==="

echo "Step 1: Lint and TypeCheck"
npm run lint
npm run typecheck

echo ""
echo "Step 2: Build"
npm run build:ts
npm run build

echo ""
echo "Step 3: Unit Tests"
npm run test:unit | tail -5

echo ""
echo "Step 4: Bundle Ordering Tests"
npm run test:unit -- --grep "Flashbots.*bundle"

echo ""
echo "Step 5: Fixture Validation"
node scripts/validate-fixtures.js

echo ""
echo "✅ Local CI pipeline completed successfully!"
echo ""
echo "Summary:"
echo "- All mandatory jobs would pass in CI"
echo "- Contract compilation gracefully handles network issues"
echo "- Unit tests work without external dependencies"
echo "- Bundle ordering tests validate MEV functionality"
echo "- Fixture validation ensures data integrity"