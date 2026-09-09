# E6 — Storylets: вольт + предусловие + флаги, стампуется в зону

Статус: done · Зависит от: E3, E5 · Блокирует: G7 · Оценка: 3 ч · Пакет: `packages/engine`

## Зачем

«PCG должна что-то решать». Карточка с предусловием на состоянии дрона — станция достраивается
под то, что игрок потерял. В движке это — `Vault` с тремя полями сверху и размещение внутри
зоны нужного типа.

## Что сделать

1. `sim/mapgen/vaults.ts`: расширить `Vault`:
   ```ts
   /** Zone kinds this vault may be stamped into. Absent = anywhere (old behaviour). */
   readonly zones?: readonly string[];
   /** Content predicate on the run state. Absent = always eligible. */
   readonly when?: (ctx: VaultContext) => boolean;
   /** Weight multiplier from state, for "more likely if…". Absent = 1. */
   readonly weightWhen?: (ctx: VaultContext) => number;
   /** Run flags to set once this vault is placed. */
   readonly sets?: readonly string[];
   export interface VaultContext { depth: number; flags: ReadonlySet<string>; player?: Entity }
   ```
2. `BuildContext` получает `flags: ReadonlySet<string>` и `player?: Entity`;
   `MapgenOptions`/`generateLevel` пробрасывают их; `Game.enterDepth` передаёт `this.flags` и
   `carry` (игрок, если есть). `GeneratedLevel.flagsSet: string[]`; `Game.enterDepth` делает
   `for (f of gen.flagsSet) this.flags.add(f)`.
3. Новая функция `placeVaultsInZones(tiles, zones, library, ctx, rng, perZone: number)`:
   для каждой зоны — отобрать вольты по `zones`, `minDepth`, `when`; взвесить
   `weight * weightWhen`; пробовать стампить **внутри `zone.rect` с отступом 1 от рамки**,
   не затрагивая `Airlock`/`Bulkhead` и не перекрывая уже стампленное; после стампа — локальный
   `connectRegions` внутри сектора (из E5), чтобы вольт не оказался островом. Возвращает
   `PlacedVault[]` с `zoneId` и собранные `sets`.
4. `DeckBuilder` (E5) вызывает её после интерьера и до шлюзов; шлюзы потом не должны попасть
   на клетки вольта (кандидаты на шлюз — только клетки рамки, поэтому конфликт исключён).
   Передать библиотеку через `DeckPlan.vaults?: readonly Vault[]` и `DeckPlan.vaultsPerZone`.
5. Метки вольтов (`marks`) должны доехать до игры: `GeneratedLevel.vaults` уже есть; убедиться,
   что `DeckBuilder` возвращает их через `BuildResult.vaults?: PlacedVault[]` и `assemble()`
   их подхватывает. Игра расставляет по меткам машины/ящики в `onLevelEnter` (G7).

## Тесты (`tests/storylets.test.ts`)

- `when: () => false` никогда не размещается; `zones: ["a"]` только в зонах `a` (проверять
  `zoneAt(origin)` и все клетки вольта внутри rect зоны).
- `weightWhen` меняет частоту: 300 сидов, `weightWhen: () => 10` против соседа с 1 — не менее
  70 % выборов.
- `sets` попадают в `game.flags` после входа на глубину; флаг виден `when` следующей палубы.
- Вольт никогда не стампуется на шлюз или на рамку зоны; изоляция зон (тест E5) держится с
  библиотекой из 5 вольтов на 200 сидов.
- Детерминизм с вольтами.
- Старые вольты без новых полей — прежнее поведение в `placeVaults` (регрессия `vaults.test.ts`).
