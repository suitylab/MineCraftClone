/**
 * BlockHighlight.ts — Semi-transparent wireframe highlight for the targeted block.
 *
 * This module creates a visual highlight that appears on the block the player's
 * crosshair is aimed at. The highlight is a wireframe cube (LineSegments +
 * EdgesGeometry) that outlines the targeted block's boundaries, making it
 * clear which block will be affected by a break or place action.
 *
 * ## Visual Design
 *
 * - Semi-transparent white wireframe (opacity 0.6) for clear visibility
 *   against both light and dark blocks
 * - Depth testing enabled so the highlight renders correctly with the world
 *   (occluded by blocks in front of it)
 * - The wireframe is positioned exactly on the targeted block's boundaries
 *   (block coordinates + 0.5 offset since blocks are centered at integer + 0.5)
 *
 * ## Usage
 *
 * ```typescript
 * const highlight = new BlockHighlight(scene);
 *
 * // In the game loop:
 * const hit = VoxelRaycaster.raycast(origin, direction, 8, world.getBlock);
 * highlight.update(hit);
 *
 * // On game shutdown:
 * highlight.dispose();
 * ```
 */
import * as THREE from 'three';
import { RaycastResult } from './Raycaster';

/**
 * BlockHighlight — Wireframe highlight for the targeted block.
 *
 * The highlight is a LineSegments object created from an EdgesGeometry of a
 * unit BoxGeometry. It is positioned at the targeted block's center and
 * shown/hidden based on the raycast result.
 *
 * The class manages its own geometry and material lifecycle. Call `dispose()`
 * when the highlight is no longer needed to free GPU resources.
 */
export class BlockHighlight {
  /** The LineSegments object that renders the wireframe. */
  private readonly _lineSegments: THREE.LineSegments;

  /** The geometry containing the wireframe edges. */
  private readonly _geometry: THREE.EdgesGeometry;

  /** The material used to render the wireframe. */
  private readonly _material: THREE.LineBasicMaterial;

  /** Whether the highlight has been disposed (prevents double-dispose). */
  private _disposed: boolean;

  /**
   * Creates a new BlockHighlight and adds it to the given group or scene.
   *
   * The highlight starts hidden — call `update()` with a raycast result to
   * show it at the targeted block's position.
   *
   * @param parent - Optional THREE.Group or THREE.Scene to add the highlight to.
   *                 If omitted, the highlight is not added to any parent and
   *                 must be added manually via `getObject()`.
   */
  constructor(parent?: THREE.Group | THREE.Scene) {
    // Create the unit box geometry (1×1×1 block).
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

    // Extract the edges from the box geometry to create a wireframe.
    // EdgesGeometry generates line segments along the box's edges only
    // (not diagonals), producing a clean wireframe outline.
    this._geometry = new THREE.EdgesGeometry(boxGeometry);

    // Dispose the box geometry — it's no longer needed after edges are extracted.
    boxGeometry.dispose();

    // Create the semi-transparent white line material.
    // depthTest: true ensures the highlight is correctly occluded by blocks
    // in front of it, preventing visual artifacts.
    this._material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });

    // Create the LineSegments object with the edge geometry and material.
    this._lineSegments = new THREE.LineSegments(this._geometry, this._material);

    // Start hidden — the highlight only appears when a block is targeted.
    this._lineSegments.visible = false;

    // Initialize the disposed flag.
    this._disposed = false;

    // Add to the parent group/scene if provided.
    if (parent) {
      parent.add(this._lineSegments);
    }
  }

  /**
   * Updates the highlight position based on the raycast result.
   *
   * If a block is hit, the highlight is positioned at the block's center
   * (block coordinates + 0.5 offset) and made visible. If the hit is null
   * (no block targeted), the highlight is hidden.
   *
   * @param hit - The raycast result, or null if no block is targeted.
   */
  public update(hit: RaycastResult | null): void {
    // Guard against use after disposal.
    if (this._disposed) {
      return;
    }

    // If no block is hit, hide the highlight.
    if (!hit) {
      this.hide();
      return;
    }

    // Position the highlight at the targeted block's center.
    // Blocks span from (x, y, z) to (x+1, y+1, z+1), so the center
    // is at (x + 0.5, y + 0.5, z + 0.5).
    this._lineSegments.position.set(
      hit.hitX + 0.5,
      hit.hitY + 0.5,
      hit.hitZ + 0.5
    );

    // Show the highlight.
    this.show();
  }

  /**
   * Makes the highlight visible.
   *
   * This is called automatically by `update()` when a block is hit.
   * It can also be called manually to force the highlight to appear.
   */
  public show(): void {
    if (this._disposed) {
      return;
    }
    this._lineSegments.visible = true;
  }

  /**
   * Hides the highlight.
   *
   * This is called automatically by `update()` when no block is targeted.
   * It can also be called manually to force the highlight to disappear.
   */
  public hide(): void {
    if (this._disposed) {
      return;
    }
    this._lineSegments.visible = false;
  }

  /**
   * Returns the underlying LineSegments object.
   *
   * This can be used to add the highlight to a scene manually if no parent
   * was provided in the constructor, or to access the object for advanced
   * manipulation.
   *
   * @returns The LineSegments object rendering the wireframe.
   */
  public getObject(): THREE.LineSegments {
    return this._lineSegments;
  }

  /**
   * Cleans up all resources held by the highlight.
   *
   * This method:
   * 1. Removes the LineSegments from its parent (if any)
   * 2. Disposes the edge geometry
   * 3. Disposes the line material
   * 4. Marks the instance as disposed
   *
   * After calling dispose(), all public methods become no-ops. Calling
   * dispose() multiple times is safe — subsequent calls are ignored.
   */
  public dispose(): void {
    // Guard against double-dispose.
    if (this._disposed) {
      return;
    }

    // Remove the LineSegments from its parent (if any).
    if (this._lineSegments.parent) {
      this._lineSegments.parent.remove(this._lineSegments);
    }

    // Dispose the geometry to free GPU memory.
    this._geometry.dispose();

    // Dispose the material to free GPU memory.
    this._material.dispose();

    // Mark as disposed.
    this._disposed = true;
  }
}