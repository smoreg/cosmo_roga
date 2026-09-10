/**
 * The holes in a line, filled in by whoever renders it.
 *
 * Names arrive here as the id the content pack gave them, never as a phrase:
 * `{ actor: "scout", amount: 2 }` is a fact, `the scout hits you for 2` is a
 * sentence in one language. A game with a string table rebuilds the sentence
 * from these; one without prints the `text` the writer already composed.
 */
export type LogParams = Readonly<Record<string, string | number>>;

export interface LogLine {
  text: string;
  /** Game turn the line was produced on, for "(x2)" folding and greying out. */
  turn: number;
  /**
   * `alarm` is the loud one: a whole line on a red ground that does not fade
   * with the turn, for a danger the player must not walk into unread. The
   * engine never writes it; a game decides what deserves it.
   */
  tone: "plain" | "good" | "bad" | "warn" | "alarm";
  count: number;
  /**
   * What happened, as an opaque id the writer chose — never the wording.
   *
   * The text of a line is for the player: it gets rephrased, shortened and
   * translated. Anything that reacts to the *event* rather than to the sentence
   * — a sound effect, a hint, a test — has to hang on something that survives
   * all three. The engine never reads this field and knows no id: it carries
   * whatever the caller passed, the way `Room.kind` carries a word no engine
   * file knows.
   */
  key?: string;
  /**
   * What the key needs to become a sentence again.
   *
   * The engine writes English, because a jam entry with no string table still
   * has to read like a game. But English is the *fallback*: a game that keeps a
   * table takes `key` and these values and says the same thing in whatever
   * language is on, and never has to parse the sentence back apart to do it.
   * Present only on lines whose key was given one.
   */
  params?: LogParams;
}

export class MessageLog {
  readonly lines: LogLine[] = [];
  private max: number;

  constructor(max = 200) {
    this.max = max;
  }

  add(
    text: string,
    turn: number,
    tone: LogLine["tone"] = "plain",
    key?: string,
    params?: LogParams,
  ): void {
    const last = this.lines[this.lines.length - 1];
    // Two lines fold into one only when they are the same line: same wording,
    // same event. Keying a line means a repeat of the same thing still reads
    // `(x2)`, while two events that happen to be worded alike stay two lines.
    // The params need no comparison of their own: they are what the text was
    // built from, so equal text under one key is equal params.
    if (last && last.text === text && last.turn === turn && last.key === key) {
      last.count++;
      return;
    }
    const line: LogLine = { text, turn, tone, count: 1 };
    if (key !== undefined) line.key = key;
    if (params !== undefined) line.params = params;
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.shift();
  }

  tail(n: number): LogLine[] {
    return this.lines.slice(Math.max(0, this.lines.length - n));
  }
}
