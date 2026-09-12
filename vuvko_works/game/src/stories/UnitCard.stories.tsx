import { REFERENCE_HEX_FEET } from "../core/roster";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { UnitCard } from "../components/molecules/UnitCard";
import { makeUnit } from "../core/mission";

const meta = {
  title: "molecules/UnitCard",
  component: UnitCard,
  args: { unit: makeUnit("drone", 0, { q: 0, r: 0 }, REFERENCE_HEX_FEET, "Drone 1") },
  parameters: { layout: "padded" },
} satisfies Meta<typeof UnitCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Drone: Story = {};

export const DroneHurt: Story = {
  args: {
    unit: {
      ...makeUnit("drone", 0, { q: 0, r: 0 }, REFERENCE_HEX_FEET, "Drone 1"),
      hp: 5,
      movement: 1,
    },
  },
};

export const Spent: Story = {
  args: {
    unit: {
      ...makeUnit("drone", 1, { q: 0, r: 0 }, REFERENCE_HEX_FEET, "Drone 2"),
      movement: 0,
      hasAttacked: true,
    },
    heldInPlace: true,
  },
};

export const Scout: Story = {
  args: { unit: makeUnit("scout", 9, { q: 0, r: 0 }, REFERENCE_HEX_FEET) },
};
export const Sentinel: Story = {
  args: { unit: makeUnit("sentinel", 9, { q: 0, r: 0 }, REFERENCE_HEX_FEET) },
};
export const Hunter: Story = {
  args: { unit: makeUnit("hunter", 9, { q: 0, r: 0 }, REFERENCE_HEX_FEET) },
};
