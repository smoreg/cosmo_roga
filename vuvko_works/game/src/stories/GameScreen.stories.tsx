import type { Meta, StoryObj } from "@storybook/react-vite";
import { GameScreen } from "../components/organisms/GameScreen";
import { scene } from "./fixtures";

const opening = scene(0);
const underway = scene(4);
const pressed = scene(9);

/** A frame of exactly the viewport being shown, so the whole screen is judged
 *  at its real size rather than at whatever the panel happens to be. */
function Frame({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width,
        height,
        overflow: "hidden",
        border: "1px solid var(--rule)",
        resize: "both",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "screens/GameScreen",
  component: GameScreen,
  parameters: { layout: "centered" },
  args: {
    deck: underway.deck,
    state: underway.state,
    lines: underway.lines,
    unreachableRooms: underway.unreachableRooms,
  },
} satisfies Meta<typeof GameScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 1280x720. The map keeps the room; the squad sits in a column beside it. */
export const Desktop720p: Story = {
  render: (args) => (
    <Frame width={1280} height={720}>
      <GameScreen {...args} />
    </Frame>
  ),
};

/** 390x844. Below 860px the squad column becomes a strip you swipe, and the
 *  map keeps the space — it is the thing you are actually reading. */
export const Mobile: Story = {
  render: (args) => (
    <Frame width={390} height={844}>
      <GameScreen {...args} />
    </Frame>
  ),
};

/** 844x390. A phone turned sideways gets the desktop arrangement back. */
export const MobileLandscape: Story = {
  render: (args) => (
    <Frame width={844} height={390}>
      <GameScreen {...args} />
    </Frame>
  ),
};

/** Turn one: nothing has been built yet and the deck is quiet. */
export const Opening: Story = {
  args: { deck: opening.deck, state: opening.state, lines: opening.lines },
  render: (args) => (
    <Frame width={1280} height={720}>
      <GameScreen {...args} />
    </Frame>
  ),
};

/** Nine turns of doing nothing: the pool has been spending all along. */
export const UnderPressure: Story = {
  args: { deck: pressed.deck, state: pressed.state, lines: pressed.lines },
  render: (args) => (
    <Frame width={1280} height={720}>
      <GameScreen {...args} />
    </Frame>
  ),
};
