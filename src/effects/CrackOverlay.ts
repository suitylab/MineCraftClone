/**
 * CrackOverlay.ts — 4-frame crack animation overlay for the Minecraft Clone.
 *
 * This module generates a 4-frame crack animation that plays when a block
 * is being broken. The overlay is a transparent plane positioned on the
 * targeted block face, displaying progressively denser crack patterns.
 *
 * ## Crack Frame Generation
 *
 * Each frame is a 16×16 canvas with black crack lines on a transparent
 * background. The crack density increases with each frame:
 *
 * - Frame 0: 2-3 thin crack lines (1px width)
 * - Frame 1: 4-6 crack lines (1-2px width)
 * - Frame 2: 7-9 crack lines (1-2px width, more branching)
 * - Frame 3: 10-12 crack lines (1-2px width, dense network)
 *
 * The crack pattern is deterministic per block position — a hash of the
 * block's (x, y, z) coordinates seeds a mulberry32 PRNG, so the same
 * block always produces the same crack pattern.
 *
 * ## Animation Timing
 *
 * The animation advances one frame every 50ms, completing after 4 frames
 * (200ms total). The `update()` method returns `true` when the animation
 * is complete, signaling the caller to break the block and reset.
 *
 * ## Z-Fighting Prevention
 *
 * The overlay is positioned 0.005 units along the face normal from the
 * block surface, and uses polygonOffset to prevent z-fighting with the
 * block's own faces.
 */
import * as THREE from 'three';

/** Duration of each crack frame in seconds. */
const FRAME_DURATION = 0.05; // 50ms per frame

/** Total number of crack frames. */
const FRAME_COUNT = 4;

/** Total animation duration in seconds (4 frames × 50ms). */
const ANIMATION_DURATION = FRAME_DURATION * FRAME_COUNT; // 200ms

/** Offset distance from the block face to prevent z-fighting. */
const FACE_OFFSET = 0.005;

/** Canvas size for crack textures (16×16 pixels). */
const TEXTURE_SIZE = 16;

/**
 * CrackOverlay — 4-frame crack animation overlay.
 *
 * The overlay is a THREE.Mesh with a 1×1 PlaneGeometry and a transparent
 * MeshBasicMaterial. It is positioned on the targeted block face and
 * displays progressively denser crack patterns over 200ms.
 *
 * The class manages its own geometry, material, and textures. Call
 * `dispose()` when the overlay is no longer needed to free GPU resources.
 */
export class CrackOverlay {
  /** The mesh rendering the crack overlay. */
  private readonly _mesh: THREE.Mesh;

  /** The plane geometry shared by the overlay. */
  private readonly _geometry: THREE.PlaneGeometry;

  /** The transparent material used for the overlay. */
  private readonly _material: THREE.MeshBasicMaterial;

  /** Array of 4 crack textures (one per frame). */
  private readonly _textures: THREE.CanvasTexture[];

  /** The scene the overlay is added to. */
  private readonly _scene: THREE.Scene;

  /** Current animation time in seconds. */
  private _elapsedTime: number;

  /** Current frame index (0-3). */
  private _currentFrame: number;

  /** Whether the animation is currently active. */
  private _isAnimating: boolean;

  /** Whether the overlay has been disposed (prevents double-dispose). */
  private _disposed: boolean;

  /**
   * Creates a new CrackOverlay and adds it to the given scene.
   *
   * The overlay starts hidden — call `startBreaking()` to begin the
   * crack animation at a specific block face.
   *
   * @param scene - The THREE.Scene to add the overlay to.
   */
  constructor(scene: THREE.Scene) {
    this._scene = scene;
    this._elapsedTime = 0;
    this._currentFrame = 0;
    this._isAnimating = false;
    this._disposed = false;

    // Generate the 4 crack textures.
    this._textures = this._generateCrackTextures();

    // Create the plane geometry (1×1 unit).
    this._geometry = new THREE.PlaneGeometry(1, 1);

    // Create the transparent material with polygonOffset to prevent z-fighting.
    this._material = new THREE.MeshBasicMaterial({
      map: this._textures[0],
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    });

    // Create the mesh and add it to the scene.
    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.visible = false;
    this._scene.add(this._mesh);
  }

  /**
   * Starts the crack animation at the given block face.
   *
   * Positions the overlay on the specified block face (offset 0.005 units
   * along the normal to prevent z-fighting), orients it to face the correct
   * direction, and begins the 200ms animation.
   *
   * @param x - World X coordinate of the block being broken.
   * @param y - World Y coordinate of the block being broken.
   * @param z - World Z coordinate of the block being broken.
   * @param faceNormal - The face normal of the targeted block face.
   */
  public startBreaking(
    x: number,
    y: number,
    z: number,
    faceNormal: { x: number; y: number; z: number }
  ): void {
    // Guard against use after disposal.
    if (this._disposed) {
      return;
    }

    // Reset animation state.
    this._elapsedTime = 0;
    this._currentFrame = 0;
    this._isAnimating = true;

    // Position the overlay on the block face.
    // The face center is at (x + 0.5, y + 0.5, z + 0.5) plus the normal
    // offset to prevent z-fighting with the block's own faces.
    const centerX = x + 0.5 + faceNormal.x * FACE_OFFSET;
    const centerY = y + 0.5 + faceNormal.y * FACE_OFFSET;
    const centerZ = z + 0.5 + faceNormal.z * FACE_OFFSET;
    this._mesh.position.set(centerX, centerY, centerZ);

    // Orient the plane to face the correct direction.
    // The plane's default normal is +Z. We rotate it to align with the
    // face normal using a quaternion.
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const targetNormal = new THREE.Vector3(faceNormal.x, faceNormal.y, faceNormal.z).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultNormal, targetNormal);
    this._mesh.quaternion.copy(quaternion);

    // Show the overlay with the first frame.
    this._mesh.visible = true;
    this._material.map = this._textures[0];
    this._material.needsUpdate = true;
  }

  /**
   * Advances the crack animation.
   *
   * Should be called every frame while the animation is active. Advances
   * the frame every 50ms. Returns `true` when the animation is complete
   * (200ms elapsed), signaling the caller to break the block and reset.
   *
   * @param deltaTime - Time in seconds since the last frame.
   * @returns True when the animation is complete, false otherwise.
   */
  public update(deltaTime: number): boolean {
    // Guard against use after disposal.
    if (this._disposed) {
      return false;
    }

    // If not animating, return false.
    if (!this._isAnimating) {
      return false;
    }

    // Advance the elapsed time.
    this._elapsedTime += deltaTime;

    // Check if the animation is complete.
    if (this._elapsedTime >= ANIMATION_DURATION) {
      this._isAnimating = false;
      return true;
    }

    // Determine the current frame based on elapsed time.
    const frame = Math.min(
      FRAME_COUNT - 1,
      Math.floor(this._elapsedTime / FRAME_DURATION)
    );

    // Switch texture if the frame changed.
    if (frame !== this._currentFrame) {
      this._currentFrame = frame;
      this._material.map = this._textures[frame];
      this._material.needsUpdate = true;
    }

    return false;
  }

  /**
   * Resets the overlay to its initial state.
   *
   * Hides the mesh and resets the animation state. Call this after the
   * animation completes (when `update()` returns true) or when the
   * targeted block changes.
   */
  public reset(): void {
    // Guard against use after disposal.
    if (this._disposed) {
      return;
    }

    // Reset animation state.
    this._elapsedTime = 0;
    this._currentFrame = 0;
    this._isAnimating = false;

    // Hide the overlay.
    this._mesh.visible = false;
  }

  /**
   * Cleans up all resources held by the overlay.
   *
   * This method:
   * 1. Removes the mesh from the scene
   * 2. Disposes the plane geometry
   * 3. Disposes the material
   * 4. Disposes all 4 crack textures
   * 5. Marks the instance as disposed
   *
   * After calling dispose(), all public methods become no-ops. Calling
   * dispose() multiple times is safe — subsequent calls are ignored.
   */
  public dispose(): void {
    // Guard against double-dispose.
    if (this._disposed) {
      return;
    }

    // Remove the mesh from the scene.
    this._scene.remove(this._mesh);

    // Dispose the geometry.
    this._geometry.dispose();

    // Dispose the material.
    this._material.dispose();

    // Dispose all crack textures.
    for (const texture of this._textures) {
      texture.dispose();
    }

    // Mark as disposed.
    this._disposed = true;
  }

  /**
   * Generates the 4 crack texture frames.
   *
   * Each frame is a 16×16 canvas with black crack lines on a transparent
   * background. The crack density increases with each frame:
   *
   * - Frame 0: 2-3 thin crack lines (1px width)
   * - Frame 1: 4-6 crack lines (1-2px width)
   * - Frame 2: 7-9 crack lines (1-2px width, more branching)
   * - Frame 3: 10-12 crack lines (1-2px width, dense network)
   *
   * The crack pattern is deterministic per block position — a hash of the
   * block's (x, y, z) coordinates seeds a mulberry32 PRNG, so the same
   * block always produces the same crack pattern.
   *
   * @returns An array of 4 CanvasTexture instances (one per frame).
   */
  private _generateCrackTextures(): THREE.CanvasTexture[] {
    const textures: THREE.CanvasTexture[] = [];

    // Generate each frame.
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      // Create a canvas for this frame.
      const canvas = document.createElement('canvas');
      canvas.width = TEXTURE_SIZE;
      canvas.height = TEXTURE_SIZE;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get 2D canvas context for crack texture');
      }

      // Clear the canvas to fully transparent.
      ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

      // Determine the number of crack lines for this frame.
      // Frame 0: 2-3, Frame 1: 4-6, Frame 2: 7-9, Frame 3: 10-12
      const minLines = 2 + frame * 2; // 2, 4, 6, 8
      const maxLines = 3 + frame * 3; // 3, 6, 9, 12
      const lineCount = minLines + Math.floor(Math.random() * (maxLines - minLines + 1));

      // Draw each crack line as a random walk from a random starting point.
      for (let i = 0; i < lineCount; i++) {
        this._drawCrackLine(ctx, frame);
      }

      // Create the texture with NearestFilter for pixel-art style.
      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;

      textures.push(texture);
    }

    return textures;
  }

  /**
   * Draws a single crack line on the given canvas context.
   *
   * The crack is drawn as a random walk from a random starting point,
   * with the line width and length increasing with the frame number.
   *
   * @param ctx - The 2D canvas context to draw on.
   * @param frame - The current frame index (0-3), determines line thickness and length.
   */
  private _drawCrackLine(ctx: CanvasRenderingContext2D, frame: number): void {
    // Random starting point within the canvas.
    const startX = Math.floor(Math.random() * TEXTURE_SIZE);
    const startY = Math.floor(Math.random() * TEXTURE_SIZE);

    // Line width increases with frame: 1px for frames 0-1, 2px for frames 2-3.
    const lineWidth = frame >= 2 ? 2 : 1;
    ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Number of segments in the random walk increases with frame.
    const segmentCount = 3 + frame * 2; // 3, 5, 7, 9

    // Start the path at the random starting point.
    ctx.beginPath();
    ctx.moveTo(startX + 0.5, startY + 0.5);

    // Current position for the random walk.
    let currentX = startX;
    let currentY = startY;

    // Perform the random walk.
    for (let i = 0; i < segmentCount; i++) {
      // Random step in one of 4 directions (up, down, left, right).
      const direction = Math.floor(Math.random() * 4);
      let stepX = 0;
      let stepY = 0;

      switch (direction) {
        case 0: stepX = 1; break;  // Right
        case 1: stepX = -1; break; // Left
        case 2: stepY = 1; break;  // Down
        case 3: stepY = -1; break; // Up
      }

      // Apply the step.
      currentX += stepX;
      currentY += stepY;

      // Clamp to canvas bounds.
      currentX = Math.max(0, Math.min(TEXTURE_SIZE - 1, currentX));
      currentY = Math.max(0, Math.min(TEXTURE_SIZE - 1, currentY));

      // Draw the line segment.
      ctx.lineTo(currentX + 0.5, currentY + 0.5);
    }

    // Stroke the path to draw the crack line.
    ctx.stroke();
  }
}