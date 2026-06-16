"use client";

export type DiffRow = { type: "same" | "add" | "del"; text: string };

export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;

  // Build LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const ai = a[i - 1] ?? "";
      const bj = b[j - 1] ?? "";
      const prev = dp[i - 1]?.[j - 1] ?? 0;
      const up = dp[i - 1]?.[j] ?? 0;
      const left = dp[i]?.[j - 1] ?? 0;
      const row = dp[i];
      if (row) {
        row[j] = ai === bj ? prev + 1 : Math.max(up, left);
      }
    }
  }

  // Backtrack to build diff rows in reverse, then reverse at end
  const ops: DiffRow[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    const ai = a[i - 1] ?? "";
    const bj = b[j - 1] ?? "";
    const cur = dp[i]?.[j] ?? 0;
    const up = dp[i - 1]?.[j] ?? 0;
    const left = dp[i]?.[j - 1] ?? 0;

    if (i > 0 && j > 0 && ai === bj) {
      ops.push({ type: "same", text: ai });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || left >= up)) {
      ops.push({ type: "add", text: bj });
      j--;
    } else {
      ops.push({ type: "del", text: ai });
      i--;
    }
    void cur; // suppress unused-var warning
  }

  // Reverse and group: dels before adds within changed regions
  ops.reverse();

  const rows: DiffRow[] = [];
  const dels: DiffRow[] = [];
  const adds: DiffRow[] = [];

  function flush() {
    for (const d of dels) rows.push(d);
    for (const d of adds) rows.push(d);
    dels.length = 0;
    adds.length = 0;
  }

  for (const op of ops) {
    if (op.type === "same") {
      flush();
      rows.push(op);
    } else if (op.type === "del") {
      dels.push(op);
    } else {
      adds.push(op);
    }
  }
  flush();

  return rows;
}

export function WikiDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = diffLines(oldText, newText);

  return (
    <div className="font-mono text-sm whitespace-pre-wrap leading-relaxed">
      {rows.map((row, idx) => {
        if (row.type === "del") {
          return (
            <div key={idx} className="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400">
              <span className="select-none pr-2 text-red-400">-</span>
              {row.text}
            </div>
          );
        }
        if (row.type === "add") {
          return (
            <div key={idx} className="bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400">
              <span className="select-none pr-2 text-green-400">+</span>
              {row.text}
            </div>
          );
        }
        return (
          <div key={idx} className="text-muted-foreground">
            <span className="select-none pr-2 opacity-0">·</span>
            {row.text}
          </div>
        );
      })}
    </div>
  );
}
