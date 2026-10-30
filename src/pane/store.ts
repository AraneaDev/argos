import { randomBytes } from 'node:crypto';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { QueryResult } from '../types/database.js';
import type { JournalEntry, Pin, RoleView, SpoolPage } from './contract.js';
// Type only: the store is also loaded on its own, outside the build, by a multi-process test.
import type { PrivilegeProbe } from '../database/privileges.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const CHUNK = 64 * 1024;
const SPOOL_ROW_BATCH = 1000;
const DAY_MS = 86_400_000;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 *
 */
export function dataDirFor(configPath: string): string {
  return join(dirname(resolve(configPath)), '.argos');
}

export interface StoreLimits {
  spoolBytes?: number;
  spoolDays?: number;
  now?: () => number;
}

/**
 *
 */
export class PaneStore {
  private readonly spoolBytes: number;
  private readonly spoolDays: number;
  private readonly now: () => number;
  private ensured = false;
  private roleChanges: Promise<void> = Promise.resolve();

  constructor(
    private readonly dir: string,
    limits: StoreLimits = {}
  ) {
    this.spoolBytes = limits.spoolBytes ?? 200 * 1024 * 1024;
    this.spoolDays = limits.spoolDays ?? 30;
    this.now = limits.now ?? Date.now;
  }

  private get journalPath(): string {
    return join(this.dir, 'journal.jsonl');
  }
  private get spoolDir(): string {
    return join(this.dir, 'spool');
  }
  private get pinsPath(): string {
    return join(this.dir, 'pins.json');
  }
  private get checksPath(): string {
    return join(this.dir, 'schema-checks.json');
  }
  private get rolesPath(): string {
    return join(this.dir, 'roles.json');
  }

  /**
   *
   */
  newId(): string {
    return `${this.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }

  /**
   * Create the data directory (0700) with its spool folder, and a `.gitignore` of `*` so
   * SQL text and result rows never end up in the repository the config lives in. An
   * existing `.gitignore` is left alone.
   */
  async ensure(): Promise<void> {
    if (this.ensured) return;
    await mkdir(this.spoolDir, { recursive: true, mode: DIR_MODE });
    try {
      await writeFile(join(this.dir, '.gitignore'), '*\n', { flag: 'wx', mode: FILE_MODE });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    this.ensured = true;
  }

  private ensureDirs(): Promise<void> {
    return this.ensure();
  }

  /** One appendFile write per entry: O_APPEND keeps concurrent writers from interleaving. */
  async append(entry: JournalEntry): Promise<void> {
    await this.ensureDirs();
    await appendFile(this.journalPath, JSON.stringify(entry) + '\n', {
      flag: 'a',
      mode: FILE_MODE,
    });
  }

  /**
   * Read journal lines newest first, reading the file backwards in chunks.
   * @yields {string} each line, without its newline
   */
  private async *linesBackwards(): AsyncGenerator<string> {
    let fh;
    try {
      fh = await open(this.journalPath, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    try {
      let pos = (await fh.stat()).size;
      let carry = Buffer.alloc(0);
      while (pos > 0) {
        const size = Math.min(CHUNK, pos);
        pos -= size;
        const buf = Buffer.alloc(size);
        await fh.read(buf, 0, size, pos);
        let data = Buffer.concat([buf, carry]);
        let end = data.length;
        let nl = data.lastIndexOf(0x0a, end - 1);
        while (nl !== -1) {
          if (end > nl + 1) yield data.subarray(nl + 1, end).toString('utf8');
          end = nl;
          nl = end > 0 ? data.lastIndexOf(0x0a, end - 1) : -1;
        }
        carry = data.subarray(0, end);
        data = carry; // release the rest
      }
      if (carry.length > 0) yield carry.toString('utf8');
    } finally {
      await fh.close();
    }
  }

  private async *entriesBackwards(): AsyncGenerator<JournalEntry> {
    for await (const line of this.linesBackwards()) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as JournalEntry;
        if (parsed && typeof parsed.id === 'string') yield parsed;
      } catch {
        // torn or corrupt line: skip
      }
    }
  }

  /**
   *
   */
  async history(opts: { before?: string; limit?: number } = {}): Promise<JournalEntry[]> {
    const limit = opts.limit ?? 50;
    const out: JournalEntry[] = [];
    if (limit <= 0) return out;
    for await (const e of this.entriesBackwards()) {
      if (opts.before !== undefined && !(e.id < opts.before)) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   *
   */
  async entry(id: string): Promise<JournalEntry | null> {
    for await (const e of this.entriesBackwards()) {
      if (e.id === id) return e;
    }
    return null;
  }

  /** Write the spool in row batches so a huge result is not stringified twice over in memory. */
  async writeSpool(id: string, result: QueryResult): Promise<string> {
    if (!SAFE_ID.test(id)) throw new Error(`Invalid spool id: ${id}`);
    await this.ensureDirs();
    const name = `${id}.json`;
    const final = join(this.spoolDir, name);
    const tmp = `${final}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    const fields = result.fields;
    const fh = await open(tmp, 'w', FILE_MODE);
    try {
      await fh.write(
        `{"fields":${JSON.stringify(fields)},"truncated":${result.truncated ? 'true' : 'false'},"rows":[`
      );
      const rows = result.rows;
      for (let i = 0; i < rows.length; i += SPOOL_ROW_BATCH) {
        const batch = rows
          .slice(i, i + SPOOL_ROW_BATCH)
          .map((r) => JSON.stringify(fields.map((f) => r[f] ?? null)))
          .join(',');
        await fh.write((i > 0 ? ',' : '') + batch);
      }
      await fh.write(']}');
    } catch (err) {
      await fh.close();
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
    await fh.close();
    await rename(tmp, final);
    await this.evict(name);
    return name;
  }

  /**
   *
   */
  async readSpool(id: string, offset = 0, limit = 200): Promise<SpoolPage | null> {
    if (!SAFE_ID.test(id)) return null;
    let raw: string;
    try {
      raw = await readFile(join(this.spoolDir, `${id}.json`), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    let data: { fields: string[]; rows: unknown[][]; truncated: boolean };
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    const start = Math.max(0, offset);
    return {
      id,
      fields: data.fields,
      rows: data.rows.slice(start, start + Math.max(0, limit)),
      total: data.rows.length,
      offset: start,
      truncated: !!data.truncated,
    };
  }

  /** When this connection's schema fingerprint was last checked by any process (epoch ms). */
  async fingerprintCheckedAt(database: string): Promise<number | undefined> {
    const t = (await this.readChecks())[database];
    return typeof t === 'number' ? t : undefined;
  }

  /** Record a fingerprint check so other processes sharing this directory honour the limit. */
  async recordFingerprintCheck(database: string, at: number): Promise<void> {
    await this.ensureDirs();
    const checks = await this.readChecks();
    checks[database] = at;
    await this.writeAtomic(this.checksPath, JSON.stringify(checks));
  }

  private async readChecks(): Promise<Record<string, unknown>> {
    return this.readJsonObject(this.checksPath);
  }

  /**
   * Change roles.json, one change at a time: each reads the file as the previous
   * change left it, so two checks finishing together cannot overwrite each other.
   * A failed change is the caller's to see; the queue goes on after it.
   */
  private updateRoles(change: (roles: Record<string, unknown>) => boolean): Promise<void> {
    const run = this.roleChanges.then(async () => {
      await this.ensureDirs();
      const roles = await this.readJsonObject(this.rolesPath);
      if (change(roles)) await this.writeAtomic(this.rolesPath, JSON.stringify(roles));
    });
    this.roleChanges = run.catch(() => undefined);
    return run;
  }

  /** Record the MCP server's privilege check of a connection, for the pane to show. */
  recordRole(database: string, probe: PrivilegeProbe): Promise<void> {
    const role: RoleView =
      'canWrite' in probe
        ? {
            checkedAt: probe.checkedAt,
            canWrite: probe.canWrite,
            principal: probe.principal,
            reasons: probe.reasons,
          }
        : { checkedAt: probe.checkedAt, canWrite: null, principal: null, reasons: [] };
    return this.updateRoles((roles) => {
      roles[database] = role;
      return true;
    });
  }

  /** Drop a connection's recorded role check, after its config changed or it was removed. */
  forgetRole(database: string): Promise<void> {
    return this.updateRoles((roles) => {
      if (!(database in roles)) return false;
      delete roles[database];
      return true;
    });
  }

  /** Every recorded role check, by database name. A malformed entry is left out. */
  async roles(): Promise<Record<string, RoleView>> {
    const out: Record<string, RoleView> = {};
    for (const [db, raw] of Object.entries(await this.readJsonObject(this.rolesPath))) {
      const r = raw as Partial<RoleView> | null;
      if (
        r &&
        typeof r.checkedAt === 'string' &&
        (r.canWrite === null || typeof r.canWrite === 'boolean') &&
        (r.principal === null || typeof r.principal === 'string') &&
        Array.isArray(r.reasons) &&
        r.reasons.every((x) => typeof x === 'string')
      ) {
        out[db] = {
          checkedAt: r.checkedAt,
          canWrite: r.canWrite,
          principal: r.principal,
          reasons: r.reasons,
        };
      }
    }
    return out;
  }

  private async readJsonObject(path: string): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  /** Write via a temp file and rename, so a concurrent reader never sees a torn file. */
  private async writeAtomic(path: string, text: string): Promise<void> {
    const tmp = `${path}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    await writeFile(tmp, text, { mode: FILE_MODE });
    await rename(tmp, path);
  }

  /**
   *
   */
  async pins(): Promise<Pin[]> {
    try {
      const parsed = JSON.parse(await readFile(this.pinsPath, 'utf8'));
      return Array.isArray(parsed) ? (parsed as Pin[]) : [];
    } catch {
      return [];
    }
  }

  private async savePins(pins: Pin[]): Promise<void> {
    await this.ensureDirs();
    await this.writeAtomic(this.pinsPath, JSON.stringify(pins, null, 2));
  }

  /**
   *
   */
  async pin(p: Omit<Pin, 'id' | 'createdAt'>): Promise<Pin> {
    const pins = await this.pins();
    const created: Pin = { ...p, id: this.newId(), createdAt: new Date(this.now()).toISOString() };
    pins.push(created);
    await this.savePins(pins);
    return created;
  }

  /** Point every pin with this exact database and SQL at its newest journal entry. */
  async touchPins(database: string, sql: string, journalId: string): Promise<void> {
    const pins = await this.pins();
    let changed = false;
    for (const p of pins) {
      if (p.database === database && p.sql === sql) {
        p.lastJournalId = journalId;
        changed = true;
      }
    }
    if (changed) await this.savePins(pins);
  }

  /**
   *
   */
  async unpin(id: string): Promise<boolean> {
    const pins = await this.pins();
    const next = pins.filter((p) => p.id !== id);
    if (next.length === pins.length) return false;
    await this.savePins(next);
    return true;
  }

  /** Remove spools past the age or size cap, oldest first, keeping any a pin references. Returns the count removed. */
  async evict(keep?: string): Promise<number> {
    let names: string[];
    try {
      names = (await readdir(this.spoolDir)).filter((n) => n.endsWith('.json'));
    } catch {
      return 0;
    }
    const pinned = new Set(
      (await this.pins()).filter((p) => p.lastJournalId).map((p) => `${p.lastJournalId}.json`)
    );
    const files: { name: string; size: number; mtime: number }[] = [];
    for (const name of names) {
      try {
        const s = await stat(join(this.spoolDir, name));
        files.push({ name, size: s.size, mtime: s.mtimeMs });
      } catch {
        // vanished
      }
    }
    files.sort((a, b) => a.mtime - b.mtime || (a.name < b.name ? -1 : 1));
    const cutoff = this.now() - this.spoolDays * DAY_MS;
    let total = files.reduce((n, f) => n + f.size, 0);
    let removed = 0;
    for (const f of files) {
      if (pinned.has(f.name) || f.name === keep) continue;
      if (f.mtime < cutoff || total > this.spoolBytes) {
        try {
          await unlink(join(this.spoolDir, f.name));
          total -= f.size;
          removed++;
        } catch {
          // already gone
        }
      }
    }
    return removed;
  }
}
