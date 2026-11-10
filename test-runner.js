#!/usr/bin/env node

/**
 * CLI Test Matrix Runner
 * Runs the pre-compilation test matrix suite and prints a formatted report
 */

const { TestMatrixRunner } = require('./src/main/testMatrixRunner');

async function main() {
  console.log('\n============================================================');
  console.log('  CLUELY MEETING ASSISTANT - PRE-COMPILATION TEST MATRIX');
  console.log('============================================================\n');

  const runner = new TestMatrixRunner();
  const startTime = Date.now();
  const matrixResult = await runner.runFullMatrix(true, true);
  const elapsed = Date.now() - startTime;

  console.log('Subsystem Benchmarks & Pre-Compilation Verification Checks:\n');

  matrixResult.results.forEach((res, i) => {
    const symbol = res.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${i + 1}] ${res.subsystem.padEnd(16)} | Target: ${res.target}`);
    console.log(`    Input:          ${res.input}`);
    console.log(`    Threshold:      ${res.passThreshold}`);
    console.log(`    Actual Result:  ${res.actualValue} [${symbol}]`);
    console.log('');
  });

  console.log('------------------------------------------------------------');
  console.log(`Overall Status:   ${matrixResult.allPassed ? 'ALL PASS (Ready for production compilation)' : 'FAILURES DETECTED'}`);
  console.log(`Total Time:       ${elapsed}ms`);
  console.log('============================================================\n');

  if (!matrixResult.allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

