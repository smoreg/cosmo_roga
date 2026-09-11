import type { Meta, StoryObj } from "@storybook/react-vite";
import { ForecastPanel } from "../components/molecules/ForecastPanel";
import { ROSTER } from "../core/roster";

const welder = ROSTER.drone.weapons[0]!;
const emitter = ROSTER.drone.weapons[1]!;
const claw = ROSTER.scout.weapons[0]!;
const ram = ROSTER.sentinel.weapons[0]!;
const arc = ROSTER.sentinel.weapons[1]!;

const meta = {
  title: "molecules/ForecastPanel",
  component: ForecastPanel,
  args: { weapon: welder, answering: claw, attackerHp: 12, targetHp: 4 },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ForecastPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The welder gets answered: a scout has a melee weapon. */
export const WelderIntoScout: Story = {};

/** The emitter does not: a scout has no ranged weapon at all. This asymmetry
 *  is the whole reason the emitter is worth an inventory slot. */
export const EmitterIntoScout: Story = {
  args: { weapon: emitter, answering: null, attackerHp: 12, targetHp: 4 },
};

export const WelderIntoSentinel: Story = {
  args: { weapon: welder, answering: ram, attackerHp: 12, targetHp: 8 },
};

export const EmitterIntoSentinel: Story = {
  args: { weapon: emitter, answering: arc, attackerHp: 12, targetHp: 8 },
};

/** A wounded drone taking a bad trade — the odds are the point. */
export const Desperate: Story = {
  args: { weapon: welder, answering: ram, attackerHp: 3, targetHp: 8 },
};

/** Machinery never answers. */
export const AgainstASpawner: Story = {
  args: { weapon: welder, answering: null, attackerHp: 12, targetHp: 12 },
};
