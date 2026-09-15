import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";
import { Panel, Tag } from "../chrome/Panel.js";
import { t } from "../../../i18n.js";
import type { CodexCard, EndingModel } from "../model.js";
import type { LogEntry } from "../action/Log.js";

/**
 * The cards: everything that is read rather than played.
 *
 * All four are the same object — a plate bolted over the view, one way out,
 * and its text resolving on arrival — so they are one component with four
 * bodies rather than four screens that drift apart. A card never takes a turn
 * and never touches the game: it is handed what it says.
 */
export function Card({
  title,
  stencil,
  width = 720,
  onClose,
  footer,
  children,
}: {
  title: string;
  stencil?: string;
  width?: number;
  onClose?: () => void;
  footer?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(function resolve() {
    if (ref.current === null) return;
    return reveal(linesOf(ref.current), FX.PRESETS.sheet);
  }, [title, stencil]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "color-mix(in oklab, var(--sv-void) 82%, transparent)",
        animation: "sv-slide-in var(--sv-frame) var(--sv-step) 1 both",
      }}
    >
      <div ref={ref} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "94vw" }}>
        <Panel title={title} stencil={stencil} width={width}>
          <div style={{ maxHeight: "68vh", overflowY: "auto" }}>{children}</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 12,
              paddingTop: 10,
              borderTop: "1px solid var(--sv-line)",
            }}
          >
            {footer}
            <span
              onClick={onClose}
              style={{
                marginLeft: "auto",
                font: "var(--sv-stencil)",
                letterSpacing: "var(--sv-stencil-track)",
                textTransform: "uppercase",
                background: "var(--sv-amber)",
                color: "var(--sv-knock)",
                padding: "3px 10px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t("react.close")} [esc]
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** A row of the controls card. A heading is a heading; everything else is a row. */
function HelpLine({ line, heading }: { line: string; heading: boolean }): ReactElement {
  if (line === "") return <div style={{ height: 8 }} />;
  return (
    <div
      data-sc
      style={{
        font: heading ? "var(--sv-stencil)" : "var(--sv-body)",
        letterSpacing: heading ? "var(--sv-stencil-track)" : undefined,
        textTransform: heading ? "uppercase" : undefined,
        color: heading ? "var(--sv-amber)" : "var(--sv-fg)",
        marginTop: heading ? 6 : 0,
        whiteSpace: "pre-wrap",
      }}
    >
      {line}
    </div>
  );
}

export function HelpCard({
  pages,
  headings,
  page,
  onPage,
  onClose,
}: {
  pages: readonly string[][];
  headings: ReadonlySet<string>;
  page: number;
  onPage: (n: number) => void;
  onClose?: () => void;
}): ReactElement {
  const at = Math.min(Math.max(0, page), Math.max(0, pages.length - 1));
  return (
    <Card
      title={t("help.title")}
      stencil={pages.length > 1 ? `${String(at + 1)}/${String(pages.length)}` : undefined}
      onClose={onClose}
      footer={
        pages.length < 2 ? null : (
          <>
            <Turn label={t("react.page.prev")} on={at > 0} onClick={() => onPage(at - 1)} />
            <Turn
              label={t("react.page.next")}
              on={at < pages.length - 1}
              onClick={() => onPage(at + 1)}
            />
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {(pages[at] ?? []).map((line, i) => (
          <HelpLine key={i} line={line} heading={headings.has(line.trim())} />
        ))}
      </div>
    </Card>
  );
}

/** The one control a card has: a page turn, greyed at the end of the run of them. */
function Turn({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): ReactElement {
  return (
    <span
      onClick={on ? onClick : undefined}
      style={{
        font: "var(--sv-stencil)",
        letterSpacing: "var(--sv-stencil-track)",
        textTransform: "uppercase",
        padding: "3px 10px",
        background: on ? "color-mix(in oklab, var(--sv-amber) 22%, transparent)" : "transparent",
        color: on ? "var(--sv-amber)" : "var(--sv-soft)",
        cursor: on ? "pointer" : "default",
      }}
    >
      {label}
    </span>
  );
}

function Block({ head, children }: { head: string; children: ReactNode }): ReactElement {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        data-sc
        style={{
          font: "var(--sv-stencil)",
          letterSpacing: "var(--sv-stencil-track)",
          textTransform: "uppercase",
          color: "var(--sv-soft)",
          marginBottom: 3,
        }}
      >
        {head}
      </div>
      <div data-sc style={{ font: "var(--sv-body)", color: "var(--sv-ink)" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * What is going on here: one thing explained, in the five parts the table
 * keeps. The modules line marks what the drone already carries, so it reads as
 * advice about the rack rather than as a shopping list.
 */
export function CodexCardView({
  card,
  page,
  pages,
  onPage,
  onClose,
}: {
  card: CodexCard;
  page: number;
  pages: number;
  onPage: (n: number) => void;
  onClose?: () => void;
}): ReactElement {
  return (
    <Card
      title={card.title}
      stencil={pages > 1 ? `${String(page + 1)}/${String(pages)}` : t("help.name.codex")}
      width={640}
      onClose={onClose}
      footer={
        pages < 2 ? null : (
          <>
            <Turn label={t("react.page.prev")} on={page > 0} onClick={() => onPage(page - 1)} />
            <Turn
              label={t("react.page.next")}
              on={page < pages - 1}
              onClick={() => onPage(page + 1)}
            />
          </>
        )
      }
    >
      {/* Three of the four heads are the labels the terminal card prints, so
          the two views name the same five parts of a codex entry. Only "what
          it is" is new: the terminal has no head over that paragraph. */}
      <Block head={t("react.codex.what")}>{card.what}</Block>
      <Block head={t("codex.label.wrong")}>{card.wrong}</Block>
      <Block head={t("codex.label.helps")}>{card.helps}</Block>
      {card.turn === undefined ? null : <Block head={t("codex.label.turn")}>{card.turn}</Block>}
      {card.answers.length === 0 ? null : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {card.answers.map((a) => (
            <Tag key={a.name} tone={a.fitted ? "good" : "neutral"} solid={a.fitted}>
              {a.name}
            </Tag>
          ))}
        </div>
      )}
      <div
        data-sc
        style={{
          font: "var(--sv-body)",
          fontStyle: "italic",
          color: "var(--sv-soft)",
          borderLeft: "2px solid var(--sv-line)",
          paddingLeft: 10,
        }}
      >
        {card.lore}
      </div>
    </Card>
  );
}

/** Everything that was said, oldest at the bottom, in pages of a screenful. */
export function HistoryCard({
  entries,
  page,
  rows = 18,
  onPage,
  onClose,
}: {
  entries: readonly LogEntry[];
  page: number;
  rows?: number;
  onPage: (n: number) => void;
  onClose?: () => void;
}): ReactElement {
  const pages = Math.max(1, Math.ceil(entries.length / rows));
  const at = Math.min(Math.max(0, page), pages - 1);
  const shown = entries.slice(at * rows, at * rows + rows);
  return (
    <Card
      title={t("log.title")}
      stencil={`${String(at + 1)}/${String(pages)}`}
      onClose={onClose}
      footer={
        <>
          <Turn label={t("react.page.older")} on={at < pages - 1} onClick={() => onPage(at + 1)} />
          <Turn label={t("react.page.newer")} on={at > 0} onClick={() => onPage(at - 1)} />
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.length === 0 ? (
          <div data-sc style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>
            {t("log.empty")}
          </div>
        ) : (
          shown.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <div
                data-sc
                style={{
                  width: 74,
                  flex: "none",
                  font: "var(--sv-stencil)",
                  fontSize: 14,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--sv-soft)",
                }}
              >
                {e.turn}
              </div>
              <div
                data-sc
                style={{
                  font: "var(--sv-body)",
                  color:
                    e.tone === "bad"
                      ? "color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))"
                      : e.tone === "warn"
                        ? "var(--sv-warn)"
                        : "var(--sv-fg)",
                }}
              >
                {e.text}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

/**
 * The run is over.
 *
 * Won and lost are one card with one word different, because they are one
 * fact: the voyage stopped, and here is what it came to. A defeat screen that
 * is built differently from the victory screen tells a player the game thinks
 * losing is the special case, and in a roguelike it is the ordinary one.
 */
export function EndingCard({
  ending,
  onAgain,
  onClose,
}: {
  ending: EndingModel;
  onAgain?: () => void;
  onClose?: () => void;
}): ReactElement {
  const rows: Array<[string, string]> = [
    [t("title.menu.seed"), String(ending.seed)],
    [t("end.fig.turns"), String(ending.turns)],
    [t("end.fig.sorties"), String(ending.sorties)],
    [t("end.fig.sold"), String(ending.hulls)],
    [t("end.fig.cr"), String(ending.credits)],
  ];
  return (
    <Card
      /* The banner is `ui/render.ts`'s, so this card says what the terminal and
         the page say — `end.sold` included, which is the one of the four a
         voyage sees again and again. */
      title={ending.title}
      stencil={t(ending.won ? "react.end.complete" : "react.end.over")}
      width={520}
      onClose={onClose}
      footer={
        onAgain === undefined ? null : (
          <span
            onClick={onAgain}
            style={{
              font: "var(--sv-stencil)",
              letterSpacing: "var(--sv-stencil-track)",
              textTransform: "uppercase",
              background: "var(--sv-amber)",
              color: "var(--sv-knock)",
              padding: "3px 10px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t("title.menu.voyage")}
          </span>
        )
      }
    >
      {/* The sentence the banner carries: which hull, its three systems and
          what it paid (`end.sold.why`), or what winning was. Two of the four
          endings have none, and then the card opens on its figures as before. */}
      {ending.why === undefined ? null : (
        <div data-sc style={{ marginBottom: 12, font: "var(--sv-body)", color: "var(--sv-fg)" }}>
          {ending.why}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div
              data-sc
              style={{
                /* Wide enough for `ПРОДАНО КОРПУСОВ` and `CASCOS VENDIDOS`:
                   the numbers have to line up under each other, so the column
                   is fixed and fixed at the longest of the three languages. */
                width: 200,
                flex: "none",
                font: "var(--sv-stencil)",
                letterSpacing: "var(--sv-stencil-track)",
                textTransform: "uppercase",
                color: "var(--sv-soft)",
              }}
            >
              {k}
            </div>
            <div
              data-sc
              style={{
                font: "var(--sv-display)",
                fontSize: 22,
                letterSpacing: "var(--sv-display-track)",
                color: "var(--sv-ink)",
              }}
            >
              {v}
            </div>
          </div>
        ))}
      </div>
      <div
        data-sc
        style={{ marginTop: 12, font: "var(--sv-body)", color: "var(--sv-soft)" }}
      >
        {t("react.end.seed", { seed: ending.seed })}
      </div>
    </Card>
  );
}

/**
 * The virus window: what is aboard the rack, and every way to be rid of it.
 *
 * `ui/viruscard.ts` writes it — the heading, the body already broken to the
 * card's width, the footer — because the strain's numbers and this drone's
 * numbers are the same answer on three screens, and a fourth opinion about how
 * long a purge takes would be a fourth set of rules. Nothing here decides
 * anything: the lines arrive written and this puts them on a plate.
 */
export function VirusCardView({
  card,
  onClose,
}: {
  card: { heading: string; body: readonly string[]; footer: string };
  onClose?: () => void;
}): ReactElement {
  return (
    <Card
      title={card.heading}
      stencil={t("help.name.virus")}
      width={620}
      onClose={onClose}
      footer={
        <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>
          {card.footer}
        </span>
      }
    >
      {card.body.map((line, i) =>
        line === "" ? (
          <div key={i} style={{ height: 8 }} />
        ) : (
          <div
            key={i}
            data-sc
            style={{
              font: "var(--sv-body)",
              color: line.startsWith("- ") ? "var(--sv-ink)" : "var(--sv-fg)",
              whiteSpace: "pre-wrap",
            }}
          >
            {line}
          </div>
        ),
      )}
    </Card>
  );
}

/**
 * The airlock card: the third system is up, the hull is worth what it is worth,
 * and not one credit of it is paid until the drone is out through the airlock.
 *
 * `ui/airlockcard.ts` writes it, shaped exactly like the virus window, for the
 * same reason that one is written outside the views — this is the one position
 * in the game where a player can lose everything they have just earned by
 * carrying on, and a rule that important may not be worded twice. Drawn here
 * because it was not drawn here at all: the terminal and the page both raise it
 * and this view swallowed it.
 */
export function AirlockCardView({
  card,
  onClose,
}: {
  card: { heading: string; body: readonly string[]; footer: string };
  onClose?: () => void;
}): ReactElement {
  return (
    <Card
      title={card.heading}
      width={620}
      onClose={onClose}
      footer={
        <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>
          {card.footer}
        </span>
      }
    >
      {card.body.map((line, i) =>
        line === "" ? (
          <div key={i} style={{ height: 8 }} />
        ) : (
          <div key={i} data-sc style={{ font: "var(--sv-body)", color: "var(--sv-fg)", whiteSpace: "pre-wrap" }}>
            {line}
          </div>
        ),
      )}
    </Card>
  );
}

/**
 * The lesson's opening card (G96, 2): what the job is, in three sentences,
 * before the first step. `ui/lessoncard.ts` writes it, for the same reason
 * `ui/viruscard.ts` writes the virus window — one text on three screens.
 */
export function BriefCardView({
  card,
  onClose,
}: {
  card: { heading: string; body: readonly string[]; footer: string };
  onClose?: () => void;
}): ReactElement {
  return (
    <Card
      title={card.heading}
      width={620}
      onClose={onClose}
      footer={
        <span data-sc style={{ font: "var(--sv-body)", color: "var(--sv-soft)" }}>
          {card.footer}
        </span>
      }
    >
      {card.body.map((line, i) =>
        line === "" ? (
          <div key={i} style={{ height: 8 }} />
        ) : (
          <div key={i} data-sc style={{ font: "var(--sv-body)", color: "var(--sv-fg)", whiteSpace: "pre-wrap" }}>
            {line}
          </div>
        ),
      )}
    </Card>
  );
}
