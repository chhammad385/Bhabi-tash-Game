/** Minimal assertion helpers shared by the test files. */

let passed = 0;
let failed = 0;
const failures: string[] = [];

export function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.error(`  ❌ FAILED: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string) {
  assert(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  );
}

export async function assertRejects(fn: () => Promise<unknown>, message: string) {
  try {
    await fn();
    assert(false, message);
  } catch {
    assert(true, message);
  }
}

export function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

export function summary(): number {
  console.log('\n' + '='.repeat(60));
  if (failed === 0) {
    console.log(`🎉 ALL ${passed} ASSERTIONS PASSED`);
    console.log('='.repeat(60));
    return 0;
  }
  console.error(`${passed} passed, ${failed} FAILED`);
  failures.forEach(f => console.error(`   - ${f}`));
  console.log('='.repeat(60));
  return 1;
}

export function resetCounters() {
  passed = 0;
  failed = 0;
  failures.length = 0;
}
