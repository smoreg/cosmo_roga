import { describe, it, expect } from "vitest";
import { MessageLog, type LogLine } from "@jamrog/engine";
import { HISTORY_LINES, HISTORY_ROWS, historyPages, logFades, opensTurn } from "../src/ui/logline.js";

/**
 * How old a log line looks, and where the log's own past is kept.
 *
 * Both renderers used to keep the same magic three — the last three lines
 * bright, everything above them grey — and three is not a unit of anything the
 * game does (docs/gui-guides.md, "Что применить", A). A turn where the drone
 * fired, was answered, heard something through a bulkhead and watched the alert
 * climb writes five lines, and two of them were already dark. The unit is the
 * turn, and this is where that is decided for both views at once.
 */

function line(text: string, turn: number, tone: LogLine["tone"] = "plain"): LogLine {
  return { text, turn, tone, count: 1 };
}

describe("how far back a log line looks", () => {
  it("keeps every line of the newest turn at full strength, however many there are", () => {
    // The five-line turn, which is the case the old rule got wrong.
    const lines = [
      line("scrapper hits you", 11),
      line("you fire", 12),
      line("the shot lands", 12),
      line("something moves behind d4", 12),
      line("alert 2", 12),
    ];
    expect(logFades(lines)).toEqual(["recent", "fresh", "fresh", "fresh", "fresh"]);
  });

  it("dims the turn before it and puts everything older away", () => {
    const lines = [line("a", 7), line("b", 8), line("c", 9), line("d", 9)];
    expect(logFades(lines)).toEqual(["old", "recent", "fresh", "fresh"]);
  });

  /**
   * "The turn before" means the previous turn that said anything. Six quiet
   * turns of walking must not push the last thing that happened into the dark
   * — nothing has happened since, so it is still the news.
   */
  it("counts turns that wrote a line, not the numbers between them", () => {
    const lines = [line("door welded", 3), line("scout in sight", 40)];
    expect(logFades(lines)).toEqual(["recent", "fresh"]);
  });

  it("says where one turn ends and the next begins", () => {
    const lines = [line("a", 4), line("b", 5), line("c", 5)];
    expect([0, 1, 2].map((i) => opensTurn(lines, i))).toEqual([false, true, false]);
  });

  /**
   * The one tone that never fades. An alert that went up three turns ago is
   * still up, and a line that says so has not stopped being true because the
   * drone has walked twice since (G71 raises the tone; the fading only has to
   * survive both sides of that merge).
   */
  it("never fades an alarm, however far back it was written", () => {
    const alarm = { ...line("ALERT: the ship is hunting", 2), tone: "alarm" as LogLine["tone"] };
    const lines = [alarm, line("you walk", 8), line("you walk", 9)];
    expect(logFades(lines)).toEqual(["fresh", "recent", "fresh"]);
  });

  it("has an answer for an empty log and for a log with one line in it", () => {
    expect(logFades([])).toEqual([]);
    expect(logFades([line("a", 1)])).toEqual(["fresh"]);
  });
});

describe("the log's own past, as a card", () => {
  const filled = (n: number): MessageLog => {
    const log = new MessageLog();
    for (let i = 0; i < n; i++) log.add(`line ${i}`, i);
    return log;
  };

  it("shows the newest screen first, because that is where the log is standing", () => {
    const pages = historyPages(filled(HISTORY_ROWS * 2).lines, HISTORY_ROWS);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.at(-1)).toBe(`line ${HISTORY_ROWS * 2 - 1}`);
    expect(pages[1]!.at(-1)).toBe(`line ${HISTORY_ROWS - 1}`);
    expect(pages[1]![0]).toBe("line 0");
  });

  /**
   * The log keeps two hundred and the screen shows seven, so the card is the
   * whole of what a player can still reach — and the remainder goes on the
   * oldest page, where nobody is lining rows up against anything.
   */
  it("reaches every line the log kept, and no further", () => {
    const log = filled(400);
    expect(log.lines).toHaveLength(HISTORY_LINES);
    const pages = historyPages(log.lines, HISTORY_ROWS);
    expect(pages.flat()).toHaveLength(HISTORY_LINES);
    // Newest page first, so the oldest line the log still holds is the first
    // line of the last page.
    expect(pages.at(-1)![0]).toBe(`line ${400 - HISTORY_LINES}`);
    expect(pages[0]!.at(-1)).toBe("line 399");
  });

  it("folds a repeat the way the log itself does, rather than printing it twice", () => {
    const log = new MessageLog();
    log.add("the hull groans", 5);
    log.add("the hull groans", 5);
    expect(historyPages(log.lines, HISTORY_ROWS)).toEqual([["the hull groans (x2)"]]);
  });

  it("answers a run that has said nothing with a line rather than a blank card", () => {
    const pages = historyPages([], HISTORY_ROWS);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(1);
    expect(pages[0]![0]!.length).toBeGreaterThan(0);
  });
});
