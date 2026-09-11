import type { Meta, StoryObj } from "@storybook/react-vite";
import { MissionBriefing } from "../components/organisms/MissionBriefing";
import { MISSION_TYPES, SHIP_PROFILES, rollMission } from "../core/missions";
import { createRng } from "../core/rng";

const [rolled] = rollMission(createRng("storybook"));

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
    <div style={{ width, height, overflow: "hidden", border: "1px solid var(--rule)" }}>
      {children}
    </div>
  );
}

const meta = {
  title: "screens/MissionBriefing",
  component: MissionBriefing,
  parameters: { layout: "centered" },
  args: { brief: rolled, onRoll: () => undefined, onLaunch: () => undefined },
} satisfies Meta<typeof MissionBriefing>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What is on the board between missions. */
export const Desktop: Story = {
  render: (args) => (
    <Frame width={1280} height={720}>
      <MissionBriefing {...args} />
    </Frame>
  ),
};

export const Mobile: Story = {
  render: (args) => (
    <Frame width={390} height={844}>
      <MissionBriefing {...args} />
    </Frame>
  ),
};

/** Coming back from a ship you cleared. */
export const AfterAWin: Story = {
  args: { lastOutcome: "win" },
  render: (args) => (
    <Frame width={1280} height={720}>
      <MissionBriefing {...args} />
    </Frame>
  ),
};

/** Coming back from one you did not. */
export const AfterALoss: Story = {
  args: { lastOutcome: "loss" },
  render: (args) => (
    <Frame width={1280} height={720}>
      <MissionBriefing {...args} />
    </Frame>
  ),
};

/** Every hull the roll can produce. */
export const EveryHull: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      {SHIP_PROFILES.map((profile) => (
        <Frame key={profile.code} width={520} height={330}>
          <MissionBriefing
            brief={{ type: MISSION_TYPES[0]!, profile, seed: `SEED-${profile.code}` }}
            onRoll={() => undefined}
            onLaunch={() => undefined}
          />
        </Frame>
      ))}
    </div>
  ),
};

export const NothingRolled: Story = {
  args: { brief: null },
  render: (args) => (
    <Frame width={520} height={330}>
      <MissionBriefing {...args} />
    </Frame>
  ),
};
