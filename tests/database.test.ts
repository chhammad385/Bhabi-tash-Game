/**
 * Database tests against an in-memory PostgreSQL emulator (pg-mem).
 *
 * These verify the schema/query fixes that previously caused completed games
 * to be silently discarded:
 *   - game_histories.game_id must carry a UNIQUE constraint, otherwise
 *     "ON CONFLICT (game_id)" raises SQLSTATE 42P10 at runtime.
 *   - history + statistics must be written atomically.
 *   - replaying the same game must not double-count statistics.
 */
import { newDb } from 'pg-mem';
import { assert, assertEqual, section } from './helpers';

/** The persistent-schema DDL, mirroring server/db.ts. */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) UNIQUE NOT NULL,
    player_id VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    avatar VARCHAR(64) DEFAULT 'avatar-1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS game_histories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id VARCHAR(64) NOT NULL UNIQUE,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    duration INT NOT NULL,
    bhabhi_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    winner_order JSONB NOT NULL,
    player_count INT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS player_statistics (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    games_played INT DEFAULT 0,
    games_completed INT DEFAULT 0,
    times_first INT DEFAULT 0,
    times_bhabhi INT DEFAULT 0,
    average_position FLOAT DEFAULT 0.0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
`;

export async function runDatabaseTests() {
  const mem = newDb({ noAstCoverageCheck: true });
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid' as any,
    // impure: a fresh value per call, otherwise pg-mem memoizes one UUID.
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();

  section('Schema creation');
  await pool.query(SCHEMA);
  assert(true, 'persistent schema applies cleanly');

  // Re-applying must be idempotent (the server runs this on every boot).
  await pool.query(SCHEMA);
  assert(true, 'schema is idempotent — safe to re-run on every deploy');

  section('game_histories.game_id UNIQUE constraint (the ON CONFLICT bug)');

  const users: string[] = [];
  for (const name of ['ann', 'ben', 'cal']) {
    const r = await pool.query(
      `INSERT INTO users (username, player_id, password_hash, display_name)
       VALUES ($1, $2, 'x', $1) RETURNING id`,
      [name, `BHABHI-${name.toUpperCase()}`]
    );
    users.push(r.rows[0].id);
  }

  const rankings = [
    { userId: users[0], position: 1, isBhabhi: false, isBot: false },
    { userId: users[1], position: 2, isBhabhi: false, isBot: false },
    { userId: users[2], position: 3, isBhabhi: true, isBot: false },
  ];

  async function recordGame(gameId: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO game_histories (game_id, duration, player_count, bhabhi_user_id, winner_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (game_id) DO NOTHING
         RETURNING id`,
        [gameId, 120, 3, users[2], JSON.stringify(rankings)]
      );
      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        return false;
      }
      for (const r of rankings) {
        await client.query(
          `INSERT INTO player_statistics (user_id, games_played, games_completed, times_first, times_bhabhi, average_position)
           VALUES ($1, 1, 1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE SET
             games_played = player_statistics.games_played + 1,
             games_completed = player_statistics.games_completed + 1,
             times_first = player_statistics.times_first + $2,
             times_bhabhi = player_statistics.times_bhabhi + $3,
             average_position = ((player_statistics.average_position * player_statistics.games_completed) + $4) / (player_statistics.games_completed + 1),
             updated_at = NOW()`,
          [r.userId, r.position === 1 ? 1 : 0, r.isBhabhi ? 1 : 0, r.position]
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Before the fix this threw: "there is no unique or exclusion constraint
  // matching the ON CONFLICT specification".
  let conflictError: string | null = null;
  let firstWrite = false;
  try {
    firstWrite = await recordGame('game_alpha');
  } catch (err) {
    conflictError = (err as Error).message;
  }
  assertEqual(conflictError, null, 'ON CONFLICT (game_id) executes without SQLSTATE 42P10');
  assert(firstWrite, 'a completed game is recorded');

  section('Game history and statistics are persisted');

  const hist = await pool.query('SELECT * FROM game_histories WHERE game_id = $1', ['game_alpha']);
  assertEqual(hist.rowCount, 1, 'the game history row exists');
  assertEqual(hist.rows[0].player_count, 3, 'player count is stored');
  assertEqual(hist.rows[0].bhabhi_user_id, users[2], 'the Bhabhi is recorded');

  const stats = await pool.query('SELECT * FROM player_statistics ORDER BY times_first DESC');
  assertEqual(stats.rowCount, 3, 'statistics were written for all three players');

  const winner = stats.rows.find((r: any) => r.user_id === users[0]);
  assertEqual(Number(winner.times_first), 1, 'the winner has one first-place finish');
  assertEqual(Number(winner.games_completed), 1, 'the winner has one completed game');

  const bhabhi = stats.rows.find((r: any) => r.user_id === users[2]);
  assertEqual(Number(bhabhi.times_bhabhi), 1, 'the Bhabhi has one recorded loss');
  assertEqual(Number(bhabhi.times_first), 0, 'the Bhabhi has no first-place finishes');

  section('Duplicate game-over is not recorded twice');

  await recordGame('game_alpha');

  const histCount = await pool.query('SELECT COUNT(*)::int AS c FROM game_histories');
  assertEqual(histCount.rows[0].c, 1, 'a replayed gameId does NOT create a second history row');

  /*
   * The statistics guard relies on "INSERT ... ON CONFLICT DO NOTHING
   * RETURNING id" reporting ZERO rows when the insert was skipped, which is
   * PostgreSQL's documented behaviour. pg-mem does not emulate that: it
   * reports the conflicting row instead. We assert the emulator's deviation
   * explicitly so this test starts failing (and gets tightened) if pg-mem is
   * ever fixed — rather than silently pretending the guard was verified here.
   */
  const probe = await pool.query(
    `INSERT INTO game_histories (game_id, duration, player_count, bhabhi_user_id, winner_order)
     VALUES ('game_alpha', 1, 1, NULL, '[]'::jsonb)
     ON CONFLICT (game_id) DO NOTHING
     RETURNING id`
  );
  const emulatorReturnsRow = (probe.rowCount ?? 0) > 0;
  assert(
    emulatorReturnsRow,
    'KNOWN pg-mem LIMITATION: emulator returns a row on DO NOTHING (real PostgreSQL returns none) ' +
      '— the double-count guard must be confirmed against live Neon'
  );

  section('A second, distinct game accumulates correctly');

  const beforeBeta = await pool.query('SELECT * FROM player_statistics WHERE user_id = $1', [users[0]]);
  const completedBefore = Number(beforeBeta.rows[0].games_completed);

  await recordGame('game_beta');

  const acc = await pool.query('SELECT * FROM player_statistics WHERE user_id = $1', [users[0]]);
  assertEqual(
    Number(acc.rows[0].games_completed),
    completedBefore + 1,
    'a distinct game increments the completed counter exactly once'
  );

  const histTotal = await pool.query('SELECT COUNT(*)::int AS c FROM game_histories');
  assertEqual(histTotal.rows[0].c, 2, 'two distinct games produce exactly two history rows');

  section('Statistics aggregate correctly across games');

  const all = await pool.query('SELECT * FROM player_statistics ORDER BY user_id');
  assertEqual(all.rowCount, 3, 'every player still has exactly one statistics row');
  all.rows.forEach((r: any) => {
    assert(
      Number(r.average_position) >= 1 && Number(r.average_position) <= 3,
      `average finishing position for ${r.user_id.slice(0, 8)} stays within 1..3 (got ${r.average_position})`
    );
  });

  section('Transient trick state is NOT persisted (Neon optimization)');

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const names = tables.rows.map((r: any) => r.table_name);
  assert(!names.includes('temp_game_sars'), 'the per-trick temp_game_sars table no longer exists');
  assert(names.includes('game_histories'), 'durable game history is still stored');
  assert(names.includes('player_statistics'), 'durable statistics are still stored');

  await pool.end();
}
