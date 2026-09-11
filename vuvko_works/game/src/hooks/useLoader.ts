import { useCallback, useEffect, useState } from "react";
import { loadingSteps } from "../lib/loading";
import type { LoadStep, StepState } from "../lib/loading";

export interface StepProgress {
  readonly id: string;
  readonly label: string;
  readonly state: StepState;
  readonly note: string | null;
}

export interface Loader {
  readonly steps: readonly StepProgress[];
  readonly done: boolean;
  readonly fraction: number;
}

/**
 * Runs the load steps one at a time, so the list reads as a list of things
 * happening rather than four spinners finishing at once.
 *
 * A step marked optional that fails is reported and stepped over: missing
 * music or a missing tile library is a worse-looking game, not a broken one.
 */
export function useLoader(deckTilePaths: readonly string[], begin: boolean): Loader {
  const [steps, setSteps] = useState<readonly StepProgress[]>([]);
  const [done, setDone] = useState(false);

  const start = useCallback(async function run(all: LoadStep[]): Promise<void> {
    for (let index = 0; index < all.length; index++) {
      const step = all[index];
      if (step === undefined) continue;
      setSteps(function working(current) {
        return current.map(function mark(entry, at) {
          return at === index ? { ...entry, state: "working" } : entry;
        });
      });
      try {
        await step.run();
        setSteps(function finished(current) {
          return current.map(function mark(entry, at) {
            return at === index ? { ...entry, state: "done" } : entry;
          });
        });
      } catch (problem) {
        const note = problem instanceof Error ? problem.message : "could not load";
        setSteps(function failed(current) {
          return current.map(function mark(entry, at) {
            return at === index ? { ...entry, state: "failed", note } : entry;
          });
        });
        if (!step.optional) break;
      }
    }
    setDone(true);
  }, []);

  useEffect(
    function begin_(): undefined {
      if (!begin) return undefined;
      const all = loadingSteps(deckTilePaths);
      setSteps(
        all.map(function initial(step): StepProgress {
          return { id: step.id, label: step.label, state: "waiting", note: null };
        }),
      );
      void start(all);
      return undefined;
    },
    [begin, deckTilePaths, start],
  );

  const finished = steps.filter(function settled(step) {
    return step.state === "done" || step.state === "failed";
  }).length;

  return {
    steps,
    done,
    fraction: steps.length === 0 ? 0 : finished / steps.length,
  };
}
