/**
 * Skeleton of the CLI reader. Reads feedback across every tenant with an owner/bypass
 * database role and saves screenshots next to the printed notes.
 *
 *   feedback list [--status open|planned|done|wont_do|all] [--out <dir>] [--limit n]
 *   feedback mark <status> <id> [<id> ...]
 *
 * Ids may be shortened to their last 8 characters. Adapt `query`, `update` and
 * `downloadObject` to your database client and object store.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STATUSES = ['open', 'planned', 'done', 'wont_do'] as const;
type Status = (typeof STATUSES)[number];

type Row = {
  id: string; created_at: Date; status: string; kind: string | null; screen: string | null; route: string | null;
  rating: number | null; comment: string | null; app_version: string | null; platform: string | null;
  sender: string | null; tenant: string | null; file_key: string | null;
};

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const short = (id: string) => id.slice(-8);

async function list(args: string[]) {
  const status = option(args, 'status') ?? 'open';
  if (status !== 'all' && !STATUSES.includes(status as Status)) throw new Error(`Unknown status "${status}".`);
  const out = option(args, 'out') ?? join(tmpdir(), 'app-feedback');
  const limit = Number(option(args, 'limit') ?? 50);
  mkdirSync(out, { recursive: true });

  const rows = await query<Row>(
    `select f.id, f.created_at, f.status, f.kind, f.screen, f.route, f.rating, f.comment, f.app_version, f.platform,
            u.first_name as sender, t.name as tenant, fl.key as file_key
       from feedback_entries f
       left join users u on u.id = f.sender_id
       left join tenants t on t.id = f.tenant_id
       left join files fl on fl.id = f.screenshot_file_id and fl.status = 'uploaded'
      where ($1 = 'all' or f.status = $1)
      order by f.created_at desc
      limit $2`,
    [status, limit],
  );
  if (!rows.length) {
    console.log(`No ${status === 'all' ? '' : `${status} `}feedback.`);
    return;
  }
  for (const r of rows) {
    let shot = '-';
    if (r.file_key) {
      const path = join(out, `${r.id}.${r.file_key.split('.').pop() ?? 'jpg'}`);
      try {
        writeFileSync(path, await downloadObject(r.file_key));
        shot = path;
      } catch (e) {
        shot = `could not download (${e instanceof Error ? e.message : String(e)})`;
      }
    }
    console.log(
      [
        `## ${short(r.id)} · ${r.created_at.toISOString().slice(0, 16).replace('T', ' ')} · ${r.status} · ${r.kind ?? 'note'}${r.rating ? ` · rated ${r.rating}/5` : ''}`,
        `   screen:     ${r.screen ?? '-'}${r.route ? `  (${r.route})` : ''}`,
        `   from:       ${r.sender ?? 'someone'} at ${r.tenant ?? 'an unknown tenant'} · ${r.platform ?? '?'} ${r.app_version ?? ''}`.trimEnd(),
        `   comment:    ${r.comment ?? '(none)'}`,
        `   screenshot: ${shot}`,
        '',
      ].join('\n'),
    );
  }
  console.log(`${rows.length} shown. Screenshots in ${out}`);
}

async function mark(args: string[]) {
  const [status, ...ids] = args;
  if (!STATUSES.includes(status as Status) || !ids.length) throw new Error('Usage: feedback mark <open|planned|done|wont_do> <id> [<id> ...]');
  const updated = await query<{ id: string }>(
    `update feedback_entries set status = $1 where right(id::text, 8) = any($2) returning id`,
    [status, ids.map((id) => id.slice(-8))],
  );
  console.log(`Marked ${updated.length} of ${ids.length} as ${status}: ${updated.map((u) => short(u.id)).join(', ') || 'none found'}`);
}

if (!process.env.DATABASE_OWNER_URL) throw new Error('DATABASE_OWNER_URL is not set (feedback rows are only readable by the owner role).');
const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'list') await list(rest);
  else if (command === 'mark') await mark(rest);
  else console.log('Usage: feedback list [--status open|all|...] [--out dir] [--limit n] | feedback mark <status> <id> ...');
} finally {
  await closeDatabase();
}

// Adapt these to your stack.
declare function query<T>(sql: string, params: unknown[]): Promise<T[]>;
declare function downloadObject(key: string): Promise<Buffer>;
declare function closeDatabase(): Promise<void>;
