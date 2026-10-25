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
import type { JournalEntry, Pin, SpoolPage } from './contract.js';

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

  /**
   *
   */
  newId(): string {
    return `${this.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.spoolDir, { recursive: true, mode: DIR_MODE });
  }

  /** One appendFile write per entry: O_APPEND keeps concurrent writers from interleaving. */
  async append(entry: JournalEntry): Promise<void> {
    await this.ensureDirs();
    await appendFile(this.journalPath, JSON.stringify(entry) + '\n', {
      flag: 'a',
      mode: FILE_MODE,
    });
  }

  /** Yield journal lines newest first, reading the file backwards in chunks. */
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
    const tmp = `${this.pinsPath}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(pins, null, 2), { mode: FILE_MODE });
    await rename(tmp, this.pinsPath);
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
