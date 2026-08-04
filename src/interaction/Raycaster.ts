/**
 * Raycaster.ts — DDA (Digital Differential Analyzer) voxel raycasting for the Minecraft Clone.
 *
 * This module implements an efficient voxel raycasting algorithm that determines
 * which block the player's crosshair is aimed at. It uses the DDA algorithm to
 * step through the voxel grid one cell at a time, checking each block along the
 * ray's path until it hits a non-AIR block or exceeds the maximum distance.
 *
 * ## DDA Algorithm Overview
 *
 * The DDA algorithm is a grid traversal technique that efficiently finds all
 * voxels intersected by a ray. Instead of checking every voxel in the world
 * (which would be O(n³)), it steps through only the voxels the ray actually
 * passes through, making it O(distance) in the worst case.
 *
 * The algorithm works as follows:
 * 1. Start at the voxel containing the ray's origin
 * 2. Compute the distance (tMax) to the first voxel boundary in each axis
 * 3. Compute the distance (tDelta) between consecutive voxel boundaries in each axis
 * 4. Repeatedly step to the next voxel boundary (the one with the smallest tMax),
 *    checking the block at each new voxel position
 * 5. Stop when a non-AIR block is found, the ray exceeds maxDistance, or the
 *    ray exits the world bounds
 *
 * ## Coordinate System
 *
 * - World coordinates are integer block positions
 * - The ray origin is a floating-point position (camera eye position)
 * - Voxel indices are computed using Math.floor() to correctly handle
 *   negative coordinates (e.g., floor(-0.5) = -1, not 0)
 *
  * ## Face Normal Determination
 *
 * When the ray steps in the +X direction to enter a voxel, it crossed that
 * voxel's -X face, so the outward normal of the hit face is (-1, 0, 0).
 * When stepping in the -X direction, the normal is (+1, 0, 0). The same
 * logic applies to the Y and Z axes. The normal is therefore the inverse of
 * the step direction. This allows the caller to determine which face of the
 * block was hit, which is needed for placement logic (the placement position
 * is hit + normal, landing on the near face toward the player).
 */
import * as THREE from 'three';
import { BlockType } from '../world/World';

/**
 * RaycastResult — The result of a voxel raycast operation.
 *
 * Contains the hit block's coordinates, the face normal of the hit surface,
 * the adjacent placement coordinates (hit position + normal), and the type
 * of the block that was hit.
 */
export interface RaycastResult {
  /** World X coordinate of the hit block. */
  hitX: number;
  /** World Y coordinate of the hit block. */
  hitY: number;
  /** World Z coordinate of the hit block. */
  hitZ: number;
  /** X component of the hit face normal (e.g., 1 for +X face, -1 for -X face). */
  normalX: number;
  /** Y component of the hit face normal (e.g., 1 for top face, -1 for bottom face). */
  normalY: number;
  /** Z component of the hit face normal (e.g., 1 for +Z face, -1 for -Z face). */
  normalZ: number;
  /** World X coordinate where a block would be placed (hitX + normalX). */
  placeX: number;
  /** World Y coordinate where a block would be placed (hitY + normalY). */
  placeY: number;
  /** World Z coordinate where a block would be placed (hitZ + normalZ). */
  placeZ: number;
  /** The type of the block that was hit. */
  hitBlock: BlockType;
}

/**
 * VoxelRaycaster — Static utility class for DDA voxel raycasting.
 *
 * Provides a single static method `raycast()` that casts a ray through the
 * voxel world and returns information about the first non-AIR block hit.
 * The class is stateless and has no dependencies beyond THREE.js and the
 * BlockType enum.
 */
export class VoxelRaycaster {
  /**
   * Casts a ray through the voxel world and returns the first non-AIR block hit.
   *
   * The ray originates from the given origin point and travels in the given
   * direction. It steps through the voxel grid using the DDA algorithm,
   * checking each block along the path. The first non-AIR block encountered
   * is returned as a RaycastResult, or null if no block is hit within the
   * maximum distance.
   *
   * @param origin - The ray's origin in world coordinates (typically the camera eye position).
   * @param direction - The ray's direction vector (typically the camera's forward direction).
   *                    Does not need to be normalized — it will be normalized internally.
   * @param maxDistance - The maximum distance in blocks to cast the ray.
   *                      The ray stops after traveling this distance.
   * @param getBlock - A callback function that returns the BlockType at the given
   *                   world coordinates. This is typically `world.getBlock(x, y, z)`.
   * @returns A RaycastResult describing the hit block, or null if no block is hit
   *          within the maximum distance.
   */
  public static raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    getBlock: (x: number, y: number, z: number) => BlockType
  ): RaycastResult | null {
    // --- Normalize Direction ---
    // The DDA algorithm requires a unit direction vector for correct
    // tDelta computation. If the direction is zero-length, return null.
    const dir = direction.clone().normalize();
    if (dir.lengthSq() === 0) {
      return null;
    }

    // --- Current Voxel Position ---
    // Determine which voxel the ray origin is in.
    // Math.floor() correctly handles negative coordinates:
    //   floor(3.7) = 3, floor(-0.5) = -1, floor(-3.2) = -4
    let voxelX = Math.floor(origin.x);
    let voxelY = Math.floor(origin.y);
    let voxelZ = Math.floor(origin.z);

    // --- Step Direction ---
    // For each axis, determine whether the ray is moving in the + or - direction.
    // If the direction component is zero, the step is 0 (no movement on that axis).
    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

    // --- tDelta Computation ---
    // tDelta is the distance along the ray to cross one full voxel on each axis.
    // It is computed as the reciprocal of the direction component's absolute value.
    // For a zero direction component, tDelta is Infinity (the ray never crosses
    // a voxel boundary on that axis).
    //
    // Formula: tDelta = |1 / direction_component|
    // Example: direction.x = 0.5 → tDeltaX = 1 / 0.5 = 2.0
    //          This means the ray travels 2.0 units to cross one voxel on X.
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

    // --- tMax Computation ---
    // tMax is the distance along the ray to the FIRST voxel boundary on each axis.
    // It is computed by finding the distance from the origin to the next boundary
    // in the step direction, then dividing by the direction component.
    //
    // For positive direction: tMax = (floor(origin) + 1 - origin) / direction
    // For negative direction: tMax = (origin - floor(origin)) / |direction|
    //
    // This can be simplified using the fractional part of the origin coordinate.
    // For positive direction: tMax = (1 - frac) / direction
    // For negative direction: tMax = frac / |direction|
    //
    // Example (positive X, direction.x = 0.5, origin.x = 3.3):
    //   frac = 3.3 - 3 = 0.3
    //   tMaxX = (1 - 0.3) / 0.5 = 0.7 / 0.5 = 1.4
    //   The ray travels 1.4 units to reach the voxel boundary at x = 4.
    //
    // Example (negative X, direction.x = -0.5, origin.x = 3.3):
    //   frac = 3.3 - 3 = 0.3
    //   tMaxX = 0.3 / 0.5 = 0.6
    //   The ray travels 0.6 units to reach the voxel boundary at x = 3.
    const fracX = origin.x - voxelX;
    const fracY = origin.y - voxelY;
    const fracZ = origin.z - voxelZ;

    let tMaxX: number;
    let tMaxY: number;
    let tMaxZ: number;

    if (stepX > 0) {
      tMaxX = (1 - fracX) / dir.x;
    } else if (stepX < 0) {
      tMaxX = fracX / -dir.x;
    } else {
      tMaxX = Infinity;
    }

    if (stepY > 0) {
      tMaxY = (1 - fracY) / dir.y;
    } else if (stepY < 0) {
      tMaxY = fracY / -dir.y;
    } else {
      tMaxY = Infinity;
    }

    if (stepZ > 0) {
      tMaxZ = (1 - fracZ) / dir.z;
    } else if (stepZ < 0) {
      tMaxZ = fracZ / -dir.z;
    } else {
      tMaxZ = Infinity;
    }

    // --- DDA Iteration ---
    // Track which axis was stepped on the last iteration to determine
    // the hit face normal.
    let lastAxis = 0; // 0 = X, 1 = Y, 2 = Z

    // Track the total distance traveled along the ray.
    let distance = 0;

    // Step through the voxel grid until we hit a block or exceed maxDistance.
    while (distance <= maxDistance) {
      // Check the current voxel for a non-AIR block.
      const blockType = getBlock(voxelX, voxelY, voxelZ);

      // If we found a non-AIR block, return the hit result.
      if (blockType !== BlockType.AIR) {
                // Determine the face normal based on the last axis stepped.
        // The normal points OUTWARD from the hit block on the face that was
        // crossed. When the ray steps in +X to enter a voxel, it crossed the
        // voxel's -X face, so the outward normal is (-1, 0, 0). Therefore the
        // normal is the INVERSE of the step direction. This ensures placement
        // occurs on the near face (toward the player), not the far side.
        let normalX = 0;
        let normalY = 0;
        let normalZ = 0;

        if (lastAxis === 0) {
          // Stepped on X axis — the hit face normal opposes the step direction.
          normalX = -stepX;
        } else if (lastAxis === 1) {
          // Stepped on Y axis — the hit face normal opposes the step direction.
          normalY = -stepY;
        } else {
          // Stepped on Z axis — the hit face normal opposes the step direction.
          normalZ = -stepZ;
        }

        // Compute the placement coordinates (hit position + normal).
        const placeX = voxelX + normalX;
        const placeY = voxelY + normalY;
        const placeZ = voxelZ + normalZ;

        // Return the complete raycast result.
        return {
          hitX: voxelX,
          hitY: voxelY,
          hitZ: voxelZ,
          normalX,
          normalY,
          normalZ,
          placeX,
          placeY,
          placeZ,
          hitBlock: blockType,
        };
      }

      // --- Step to the Next Voxel ---
      // Find the axis with the smallest tMax value — this is the next
      // voxel boundary the ray will cross.
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        // Step in the X direction.
        voxelX += stepX;
        distance = tMaxX;
        tMaxX += tDeltaX;
        lastAxis = 0;
      } else if (tMaxY < tMaxZ) {
        // Step in the Y direction.
        voxelY += stepY;
        distance = tMaxY;
        tMaxY += tDeltaY;
        lastAxis = 1;
      } else {
        // Step in the Z direction.
        voxelZ += stepZ;
        distance = tMaxZ;
        tMaxZ += tDeltaZ;
        lastAxis = 2;
      }
    }

    // No block hit within the maximum distance.
    return null;
  }
}