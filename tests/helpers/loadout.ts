import type { RunLoadout } from "../../src/game/GameSession";

export const testLoadout = (overrides: Partial<RunLoadout> = {}): RunLoadout => ({
  powerUpDuration: () => 10,
  baseMultiplier: 1,
  hoverboards: 0,
  hoverboardDuration: 30,
  boardJumpMultiplier: 1,
  boardMagnetRadius: 0,
  boardGravityScale: 1,
  ...overrides,
});
