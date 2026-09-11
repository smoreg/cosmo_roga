import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeckView } from "../components/organisms/DeckView";
import { reachableHexes } from "../core/intent";
import { BlueprintDeck } from "./BlueprintDeck";
import { scene } from "./fixtures";

const coarse = scene(4);

const meta = {
  title: "organisms/DeckView",
  component: DeckView,
  parameters: { layout: "centered" },
  args: { deck: coarse.deck, state: coarse.state },
  decorators: [
    (Story) => (
      <div style={{ width: 560, height: 760, border: "1px solid var(--rule)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeckView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The ship underneath is blurred on purpose: it says what kind of place this
 *  is without competing with the grid you play on. */
export const Schematic: Story = {};

/** A drone selected, with everywhere it could still walk this turn tinted.
 *  The tint stops at bulkheads and at zones of control. */
export const WithReach: Story = {
  render: (args) => {
    const drone = args.state.units.find((unit) => unit.side === "drone");
    const reach =
      drone === undefined
        ? new Set<string>()
        : new Set(reachableHexes(args.deck, args.state, drone).keys());
    return <DeckView {...args} selected={drone?.at ?? null} reachable={reach} />;
  },
};

/** Room names over the plan, for checking the taxonomy read correctly. */
export const Labelled: Story = { args: { showLabels: true } };

/** The ship's own artwork underneath, drawn from the tiles at run time by the
 *  same routine hexmap.html rasterises with. Held back by opacity rather than
 *  blur, so the detail survives without competing with the lattice. */
export const WithBlueprint: Story = {
  render: (args) => <BlueprintDeck {...args} />,
};
