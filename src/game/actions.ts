/**
 * The gameplay command vocabulary. Every input device (keyboard, touch, camera)
 * is translated into these commands; the simulation never knows which device
 * produced them.
 */
export type GameAction = "left" | "right" | "jump" | "roll" | "hoverboard";

export const GAME_ACTIONS: readonly GameAction[] = ["left", "right", "jump", "roll", "hoverboard"];
