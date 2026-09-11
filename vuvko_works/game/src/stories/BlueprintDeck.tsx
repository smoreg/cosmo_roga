import { DeckView } from "../components/organisms/DeckView";
import type { DeckViewProps } from "../components/organisms/DeckView";
import { useBlueprint } from "../hooks/useBlueprint";

/**
 * A DeckView that draws the ship's real artwork underneath.
 *
 * Storybook serves the tile library at /geomorphs/ through the same middleware
 * the app's dev server uses. Where it is not being served the hook returns
 * null and the map falls back to its schematic, so the story still renders.
 */
export function BlueprintDeck(props: DeckViewProps) {
  const backdrop = useBlueprint(props.deck, "/geomorphs/");
  return <DeckView {...props} backdropUrl={backdrop ?? undefined} />;
}
