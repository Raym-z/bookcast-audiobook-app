import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';

// A cron job hits this route to keep the Supabase project active.
// Never cache it, otherwise the request would not reach the database.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' };

/** Shape returned by the public.health_stats() function (see supabase/health_stats.sql). */
interface HealthStats {
  users: number;
  audiobooks: number;
  favorites: number;
  listening_history: number;
}

function secretsMatch(a: string, b: string) {
  const provided = Buffer.from(a);
  const expected = Buffer.from(b);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // Fail closed in production; allow local testing without the env var.
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  // Other schedulers can use `x-cron-secret: <CRON_SECRET>`.
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : null;
  const provided = bearer ?? request.headers.get('x-cron-secret');

  return provided !== null && secretsMatch(provided, secret);
}

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  if (!isAuthorized(request)) {
    return respond({ status: 'unauthorized', error: 'Invalid or missing CRON_SECRET' }, 401);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('health_stats');

  if (!error && data) {
    const stats = data as unknown as HealthStats;

    return respond({
      status: 'ok',
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      database: {
        reachable: true,
        users: stats.users ?? 0,
        audiobooks: stats.audiobooks ?? 0,
        favorites: stats.favorites ?? 0,
        listeningHistory: stats.listening_history ?? 0,
      },
    });
  }

  // health_stats() has not been created yet — fall back to a plain count so the
  // request still counts as database activity.
  const { count, error: countError } = await supabase
    .from('audiobooks')
    .select('id', { count: 'exact', head: true });

  if (countError) {
    return respond(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        database: { reachable: false },
        error: countError.message,
      },
      503
    );
  }

  return respond({
    status: 'degraded',
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    database: { reachable: true, audiobooks: count ?? 0 },
    warnings: [
      `health_stats() RPC failed: ${error?.message ?? 'unknown error'}`,
      'Run supabase/health_stats.sql in the Supabase SQL editor to enable the users, favorites and listening-history counts.',
    ],
  });
}
