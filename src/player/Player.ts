/**
 * Player.ts — First-person player entity with physics for the Minecraft clone.
 *
 * This module implements the player character's movement, gravity, jumping,
 * and collision handling. The player is a pure logic entity — it has no
 * visual representation. The camera is positioned based on the player's
 * eye position and orientation (yaw/pitch) by the Game class.
 *
 * ## Coordinate System
 *
 * - `position` represents the FEET position (center of the body horizontally,
 *   bottom of the body vertically)
 * - `yaw` is the horizontal rotation in radians (0 = facing -Z direction)
 * - `pitch` is the vertical rotation in radians (0 = level, positive = looking up)
 * - The collision body is 0.6 wide × 1.8 tall × 0.6 deep blocks
 * - The eye height is 1.62 blocks above the feet position
 *
 * ## Movement Physics
 *
 * - Walking speed: 4.3 blocks/second
 * - Water speed: 2.15 blocks/second (50% reduction)
 * - Gravity: 24 blocks/second²
 * - Jump velocity: 7.75 blocks/second (achieves ~1.25 block jump height)
 * - Terminal velocity (falling): 50 blocks/second
 * - Water terminal velocity: 2 blocks/second (via drag)
 * - Mouse sensitivity: 0.002 radians per pixel
 *
 * ## Controls
 *
 * - WASD: move relative to camera yaw (W = forward, S = backward, A = left, D = right)
 * - Space: jump (only when on ground)
 * - Mouse: rotate camera (only when pointer is locked)
 */
import * as THREE from 'three';
import { Input } from '../core/Input';
import { moveWithCollision, isPlayerInWater } from '../physics/Collision';
import { BlockType } from '../world/World';

/** Walking speed in blocks per second. */
const WALK_SPEED = 4.3;

/** Water speed multiplier (50% reduction). */
const WATER_SPEED_MULTIPLIER = 0.5;

/** Gravity acceleration in blocks per second squared. */
const GRAVITY = 24;

/** Jump velocity in blocks per second (achieves ~1.25 block jump height). */
const JUMP_VELOCITY = 7.75;

/** Terminal velocity when falling in blocks per second. */
const TERMINAL_VELOCITY = 50;

/** Terminal velocity when in water in blocks per second. */
const WATER_TERMINAL_VELOCITY = 2;

/** Water drag coefficient (applied per second). */
const WATER_DRAG = 4;

/** Mouse sensitivity in radians per pixel. */
const MOUSE_SENSITIVITY = 0.002;

/** Maximum pitch angle in radians (89 degrees). */
const MAX_PITCH = 1.5533;

/** Eye height above feet position in blocks. */
const EYE_HEIGHT = 1.62;

/** Player collision body width in blocks. */
const PLAYER_WIDTH = 0.6;

/** Player collision body height in blocks. */
const PLAYER_HEIGHT = 1.8;

/** Player collision body depth in blocks. */
const PLAYER_DEPTH = 0.6;

/**
 * Player — First-person player entity with physics.
 *
 * Handles all player movement: WASD input relative to camera yaw,
 * gravity, jumping, water physics, and collision detection. The player
 * is a pure logic entity — it does not render anything. The Game class
 * uses `getEyePosition()` and `yaw`/`pitch` to position the camera.
 */
export class Player {
  /** The player's feet position in world coordinates. */
  public position: THREE.Vector3;

  /** The player's velocity in blocks per second. */
  public velocity: THREE.Vector3;

  /** Whether the player is currently standing on a solid block. */
  public onGround: boolean;

  /** Horizontal rotation in radians (0 = facing -Z direction). */
  public yaw: number;

  /** Vertical rotation in radians (0 = level, positive = looking up). */
  public pitch: number;

  /** The player's collision body width in blocks. */
  public readonly width: number;

  /** The player's collision body height in blocks. */
  public readonly height: number;

  /** The player's collision body depth in blocks. */
  public readonly depth: number;

  /** The world reference for collision detection. */
  private readonly _world: { getBlock: (x: number, y: number, z: number) => BlockType };

  /** The spawn position used for reset(). */
  private readonly _spawnPosition: THREE.Vector3;

  /**
   * Creates a new Player at the given spawn position.
   *
   * The player starts with zero velocity and will fall to the ground
   * naturally via gravity and collision detection.
   *
   * @param world - The world object with a getBlock(x, y, z) method.
   * @param spawnPosition - The world position where the player spawns (feet position).
   */
  constructor(
    world: { getBlock: (x: number, y: number, z: number) => BlockType },
    spawnPosition: THREE.Vector3
  ) {
    this._world = world;
    this._spawnPosition = spawnPosition.clone();

    this.position = spawnPosition.clone();
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.onGround = false;

    this.yaw = 0;
    this.pitch = 0;

    this.width = PLAYER_WIDTH;
    this.height = PLAYER_HEIGHT;
    this.depth = PLAYER_DEPTH;
  }

  /**
   * Updates the player's physics for the current frame.
   *
   * This method handles, in order:
   * 1. Mouse look (yaw/pitch rotation from mouse delta)
   * 2. Movement vector computation (WASD relative to yaw)
   * 3. Speed determination (walking vs water)
   * 4. Horizontal velocity application
   * 5. Gravity application
   * 6. Jump handling
   * 7. Water physics (drag, terminal velocity)
   * 8. Terminal velocity cap
   * 9. Collision detection and resolution
   *
   * @param deltaTime - Time in seconds since the last frame.
   * @param input - The input system providing keyboard and mouse state.
   */
  public update(deltaTime: number, input: Input): void {
    // --- Mouse Look ---
    // Only rotate the camera when the pointer is locked.
    if (input.isPointerLocked()) {
      const mouseDelta = input.getMouseDelta();

      // Apply mouse delta to yaw (horizontal) and pitch (vertical).
      // Yaw wraps around at 2π; pitch is clamped to ±89°.
      this.yaw -= mouseDelta.x * MOUSE_SENSITIVITY;
      this.pitch -= mouseDelta.y * MOUSE_SENSITIVITY;

      // Wrap yaw to [-π, π] range to prevent unbounded growth.
      this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

      // Clamp pitch to prevent over-rotation.
      this.pitch = THREE.MathUtils.clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
    }

    // --- Movement Vector ---
    // Compute the forward and right vectors from the yaw angle.
    // Forward: (-sin(yaw), 0, -cos(yaw)) — camera looks down -Z by default.
    // Right: (cos(yaw), 0, -sin(yaw)) — perpendicular to forward on XZ plane.
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    // Accumulate movement input into a vector.
    let moveX = 0;
    let moveZ = 0;

    if (input.isKeyDown('KeyW')) {
      moveX += forwardX;
      moveZ += forwardZ;
    }
    if (input.isKeyDown('KeyS')) {
      moveX -= forwardX;
      moveZ -= forwardZ;
    }
    if (input.isKeyDown('KeyA')) {
      moveX -= rightX;
      moveZ -= rightZ;
    }
    if (input.isKeyDown('KeyD')) {
      moveX += rightX;
      moveZ += rightZ;
    }

    // Normalize the movement vector to prevent faster diagonal movement.
    const moveLength = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (moveLength > 0) {
      moveX /= moveLength;
      moveZ /= moveLength;
    }

    // --- Speed Determination ---
    // Check if the player is in water for speed reduction.
    const inWater = isPlayerInWater(this, this._world);

    // Determine the movement speed based on whether in water.
    const speed = inWater ? WALK_SPEED * WATER_SPEED_MULTIPLIER : WALK_SPEED;

    // --- Horizontal Velocity ---
    // Set horizontal velocity directly from the movement vector.
    // This provides instant, responsive movement with no acceleration lag.
    this.velocity.x = moveX * speed;
    this.velocity.z = moveZ * speed;

    // --- Gravity ---
    // Apply gravity to the vertical velocity (downward).
    this.velocity.y -= GRAVITY * deltaTime;

    // --- Jump ---
    // Jump when Space is pressed and the player is on the ground.
    if (input.isKeyDown('Space') && this.onGround) {
      this.velocity.y = JUMP_VELOCITY;
      this.onGround = false;
    }

    // --- Water Physics ---
    if (inWater) {
      // Apply drag to vertical velocity to reach terminal velocity quickly.
      this.velocity.y *= Math.max(0, 1 - WATER_DRAG * deltaTime);

      // Clamp vertical velocity to water terminal velocity.
      this.velocity.y = THREE.MathUtils.clamp(
        this.velocity.y,
        -WATER_TERMINAL_VELOCITY,
        WATER_TERMINAL_VELOCITY
      );
    } else {
      // --- Terminal Velocity (Falling) ---
      // Cap the falling speed to prevent tunneling through blocks.
      if (this.velocity.y < -TERMINAL_VELOCITY) {
        this.velocity.y = -TERMINAL_VELOCITY;
      }
    }

    // --- Collision Detection & Resolution ---
    // Move the player with axis-separated collision handling.
    // This updates position, handles collisions, and sets onGround.
    moveWithCollision(this, this._world, deltaTime);
  }

  /**
   * Resets the player to the spawn position with zero velocity.
   *
   * This is called when the world is regenerated or the game restarts.
   * The player will fall to the ground naturally via gravity.
   */
  public reset(): void {
    this.position.copy(this._spawnPosition);
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    this.yaw = 0;
    this.pitch = 0;
  }

  /**
   * Returns the eye position (camera position) in world coordinates.
   *
   * The eye position is the feet position plus the eye height offset.
   *
   * @returns A new Vector3 representing the eye position.
   */
  public getEyePosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + EYE_HEIGHT,
      this.position.z
    );
  }

  /**
   * Returns the camera quaternion based on the player's yaw and pitch.
   *
   * This provides a ready-to-use quaternion for setting the camera's
   * rotation. The quaternion is computed from Euler angles with the
   * YXZ order (yaw applied first, then pitch).
   *
   * @returns A new Quaternion representing the camera orientation.
   */
  public getCameraQuaternion(): THREE.Quaternion {
    // Use YXZ order: yaw (Y) applied first, then pitch (X).
    // This matches the standard FPS camera convention.
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    return new THREE.Quaternion().setFromEuler(euler);
  }
}