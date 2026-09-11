import type { Meta, StoryObj } from "@storybook/react-vite";
import { OutcomeDialog } from "../components/organisms/OutcomeDialog";

const meta = {
  title: "organisms/OutcomeDialog",
  component: OutcomeDialog,
  parameters: { layout: "fullscreen" },
  args: {
    outcome: "win",
    turn: 17,
    detail: "Every spawn zone is down. The ship has nothing left to build with.",
    onContinue: () => undefined,
  },
} satisfies Meta<typeof OutcomeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Won the obvious way: every spawn zone levelled. */
export const Cleared: Story = {};

/** Won the quiet way: the nodes cut, the last hostile dead, and the spawn
 *  zones left with nothing to pay with. */
export const Starved: Story = {
  args: {
    turn: 24,
    detail:
      "The nodes are cut and the last of it is dead. What spawn zones remain can never be paid for.",
  },
};

export const Lost: Story = {
  args: { outcome: "loss", turn: 9, detail: "Nothing is coming back to the tug." },
};
