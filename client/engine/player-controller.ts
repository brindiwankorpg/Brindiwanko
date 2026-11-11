/**
 * @file Turns input into player movement and server intents.
 *
 * The client predicts its own moves for responsiveness: when the player is
 * standing on a cell and a direction is held, the step starts immediately if
 * the local rules allow it, and a `move` intent is sent. The server validates
 * every step; a rejection makes the client snap back to the authoritative
 * position. Clicking/tapping a cell computes an A* path that is followed one
 * step at a time (any manual direction cancels it).
 */
import { findPath } from '../../shared/passability.js';
import type { Direction } from '../../shared/settings.js';
import type { Input } from './input.js';
import type { MapScene } from './scene.js';

/** Messages the controller sends to the server. */
export interface IntentSink {
  move(direction: Direction, epoch: number): void;
  turn(direction: Direction): void;
  action(): void;
}

/** Minimum delay between two "bump" intents sent while pushing against a solid event. */
const BUMP_INTERVAL_MS = 500;
/** Minimum delay before trying another step after the server rejected one. */
const REJECT_COOLDOWN_MS = 200;

/** Player movement controller. */
export class PlayerController {
  private epoch = 0;
  private path: Direction[] = [];
  private lastBump = 0;
  private rejectUntil = 0;
  /** When `true` (message or menu open), the player does not move. */
  frozen = false;

  constructor(
    private scene: MapScene,
    private readonly input: Input,
    private readonly sink: IntentSink,
  ) {}

  /** Uses a new scene (map change). */
  setScene(scene: MapScene): void {
    this.scene = scene;
    this.path = [];
    this.rejectUntil = 0;
  }

  /** Walks to a cell with pathfinding. */
  walkTo(x: number, y: number): void {
    const p = this.scene.player;
    // Offset to the cell clicked (through the edges of a looping map).
    const { dx, dy } = this.scene.delta(p.x, p.y, x, y);
    const adjacent = Math.abs(dx) + Math.abs(dy) === 1;
    const towards: Direction = dx < 0 ? 4 : dx > 0 ? 6 : dy < 0 ? 8 : 2;
    // Clicking a neighbouring cell that cannot be entered (NPC, chest, sign): face it and interact.
    if (adjacent) {
      const d = towards;
      if (!this.scene.canStep(p.x, p.y, d)) {
        this.path = [];
        this.face(d);
        this.sink.action();
        return;
      }
    }
    const path = findPath(this.scene.map, this.scene.tileset.flags, { x: p.x, y: p.y }, { x, y }, (cx, cy) => this.scene.isBlockedByEvent(cx, cy) || this.scene.monsterAt(cx, cy));
    this.path = (path ?? []) as Direction[];
    // Clicking an adjacent solid thing (NPC, sign): face it and interact.
    if (this.path.length === 0 && adjacent) {
      this.face(towards);
      this.sink.action();
    }
  }

  /** Stops path following. */
  cancelPath(): void {
    this.path = [];
  }

  private face(d: Direction): void {
    const p = this.scene.player;
    if (p.direction !== d) {
      p.setDirection(d);
      this.sink.turn(d);
    }
  }

  /** Called every frame, before the scene update. */
  update(): void {
    const p = this.scene.player;
    if (this.frozen || p.isMoving()) return;
    if (this.input.consume('action')) {
      this.path = [];
      this.sink.action();
      return;
    }
    const held = this.input.dir4();
    if (held) this.path = [];
    const d = held || this.path.shift();
    if (!d || performance.now() < this.rejectUntil) return;
    if (this.scene.canStep(p.x, p.y, d)) {
      p.moveStraight(d);
      this.sink.move(d, this.epoch);
    } else {
      this.face(d);
      this.path = [];
      // Walking into a solid event: let the server start it if it is touch-triggered (it refuses the step anyway).
      const now = performance.now();
      if (this.scene.bumpsEvent(p.x, p.y, d) && now - this.lastBump >= BUMP_INTERVAL_MS) {
        this.lastBump = now;
        this.sink.move(d, this.epoch);
      }
    }
  }

  /**
   * Applies a move decided by the server (move route): a one-cell move is
   * animated, anything else snaps. The new movement epoch is adopted.
   */
  force(x: number, y: number, direction: Direction, epoch: number): void {
    this.epoch = epoch;
    this.path = [];
    const p = this.scene.player;
    this.scene.moveCharacter(p, x, y);
    p.direction = direction;
  }

  /** Applies a server correction and adopts the new movement epoch. */
  reject(x: number, y: number, direction: Direction, epoch: number): void {
    this.epoch = epoch;
    const p = this.scene.player;
    p.locate(x, y);
    p.direction = direction;
    this.path = [];
    this.rejectUntil = performance.now() + REJECT_COOLDOWN_MS;
  }
}
