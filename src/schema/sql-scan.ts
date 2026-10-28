/**
 * A conservative, dialect-agnostic scan of a SQL statement for the table and
 * column names it mentions. It is not a parser: whatever it can't place with
 * certainty makes the statement uncheckable, so a caller never blocks on a
 * guess.
 */

export interface TableRef {
  schema: string | null;
  name: string;
  quoted: boolean;
  alias: string | null;
}
export interface ColumnRef {
  qualifier: string | null;
  name: string;
  quoted: boolean;
}
export interface ScanResult {
  /** SELECT / WITH…SELECT / EXPLAIN of those, and the scan placed every token. */
  checkable: boolean;
  /** Single SELECT; no subqueries, CTEs, derived tables, table functions, VALUES, LATERAL, NATURAL. */
  simple: boolean;
  ctes: string[];
  /** Aliases of subqueries / table functions in FROM. */
  derivedAliases: string[];
  /** Every FROM/JOIN table ref at any depth. */
  tables: TableRef[];
  /** x.col anywhere outside strings/comments, not followed by "(" and not 3-part. */
  qualified: ColumnRef[];
  /** Only when simple: select items, comparison sides in WHERE/ON/HAVING, GROUP BY/ORDER BY items. */
  bare: ColumnRef[];
  selectAliases: string[];
}

type Kind = 'word' | 'quoted' | 'string' | 'number' | 'param' | 'op' | 'temp' | 'group';
interface Tok {
  kind: Kind;
  text: string;
  lower: string;
}

/** Words that are never a column or an alias: clause words, literals, date parts, type names. */
const KEYWORDS = new Set(
  (
    'select from where group order by having limit offset fetch for window union intersect except ' +
    'minus into values with recursive as on using join inner left right full outer cross natural ' +
    'lateral apply straight_join and or not in is null true false unknown like ilike between case ' +
    'when then else end distinct all any some exists asc desc nulls first last collate escape ' +
    'similar over partition rows range groups filter within option qualify returning top percent ' +
    'ties only use force ignore index key tablesample default array row interval ' +
    'current_date current_time current_timestamp current_user current_role current_schema ' +
    'current_catalog session_user system_user user localtime localtimestamp utc_date utc_time ' +
    'utc_timestamp binary ' +
    'year month day hour minute second week quarter epoch microsecond microseconds millisecond ' +
    'milliseconds dow doy isodow isoyear century decade millennium julian timezone ' +
    'timezone_hour timezone_minute ' +
    'int integer bigint smallint tinyint numeric decimal real double precision float bit boolean ' +
    'bool text varchar char character varying nvarchar nchar date time timestamp timestamptz ' +
    'datetime datetime2 zone json jsonb uuid bytea blob money serial signed unsigned ' +
    'sql_no_cache sql_cache sql_calc_found_rows high_priority sql_small_result sql_big_result ' +
    'sql_buffer_result'
  ).split(' ')
);
const COMPARISONS = new Set(['=', '<>', '!=', '<', '>', '<=', '>=']);
const DML = new Set(['insert', 'update', 'delete', 'merge', 'pivot', 'unpivot', 'match_recognize']);
/** Words that end the current clause without starting one we collect from. */
const OTHER_CLAUSE = new Set(
  'limit offset fetch for window option qualify returning rows range groups'.split(' ')
);
const SELECT_MODIFIERS = new Set(
  (
    'distinct all high_priority straight_join percent sql_no_cache sql_cache ' +
    'sql_calc_found_rows sql_small_result sql_big_result sql_buffer_result'
  ).split(' ')
);
const SET_OPS = new Set(['union', 'intersect', 'except', 'minus']);
const OP_CHARS = '+-*/<>=~!&|^%';
const WORD_START = /[A-Za-z_\u0080-\uffff]/;
const WORD_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;

/** Match `re` (sticky) at position i; '' when it doesn't match. */
function at(re: RegExp, sql: string, i: number): string {
  re.lastIndex = i;
  return re.exec(sql)?.[0] ?? '';
}

function tok(kind: Kind, text: string): Tok {
  return { kind, text, lower: text.toLowerCase() };
}

/** Read a quoted run starting at `start` (the opening char); `close` doubled is an escape. */
function readQuoted(sql: string, start: number, close: string): [string, number] | null {
  let out = '';
  for (let i = start + 1; i < sql.length; i++) {
    if (sql[i] !== close) out += sql[i];
    else if (sql[i + 1] === close) out += sql[++i];
    else return [out, i + 1];
  }
  return null;
}

/** Split SQL into tokens, dropping comments. Null when something can't be read safely. */
function tokenize(sql: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1] ?? '';
    const prev = toks[toks.length - 1];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
    } else if (c === '/' && next === '*') {
      // MySQL runs /*! … */ as SQL, so its contents can't be ignored.
      if (sql[i + 2] === '!') return null;
      // Postgres nests block comments.
      let depth = 0;
      do {
        if (sql.startsWith('/*', i)) depth++;
        else if (sql.startsWith('*/', i)) depth--;
        else {
          i++;
          continue;
        }
        i += 2;
      } while (depth > 0 && i < sql.length);
      if (depth > 0) return null;
    } else if (
      c === "'" ||
      (/[nNeEbBxX]/.test(c) && next === "'" && !WORD_CHAR.test(sql[i - 1] ?? ''))
    ) {
      const escapes = c === 'e' || c === 'E';
      const q = c === "'" ? i : i + 1;
      let j = q + 1;
      for (; j < sql.length; j++) {
        if (sql[j] === '\\') {
          // A backslash means E-string escape or MySQL escape; only the former is read.
          if (!escapes) return null;
          j++;
        } else if (sql[j] === "'") {
          if (sql[j + 1] === "'") j++;
          else break;
        }
      }
      if (j >= sql.length) return null;
      toks.push(tok('string', sql.slice(i, j + 1)));
      i = j + 1;
    } else if (c === '$' && /\d/.test(next)) {
      const m = at(/\$\d+/y, sql, i);
      toks.push(tok('param', m));
      i += m.length;
    } else if (c === '$') {
      const tag = at(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/y, sql, i);
      const end = tag ? sql.indexOf(tag, i + tag.length) : -1;
      if (end === -1) return null;
      toks.push(tok('string', sql.slice(i, end + tag.length)));
      i = end + tag.length;
    } else if (c === '"' || c === '`') {
      const r = readQuoted(sql, i, c);
      if (!r) return null;
      toks.push(tok('quoted', r[0]));
      i = r[1];
    } else if (c === '[') {
      // After a name or ")" it's a subscript; ARRAY[ is a constructor; else MSSQL [name].
      if (/[\w$)\]"]/.test(sql[i - 1] ?? '') || prev?.lower === 'array') {
        toks.push(tok('op', '['));
        i++;
      } else {
        const r = readQuoted(sql, i, ']');
        if (!r) return null;
        toks.push(tok('quoted', r[0]));
        i = r[1];
      }
    } else if (WORD_START.test(c)) {
      let j = i + 1;
      while (j < sql.length && WORD_CHAR.test(sql[j])) j++;
      toks.push(tok('word', sql.slice(i, j)));
      i = j;
    } else if (
      /\d/.test(c) ||
      (c === '.' && /\d/.test(next) && !/[\w$)\]"`]/.test(sql[i - 1] ?? ''))
    ) {
      const m = at(/0x[0-9a-f]+|(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/iy, sql, i);
      i += m.length;
      // MySQL allows names that start with a digit; don't guess.
      if (WORD_CHAR.test(sql[i] ?? '')) return null;
      toks.push(tok('number', m));
    } else if (c === '?') {
      toks.push(tok('param', '?'));
      i++;
    } else if (c === '@' && /[\w@]/.test(next)) {
      const m = at(/@@?[\w$]+/y, sql, i);
      toks.push(tok('param', m));
      i += m.length;
    } else if (c === ':' && next === ':') {
      toks.push(tok('op', '::'));
      i += 2;
    } else if (c === ':' && /\w/.test(next)) {
      const m = at(/:\w+/y, sql, i);
      toks.push(tok('param', m));
      i += m.length;
    } else if (c === '#') {
      // MSSQL #temp; Postgres #> / #>> / #-; anything else may be a MySQL comment.
      const m = at(/#(#?[A-Za-z_][\w$]*|>>|>|-)/y, sql, i);
      if (!m) return null;
      toks.push(tok(/^#[>-]/.test(m) ? 'op' : 'temp', m));
      i += m.length;
    } else if ('(),.;:]@'.includes(c)) {
      toks.push(tok('op', c));
      i++;
    } else if (OP_CHARS.includes(c)) {
      let j = i;
      const commentAt = (k: number) => sql.startsWith('--', k) || sql.startsWith('/*', k);
      while (j < sql.length && OP_CHARS.includes(sql[j]) && !commentAt(j)) j++;
      let op = sql.slice(i, j);
      // Postgres rule: "=-1" is "=" then "-", unless the operator has one of these chars.
      while (op.length > 1 && /[+-]$/.test(op) && !/[~!@#%^&|`?]/.test(op)) op = op.slice(0, -1);
      toks.push(tok('op', op));
      i += op.length;
    } else {
      return null;
    }
  }
  return toks;
}

type Clause =
  | 'start'
  | 'select'
  | 'into'
  | 'from'
  | 'on'
  | 'where'
  | 'having'
  | 'groupby'
  | 'orderby'
  | 'other';
interface Frame {
  /** Opened by SELECT/WITH (or the statement itself), so FROM and JOIN mean tables. */
  query: boolean;
  clause: Clause;
  /** Tokens of the current select / GROUP BY / ORDER BY item; nested parens show as one 'group'. */
  item: Tok[];
  onClose: 'derived' | 'cte' | null;
}

const isName = (t: Tok | undefined): t is Tok =>
  !!t && (t.kind === 'quoted' || (t.kind === 'word' && !KEYWORDS.has(t.lower)));
const isValue = (t: Tok | undefined) =>
  !!t && (['string', 'number', 'param', 'temp'].includes(t.kind) || isName(t));
const isOp = (t: Tok | undefined, ...ops: string[]) =>
  !!t && t.kind === 'op' && ops.includes(t.text);
const isWord = (t: Tok | undefined, ...words: string[]) =>
  !!t && t.kind === 'word' && words.includes(t.lower);
const colRef = (t: Tok, qualifier: string | null = null): ColumnRef => ({
  qualifier,
  name: t.text,
  quoted: t.kind === 'quoted',
});

class Walker {
  ok = true;
  simple = true;
  selects = 0;
  ctes: string[] = [];
  derived: string[] = [];
  tables: TableRef[] = [];
  qualified: ColumnRef[] = [];
  bare: ColumnRef[] = [];
  aliases: string[] = [];
  frames: Frame[] = [{ query: true, clause: 'start', item: [], onClose: null }];

  constructor(private readonly t: Tok[]) {}

  get frame(): Frame {
    return this.frames[this.frames.length - 1];
  }

  run(start: number): void {
    let i = isWord(this.t[start], 'with') ? this.cteHead(start + 1) : start;
    while (this.ok && i < this.t.length) i = this.step(i);
    if (this.frames.length !== 1) this.ok = false;
    this.finishItem();
    if (this.selects === 0) this.ok = false;
  }

  /** Handle the token at i; return the index of the next one to handle. */
  private step(i: number): number {
    const t = this.t[i];
    const f = this.frame;
    if (t.kind === 'op') {
      if (t.text === '(') return this.open(i, null);
      if (t.text === ')') return this.close(i);
      if (t.text === ';') {
        if (this.frames.length > 1 || i < this.t.length - 1) this.ok = false;
        return i + 1;
      }
      if (t.text === ',') {
        if (f.query && (f.clause === 'from' || f.clause === 'on')) {
          f.clause = 'from';
          return this.tableItem(i + 1);
        }
        this.finishItem();
        return i + 1;
      }
    }
    // A #temp name is only expected where a table is.
    if (t.kind === 'temp') return this.fail(i);
    if (t.kind === 'word' && KEYWORDS.has(t.lower)) return this.keyword(i);
    // FOR UPDATE is a SELECT's locking clause; any other write means not ours to check.
    if (t.kind === 'word' && DML.has(t.lower) && !isWord(this.t[i - 1], 'for')) return this.fail(i);
    if (t.kind === 'word' || t.kind === 'quoted') return this.name(i);
    f.item.push(t);
    return i + 1;
  }

  /** A keyword: may start a clause or a table item; otherwise it's part of the current item. */
  private keyword(i: number): number {
    const t = this.t[i];
    const f = this.frame;
    const w = t.lower;
    const by = isWord(this.t[i + 1], 'by');
    if (w === 'select') return this.select(i + 1);
    if (w === 'from' && f.query && !isWord(this.t[i - 1], 'distinct')) {
      // A FROM we didn't expect would leave its tables out of scope.
      if (f.clause !== 'select' && f.clause !== 'into') return this.fail(i);
      this.setClause('from');
      return this.tableItem(i + 1);
    }
    if (w === 'join' || w === 'straight_join' || w === 'apply') {
      if (!f.query || (f.clause !== 'from' && f.clause !== 'on')) return this.fail(i);
      if (w === 'apply') this.simple = false;
      f.clause = 'from';
      return this.tableItem(i + 1);
    }
    if ((w === 'group' || w === 'partition') && by) {
      this.setClause('groupby');
      return i + 2;
    }
    if (w === 'order' && by) {
      this.setClause('orderby');
      return i + 2;
    }
    if (w === 'natural' || w === 'lateral' || w === 'values') this.simple = false;
    else if ((w === 'on' || w === 'using') && f.query && f.clause === 'from') f.clause = 'on';
    else if (w === 'where' || w === 'having' || w === 'into') this.setClause(w);
    else if (OTHER_CLAUSE.has(w)) this.setClause('other');
    else if (SET_OPS.has(w)) {
      this.simple = false;
      this.setClause('other');
    }
    f.item.push(t);
    return i + 1;
  }

  private setClause(c: Clause): void {
    this.finishItem();
    this.frame.clause = c;
  }

  /** SELECT and its modifiers (DISTINCT [ON (…)], ALL, TOP n [PERCENT] [WITH TIES]). */
  private select(i: number): number {
    this.selects++;
    this.setClause('select');
    for (;;) {
      const t = this.t[i];
      if (t?.kind === 'word' && SELECT_MODIFIERS.has(t.lower)) i++;
      else if (isWord(t, 'on') && isOp(this.t[i + 1], '(')) i = this.skipGroup(i + 1);
      else if (isWord(t, 'top')) i = isOp(this.t[i + 1], '(') ? this.skipGroup(i + 1) : i + 2;
      else if (isWord(t, 'with') && isWord(this.t[i + 1], 'ties')) i += 2;
      else return i;
    }
  }

  /** An identifier, possibly dotted, outside FROM. */
  private name(i: number): number {
    let end = i;
    while (isOp(this.t[end + 1], '.') && ['word', 'quoted'].includes(this.t[end + 2]?.kind))
      end += 2;
    const prev = this.t[i - 1];
    const next = this.t[end + 1];
    // Type names (::type, AS type), collations, and field access on an expression.
    const notColumn = isOp(prev, '::', '.') || isWord(prev, 'as', 'collate');
    const f = this.frame;
    if (end === i) {
      const t = this.t[i];
      const comparison = isOp(prev, ...COMPARISONS) || isOp(next, ...COMPARISONS);
      // A column is never directly followed by a value: "BINARY x", "DATE '…'", "f(…)".
      const plain = !notColumn && !isOp(next, '(', '.') && !isValue(next);
      if (plain && comparison && isName(t) && ['where', 'on', 'having'].includes(f.clause))
        this.bare.push(colRef(t));
      f.item.push(t);
    } else {
      if (end === i + 2 && !notColumn && !isOp(next, '(', '.'))
        this.qualified.push(colRef(this.t[end], this.t[i].text));
      f.item.push(tok('group', 'chain'));
    }
    return end + 1;
  }

  /** Classify the finished select / GROUP BY / ORDER BY item. */
  private finishItem(): void {
    const f = this.frame;
    const it = f.item;
    f.item = [];
    if (it.length === 0) return;
    const last = it[it.length - 1];
    if (f.clause === 'select') {
      // Only "col" and "col AS a": "x y" might be a keyword we don't know ("NEXT VALUE FOR …").
      if (
        isName(it[0]) &&
        (it.length === 1 || (it.length === 3 && isWord(it[1], 'as') && isName(last)))
      )
        this.bare.push(colRef(it[0]));
      if (it.length >= 2 && isName(last) && !isOp(it[it.length - 2])) this.aliases.push(last.text);
      else if (it.length >= 2 && isName(it[0]) && isOp(it[1], '=')) this.aliases.push(it[0].text);
    } else if (f.clause === 'groupby') {
      if (it.length === 1 && isName(it[0])) this.bare.push(colRef(it[0]));
    } else if (f.clause === 'orderby') {
      let n = it.length;
      if (n >= 2 && isWord(it[n - 2], 'nulls') && isWord(it[n - 1], 'first', 'last')) n -= 2;
      if (n === 2 && isWord(it[1], 'asc', 'desc')) n = 1;
      if (n === 1 && isName(it[0])) this.bare.push(colRef(it[0]));
    }
  }

  /** Open a paren frame at i. */
  private open(i: number, onClose: Frame['onClose']): number {
    const parent = this.frame;
    const first = this.t[i + 1];
    const query = isWord(first, 'select', 'with');
    if (isWord(first, 'values')) this.simple = false;
    parent.item.push(tok('group', '()'));
    const inherit = ['where', 'on', 'having'].includes(parent.clause) ? parent.clause : 'other';
    this.frames.push({ query, clause: query ? 'start' : inherit, item: [], onClose });
    return isWord(first, 'with') ? this.cteHead(i + 2) : i + 1;
  }

  private close(i: number): number {
    this.finishItem();
    const done = this.frames.pop()!;
    if (this.frames.length === 0) {
      this.ok = false;
      return i + 1;
    }
    if (done.onClose === 'derived') {
      const [alias, j] = this.alias(i + 1);
      if (alias !== null) this.derived.push(alias);
      return j;
    }
    if (done.onClose === 'cte' && isOp(this.t[i + 1], ',')) return this.cteHead(i + 2);
    return i + 1;
  }

  /** One CTE header after WITH [RECURSIVE] or ",": name [(cols)] AS [NOT] [MATERIALIZED] ( */
  private cteHead(i: number): number {
    this.simple = false;
    if (isWord(this.t[i], 'recursive')) i++;
    const name = this.t[i];
    if (name?.kind !== 'word' && name?.kind !== 'quoted') return this.fail(i);
    this.ctes.push(name.text);
    i++;
    if (isOp(this.t[i], '(')) i = this.skipGroup(i);
    if (!isWord(this.t[i], 'as')) return this.fail(i);
    i++;
    while (isWord(this.t[i], 'not', 'materialized')) i++;
    if (!isOp(this.t[i], '(')) return this.fail(i);
    return this.open(i, 'cte');
  }

  /** A table item after FROM, JOIN or a comma in FROM. */
  private tableItem(i: number): number {
    while (isWord(this.t[i], 'only', 'lateral')) {
      if (this.t[i].lower === 'lateral') this.simple = false;
      i++;
    }
    const t = this.t[i];
    if (isOp(t, '(')) {
      // A parenthesized join can't be placed; a subquery or VALUES is a derived table.
      if (!isWord(this.t[i + 1], 'select', 'with', 'values')) return this.fail(i);
      this.simple = false;
      return this.open(i, 'derived');
    }
    if (t?.kind === 'temp') {
      const [alias, j] = this.alias(i + 1);
      this.tables.push({ schema: null, name: t.text, quoted: false, alias });
      return j;
    }
    if (t?.kind !== 'quoted' && (t?.kind !== 'word' || KEYWORDS.has(t.lower))) return this.fail(i);
    const parts = [t];
    while (isOp(this.t[i + 1], '.')) {
      const p = this.t[i + 2];
      if (p?.kind !== 'word' && p?.kind !== 'quoted') return this.fail(i);
      parts.push(p);
      i += 2;
    }
    if (isOp(this.t[i + 1], '(')) {
      this.simple = false;
      return this.open(i + 1, 'derived');
    }
    const [alias, j, columns] = this.alias(i + 1);
    // users u(a, b) renames the columns, so u.a would look wrong when it isn't.
    if (columns) return this.fail(j);
    const last = parts[parts.length - 1];
    const schema = parts
      .slice(0, -1)
      .map((p) => p.text)
      .join('.');
    this.tables.push({
      schema: schema || null,
      name: last.text,
      quoted: last.kind === 'quoted',
      alias,
    });
    return j;
  }

  /** Optional [WITH ORDINALITY] [AS] alias [(cols)] at i. */
  private alias(i: number): [string | null, number, boolean] {
    if (isWord(this.t[i], 'with') && isWord(this.t[i + 1], 'ordinality')) i += 2;
    if (isWord(this.t[i], 'as')) {
      i++;
      if (!isName(this.t[i])) return [null, this.fail(i), false];
    }
    const a = this.t[i];
    if (!isName(a)) return [null, i, false];
    if (isOp(this.t[i + 1], '(')) return [a.text, this.skipGroup(i + 1), true];
    return [a.text, i + 1, false];
  }

  private skipGroup(i: number): number {
    const j = skipGroup(this.t, i);
    return j === -1 ? this.fail(this.t.length) : j;
  }

  private fail(i: number): number {
    this.ok = false;
    return i;
  }
}

const EMPTY: ScanResult = {
  checkable: false,
  simple: false,
  ctes: [],
  derivedAliases: [],
  tables: [],
  qualified: [],
  bare: [],
  selectAliases: [],
};

/** Scan one statement. Anything uncertain gives `checkable: false` and empty lists. */
export function scanSql(sql: string): ScanResult {
  const toks = tokenize(sql);
  if (!toks || toks.length === 0) return { ...EMPTY };
  let start = 0;
  if (isWord(toks[0], 'explain')) {
    // Skip EXPLAIN options up to the statement; DML found later still fails the scan.
    start = 1;
    while (start < toks.length && !isWord(toks[start], 'select', 'with')) {
      start = isOp(toks[start], '(') ? skipGroup(toks, start) : start + 1;
      if (start === -1) return { ...EMPTY };
    }
  }
  const skipped = toks.slice(0, start).some((t) => t.kind === 'word' && DML.has(t.lower));
  if (skipped || !isWord(toks[start], 'select', 'with')) return { ...EMPTY };
  const w = new Walker(toks);
  w.run(start);
  if (!w.ok) return { ...EMPTY };
  const simple = w.simple && w.selects === 1;
  const aliases = new Set(w.aliases.map((a) => a.toLowerCase()));
  return {
    checkable: true,
    simple,
    ctes: w.ctes,
    derivedAliases: w.derived,
    tables: w.tables,
    qualified: w.qualified,
    bare: simple ? w.bare.filter((c) => !aliases.has(c.name.toLowerCase())) : [],
    selectAliases: w.aliases,
  };
}

/** Index after the balanced group opening at i (contents unread); -1 when it never closes. */
function skipGroup(toks: Tok[], i: number): number {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (isOp(toks[j], '(')) depth++;
    else if (isOp(toks[j], ')') && --depth === 0) return j + 1;
  }
  return -1;
}
