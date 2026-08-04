/**
 * Collision.ts — AABB collision detection system for the Minecraft clone.
 *
 * This module provides collision detection between the player's Axis-Aligned
 * Bounding Box (AABB) and the voxel world. The collision system uses
 * axis-separated movement (X → Y → Z) to handle collisions independently
 * on each axis, which prevents the player from getting stuck on diagonal
 * surfaces and allows proper ground detection.
 *
 * ## Coordinate System
 *
 * - Player position represents the FEET position (center of the body
 *   horizontally, bottom of the body vertically)
 * - The AABB is centered horizontally on the player position and extends
 *   from feet (y) to feet + height (y)
 * - World coordinates are integer block positions; the player position is
 *   a floating-point position within the world
 *
 * ## Collision Rules
 *
 * - Solid blocks (all except AIR and WATER) participate in collision
 * - Water blocks do NOT participate in collision but are detected for
 *   speed reduction
 * - On collision, the axis velocity is zeroed and the position is clamped
 *   to the block boundary
 * - Auto-step: if the player collides with a block while moving horizontally
 *   and the block is exactly 1 block high, the player steps up automatically
 */
import * as THREE from 'three';
import { BlockType } from '../world/World';

/** Epsilon value for floating-point precision comparisons. */
const EPSILON = 0.001;

/**
 * Checks whether the given block type is solid (participates in collision).
 *
 * Solid blocks are all block types except AIR and WATER. Water is excluded
 * because the player can walk through it (with reduced speed).
 *
 * @param type - The BlockType to check.
 * @returns True if the block is solid, false if it's AIR or WATER.
 */
export function isSolidBlock(type: BlockType): boolean {
  return type !== BlockType.AIR && type !== BlockType.WATER;
}

/**
 * Computes the AABB (Axis-Aligned Bounding Box) for the player at the
 * given position.
 *
 * The AABB is centered horizontally on the player position and extends
 * vertically from the feet (position.y) to the head (position.y + height).
 *
 * @param position - The player's feet position (THREE.Vector3).
 * @param width - The player's collision width in blocks.
 * @param height - The player's collision height in blocks.
 * @param depth - The player's collision depth in blocks.
 * @returns An object with min and max corners of the AABB.
 */
function computeAABB(
  position: THREE.Vector3,
  width: number,
  height: number,
  depth: number
): { min: THREE.Vector3; max: THREE.Vector3 } {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;

  return {
    min: new THREE.Vector3(
      position.x - halfWidth,
      position.y,
      position.z - halfDepth
    ),
    max: new THREE.Vector3(
      position.x + halfWidth,
      position.y + height,
      position.z + halfDepth
    ),
  };
}

/**
 * Checks whether the given AABB overlaps any solid block in the world.
 *
 * This function iterates over all block positions that the AABB overlaps
 * and checks if any of them are solid. The block positions are computed
 * by flooring the AABB min corner and ceiling the AABB max corner.
 *
 * @param aabb - The AABB to check (with min and max corners).
 * @param world - The world object with a getBlock(x, y, z) method.
 * @returns True if any solid block overlaps the AABB, false otherwise.
 */
function checkAABBCollision(
  aabb: { min: THREE.Vector3; max: THREE.Vector3 },
  world: { getBlock: (x: number, y: number, z: number) => BlockType }
): boolean {
  // Compute the block range that the AABB overlaps.
  // Floor the min corner and ceil the max corner to get all blocks
  // that the AABB touches.
  const minX = Math.floor(aabb.min.x);
  const minY = Math.floor(aabb.min.y);
  const minZ = Math.floor(aabb.min.z);
  const maxX = Math.ceil(aabb.max.x) - 1;
  const maxY = Math.ceil(aabb.max.y) - 1;
  const maxZ = Math.ceil(aabb.max.z) - 1;

  // Iterate over all blocks in the range.
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        // Check if the block at this position is solid.
        if (isSolidBlock(world.getBlock(x, y, z))) {
          return true;
        }
      }
    }
  }

    return false;
}

/**
 * Finds the highest solid block Y coordinate that the given AABB overlaps.
 *
 * This is used for Y-axis collision resolution when the player lands on
 * a block. Using the highest solid block Y ensures the player is placed
 * on top of the correct block even during fast falls where the AABB may
 * overlap multiple blocks vertically.
 *
 * For example, if the player's feet go from 11.001 to 9.001 in one frame
 * (fast fall at low frame rate), the AABB overlaps blocks at y=9 and y=10.
 * The highest solid block is at y=10, so the player is placed at 11.001
 * (10 + 1 + EPSILON), which is correct. Using Math.ceil(aabb.min.y) would
 * give Math.ceil(9.001) = 10, placing the player at 10.001 — inside the
 * block at y=10 (spanning [10, 11)).
 *
 * @param aabb - The AABB to check (with min and max corners).
 * @param world - The world object with a getBlock(x, y, z) method.
 * @returns The highest Y coordinate of a solid block overlapping the AABB,
 *          or Math.floor(aabb.min.y) - 1 if no solid block is found.
 */
function findHighestSolidBlockY(
  aabb: { min: THREE.Vector3; max: THREE.Vector3 },
  world: { getBlock: (x: number, y: number, z: number) => BlockType }
): number {
  // Compute the block range that the AABB overlaps.
  const minX = Math.floor(aabb.min.x);
  const minY = Math.floor(aabb.min.y);
  const minZ = Math.floor(aabb.min.z);
  const maxX = Math.ceil(aabb.max.x) - 1;
  const maxY = Math.ceil(aabb.max.y) - 1;
  const maxZ = Math.ceil(aabb.max.z) - 1;

  // Iterate from the highest Y level down to find the highest solid block.
  // This ensures we find the topmost block the player collided with.
  for (let y = maxY; y >= minY; y--) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        // Check if the block at this position is solid.
        if (isSolidBlock(world.getBlock(x, y, z))) {
          return y;
        }
      }
    }
  }

  // No solid block found — return a safe fallback.
  // This should never happen when called from collision resolution,
  // but the fallback prevents placing the player at an invalid position.
  return minY - 1;
}

/**
 * Checks whether the given AABB overlaps any WATER block in the world.
 *
 * This is used to detect if the player is in water for speed reduction.
 * The function iterates over all block positions that the AABB overlaps
 * and checks if any of them are WATER.
 *
 * @param aabb - The AABB to check (with min and max corners).
 * @param world - The world object with a getBlock(x, y, z) method.
 * @returns True if any WATER block overlaps the AABB, false otherwise.
 */
function checkAABBWater(
  aabb: { min: THREE.Vector3; max: THREE.Vector3 },
  world: { getBlock: (x: number, y: number, z: number) => BlockType }
): boolean {
  // Compute the block range that the AABB overlaps.
  const minX = Math.floor(aabb.min.x);
  const minY = Math.floor(aabb.min.y);
  const minZ = Math.floor(aabb.min.z);
  const maxX = Math.ceil(aabb.max.x) - 1;
  const maxY = Math.ceil(aabb.max.y) - 1;
  const maxZ = Math.ceil(aabb.max.z) - 1;

  // Iterate over all blocks in the range.
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        // Check if the block at this position is water.
        if (world.getBlock(x, y, z) === BlockType.WATER) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Checks whether the player is currently standing on the ground.
 *
 * This function checks if there is a solid block directly below the
 * player's feet. The check uses a small epsilon to account for
 * floating-point precision issues.
 *
 * @param player - The player object with position, width, height, and depth.
 * @param world - The world object with a getBlock(x, y, z) method.
 * @returns True if there is a solid block directly below the player's feet.
 */
export function isPlayerOnGround(
  player: {
    position: THREE.Vector3;
    width: number;
    height: number;
    depth: number;
  },
  world: { getBlock: (x: number, y: number, z: number) => BlockType }
): boolean {
    // Check the block directly below the player's feet.
  // Use a slightly larger epsilon (0.01) than the standard EPSILON (0.001)
  // to correctly identify the supporting block. When the player stands on
  // a block at y=10, the feet are at y=11.001 (blockTopY + EPSILON).
  // Math.floor(11.001 - 0.001) = Math.floor(11.0) = 11 (WRONG — checks AIR).
  // Math.floor(11.001 - 0.01) = Math.floor(10.991) = 10 (CORRECT — supporting block).
  const belowY = Math.floor(player.position.y - 0.01);

  // Check the three blocks below the player's feet (left, center, right).
  // This handles the case where the player is standing on the edge of a block.
  const halfWidth = player.width / 2;
  const halfDepth = player.depth / 2;

  const minX = Math.floor(player.position.x - halfWidth);
  const maxX = Math.floor(player.position.x + halfWidth - EPSILON);
  const minZ = Math.floor(player.position.z - halfDepth);
  const maxZ = Math.floor(player.position.z + halfDepth - EPSILON);

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      if (isSolidBlock(world.getBlock(x, belowY, z))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether the player's body overlaps any WATER block.
 *
 * This is used to determine if the player is in water for speed reduction.
 *
 * @param player - The player object with position, width, height, and depth.
 * @param world - The world object with a getBlock(x, y, z) method.
 * @returns True if the player's body overlaps any WATER block.
 */
export function isPlayerInWater(
  player: {
    position: THREE.Vector3;
    width: number;
    height: number;
    depth: number;
  },
  world: { getBlock: (x: number, y: number, z: number) => BlockType }
): boolean {
  // Compute the player's AABB at the current position.
  const aabb = computeAABB(player.position, player.width, player.height, player.depth);

  // Check if any WATER block overlaps the AABB.
  return checkAABBWater(aabb, world);
}

/**
 * Attempts to auto-step the player up by 1 block when colliding horizontally.
 *
 * Auto-step allows the player to walk up 1-block-high steps without jumping.
 * The function checks if moving the player up by 1 block resolves the
 * horizontal collision. If so, the player is moved up and the collision
 * is considered resolved.
 *
 * @param player - The player object with position, velocity, width, height, depth.
 * @param world - The world object with a getBlock(x, y, z) method.
 * @param axis - The axis of movement ('x' or 'z').
 * @param direction - The direction of movement (+1 or -1).
 * @returns True if the auto-step was successful, false otherwise.
 */
function tryAutoStep(
  player: {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    width: number;
    height: number;
    depth: number;
  },
  world: { getBlock: (x: number, y: number, z: number) => BlockType },
  axis: 'x' | 'z',
  direction: number
): boolean {
  // Save the original position.
  const originalY = player.position.y;

  // Move the player up by 1 block.
  player.position.y += 1;

  // Compute the AABB at the stepped-up position.
  const aabb = computeAABB(player.position, player.width, player.height, player.depth);

  // Check if the collision is resolved.
  if (!checkAABBCollision(aabb, world)) {
    // The step is successful — keep the player at the new position.
    // The Y velocity is preserved so gravity continues to apply.
    return true;
  }

  // The step failed — restore the original position.
  player.position.y = originalY;
  return false;
}

/**
 * Performs axis-separated movement with collision detection.
 *
 * This is the main entry point for player physics. It moves the player
 * along each axis independently (X → Y → Z), checking for collisions
 * after each axis movement. On collision, the axis velocity is zeroed
 * and the position is clamped to the block boundary.
 *
 * The function also handles:
 * - Ground detection (onGround flag)
 * - Auto-step for 1-block-high steps
 * - Water detection (for speed reduction)
 *
 * @param player - The player object with position, velocity, onGround,
 *                 width, height, and depth properties.
 * @param world - The world object with a getBlock(x, y, z) method.
 * @param deltaTime - Time in seconds since the last frame.
 */
export function moveWithCollision(
  player: {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    onGround: boolean;
    width: number;
    height: number;
    depth: number;
  },
  world: { getBlock: (x: number, y: number, z: number) => BlockType },
  deltaTime: number
): void {
  // --- X Axis Movement ---
  if (player.velocity.x !== 0) {
    // Save the original position for auto-step.
    const originalX = player.position.x;

    // Move along the X axis.
    player.position.x += player.velocity.x * deltaTime;

    // Compute the AABB at the new position.
    let aabb = computeAABB(player.position, player.width, player.height, player.depth);

    // Check for collision.
    if (checkAABBCollision(aabb, world)) {
      // Determine the direction of movement.
      const direction = player.velocity.x > 0 ? 1 : -1;

      // Try auto-step first (only when moving horizontally and not falling).
      if (player.onGround && tryAutoStep(player, world, 'x', direction)) {
        // Auto-step succeeded — the player is now 1 block higher.
        // The X velocity is preserved.
      } else {
        // Auto-step failed — resolve the collision by clamping.
        if (direction > 0) {
          // Moving right — clamp to the left side of the block.
          player.position.x = Math.floor(aabb.max.x) - player.width / 2 - EPSILON;
        } else {
          // Moving left — clamp to the right side of the block.
          player.position.x = Math.ceil(aabb.min.x) + player.width / 2 + EPSILON;
        }

        // Zero the X velocity.
        player.velocity.x = 0;
      }
    }
  }

  // --- Z Axis Movement ---
  if (player.velocity.z !== 0) {
    // Save the original position for auto-step.
    const originalZ = player.position.z;

    // Move along the Z axis.
    player.position.z += player.velocity.z * deltaTime;

    // Compute the AABB at the new position.
    let aabb = computeAABB(player.position, player.width, player.height, player.depth);

    // Check for collision.
    if (checkAABBCollision(aabb, world)) {
      // Determine the direction of movement.
      const direction = player.velocity.z > 0 ? 1 : -1;

      // Try auto-step first (only when moving horizontally and not falling).
      if (player.onGround && tryAutoStep(player, world, 'z', direction)) {
        // Auto-step succeeded — the player is now 1 block higher.
        // The Z velocity is preserved.
      } else {
        // Auto-step failed — resolve the collision by clamping.
        if (direction > 0) {
          // Moving forward — clamp to the back side of the block.
          player.position.z = Math.floor(aabb.max.z) - player.depth / 2 - EPSILON;
        } else {
          // Moving backward — clamp to the front side of the block.
          player.position.z = Math.ceil(aabb.min.z) + player.depth / 2 + EPSILON;
        }

        // Zero the Z velocity.
        player.velocity.z = 0;
      }
    }
  }

  // --- Y Axis Movement ---
  if (player.velocity.y !== 0) {
    // Move along the Y axis.
    player.position.y += player.velocity.y * deltaTime;

    // Compute the AABB at the new position.
    const aabb = computeAABB(player.position, player.width, player.height, player.depth);

    // Check for collision.
    if (checkAABBCollision(aabb, world)) {
            if (player.velocity.y < 0) {
        // Moving down — landed on a block.
        // Find the highest solid block the AABB overlaps and place the
        // player on top of it. This is more robust than Math.ceil(aabb.min.y)
        // which can place the player inside a block during fast falls
        // (e.g., at low frame rates where the AABB spans multiple blocks).
        const highestBlockY = findHighestSolidBlockY(aabb, world);
        player.position.y = highestBlockY + 1 + EPSILON;

        // Set onGround to true.
        player.onGround = true;
      } else {
        // Moving up — hit a block above.
        // Clamp the position to the bottom of the block.
        player.position.y = Math.floor(aabb.max.y) - player.height - EPSILON;

        // Set onGround to false (not standing on ground).
        player.onGround = false;
      }

      // Zero the Y velocity.
      player.velocity.y = 0;
    } else {
      // No collision — the player is airborne.
      player.onGround = false;
    }
  }

  // --- Ground Support Check ---
  // After all axis movements, verify that the player is still on the ground.
  // This handles the case where the player walks off a ledge.
  if (player.onGround) {
    // Check if there's still a solid block below the player's feet.
    if (!isPlayerOnGround(player, world)) {
      // No support — the player is falling.
      player.onGround = false;
    }
  }
}