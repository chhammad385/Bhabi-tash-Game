/**
 * Test entry point.
 *
 * A JWT_SECRET is required for the server modules to load. Tests supply their
 * own throwaway secret so the suite never depends on a developer's .env.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-only-secret-not-used-in-production-0123456789abcdef';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

import { summary, section } from './helpers';

async function main() {
  console.log('='.repeat(60));
  console.log('BHABHI — TEST SUITE');
  console.log('='.repeat(60));

  console.log('\n########## GAME ENGINE & RULES ##########');
  const { runEngineTests } = await import('./game-engine.test');
  runEngineTests();

  const { runGameRuleTests } = await import('./game-rules.test');
  runGameRuleTests();

  console.log('\n########## SECURITY & ANTI-CHEAT ##########');
  const { runSecurityTests } = await import('./security.test');
  runSecurityTests();

  console.log('\n########## DATABASE (in-memory PostgreSQL) ##########');
  const { runDatabaseTests } = await import('./database.test');
  await runDatabaseTests();

  console.log('\n########## SOCKET / MULTIPLAYER (3 SESSIONS) ##########');
  const { runSocketTests } = await import('./socket.test');
  await runSocketTests();

  section('Done');
  const code = summary();
  process.exit(code);
}

main().catch(err => {
  console.error('\nTest runner crashed:', err);
  process.exit(1);
});
