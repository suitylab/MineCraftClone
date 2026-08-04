/**
 * ParticleSystem.ts — Optimized block break particle effects for the Minecraft Clone Phase 8.
 *
 * This module implements a particle effect system that provides visual feedback
 * when blocks are broken. When a block is destroyed, 8-12 small cube particles
 * scatter outward from the block's position, affected by gravity, and fade out
 * over 0.5 seconds.
 *
 * ## Phase 8 Enhancements
 *
 * - **Texture Color Sampling**: Particle colors are sampled from the actual
 *   block texture (3-5 random pixels) instead of using a flat color per block
 *   type. This produces realistic, varied particle colors that match the
 *   block's visual appearance.
 * - **Size Shrink**: Particles shrink linearly from 0.1 units at spawn to
 *   0.03 units at death, creating a natural "dissolving" effect.
 * - **Upper Hemisphere Velocity**: Particles scatter in an upward-biased
 *   hemisphere (vertical angle 0 to π/2), creating a natural explosion-like
 *   trajectory.
 *
 * ## Particle Pool
 *
 * To avoid the performance cost of creating/destroying meshes repeatedly, the
 * system uses a fixed-capacity object pool (200 particles). Dead particles are
 * recycled for new spawns, and the shared geometry is reused across all
 * particles. Each particle has its own material (for per-particle opacity and
 * color) and its own mesh (for per-particle position and scale).
 *
 * ## Particle Behavior
 *
 * - **Spawn position**: Random offset (±0.3) from the block center
 * - **Initial velocity**: Random direction in an upward-biased hemisphere,
 *   speed 2-5 blocks/second
 * - **Gravity**: -20 blocks/second² for natural arcs
 * - **Lifetime**: 0.5 seconds
 * - **Fade**: Opacity decreases linearly from 1.0 to 0.0
 * - **Scale**: Shrinks linearly from 1.0 to 0.3 (0.1 → 0.03 units)
 */
import * as THREE from 'three';
import { BlockType } from '../world/World';
import { TextureGenerator } from '../textures/TextureGenerator';

/** Maximum number of particles in the pool. */
const MAX_PARTICLES = 200;

/** Particle lifetime in seconds. */
const PARTICLE_LIFETIME = 0.5;

/** Gravity applied to particles in blocks/second². */
const PARTICLE_GRAVITY = -20;

/** Minimum particle speed in blocks/second. */
const MIN_SPEED = 2;

/** Maximum particle speed in blocks/second. */
const MAX_SPEED = 5;

/** Minimum number of particles spawned per block break. */
const MIN_PARTICLES_PER_BREAK = 8;

/** Maximum number of particles spawned per block break. */
const MAX_PARTICLES_PER_BREAK = 12;

/** Random offset range from block center for spawn position. */
const SPAWN_OFFSET = 0.3;

/** Size of each particle cube (width, height, depth). */
const PARTICLE_SIZE = 0.1;

/** Number of texture pixels to sample for particle colors. */
const COLOR_SAMPLE_COUNT = 5;

/**
 * Color mapping from BlockType to its main texture color.
 * Used as a fallback when texture sampling fails (e.g., AIR blocks
 * or canvas context unavailable).
 */
const BLOCK_COLORS: Record<BlockType, number> = {
  [BlockType.GRASS]: 0x7CB342,   // Green
  [BlockType.DIRT]: 0x8B5A2B,    // Brown
  [BlockType.STONE]: 0x808080,   // Gray
  [BlockType.SAND]: 0xE8D58A,    // Light yellow
  [BlockType.WOOD]: 0x6B4226,    // Brown bark
  [BlockType.LEAVES]: 0x2E7D32,  // Dark green
  [BlockType.WATER]: 0x2196F3,   // Blue
  [BlockType.BEDROCK]: 0x3E3E3E, // Dark gray
  [BlockType.AIR]: 0xFFFFFF,     // White fallback
  [BlockType.GLASS]: 0x87CEEB,   // Light blue (glass)
};

/**
 * Represents a single particle in the pool.
 */
interface Particle {
  /** The mesh rendering this particle. */
  mesh: THREE.Mesh;
  /** The particle's velocity in blocks/second. */
  velocity: THREE.Vector3;
  /** Remaining lifetime in seconds. */
  life: number;
  /** Maximum lifetime in seconds (used for fade/scale ratio). */
  maxLife: number;
  /** Whether this particle is currently active (visible and updating). */
  active: boolean;
}

/**
 * ParticleSystem — Manages block break particle effects.
 *
 * Uses a fixed-capacity object pool to efficiently spawn and recycle particles.
 * The system handles spawning, updating (gravity, movement, fade, scale), and
 * disposal of all particle resources.
 */
export class ParticleSystem {
  /** The parent group or scene that particles are added to. */
  private readonly _parent: THREE.Scene | THREE.Group;

  /** Shared geometry for all particles (small cube). */
  private readonly _geometry: THREE.BoxGeometry;

  /** Pool of all particles (active and inactive). */
  private readonly _particles: Particle[];

  /** Whether the system has been disposed (prevents double-dispose). */
  private _disposed: boolean;

  /**
   * Creates a new ParticleSystem and adds particles to the given parent.
   *
   * @param parent - The THREE.Scene or THREE.Group to add particle meshes to.
   *                 Particles are added to this container when spawned.
   */
  constructor(parent: THREE.Scene | THREE.Group) {
    this._parent = parent;
    this._geometry = new THREE.BoxGeometry(PARTICLE_SIZE, PARTICLE_SIZE, PARTICLE_SIZE);
    this._particles = [];
    this._disposed = false;
  }

  /**
   * Spawns 8-12 particles at the given block position.
   *
   * Particles are spawned at random positions within the block volume
   * (block center + random offset ±0.3) with random velocities in an
   * upward-biased hemisphere (speed 2-5 blocks/second). Each particle's
   * color is sampled from the block's actual texture for realistic
   * variation.
   *
   * If the pool is full (200 active particles), new particles are skipped
   * to prevent exceeding the cap.
   *
   * @param x - World X coordinate of the broken block.
   * @param y - World Y coordinate of the broken block.
   * @param z - World Z coordinate of the broken block.
   * @param blockType - The type of block that was broken (determines particle color).
   */
  public spawnBreakParticles(x: number, y: number, z: number, blockType: BlockType): void {
    // Guard against use after disposal.
    if (this._disposed) {
      return;
    }

    // Determine the number of particles to spawn (8-12 random).
    const count = MIN_PARTICLES_PER_BREAK +
      Math.floor(Math.random() * (MAX_PARTICLES_PER_BREAK - MIN_PARTICLES_PER_BREAK + 1));

    // Sample colors from the block texture for realistic particle colors.
    // This returns an array of colors sampled from the actual texture,
    // or null if texture sampling fails (fallback to BLOCK_COLORS).
    const sampledColors = this._sampleTextureColors(blockType);

    // Spawn each particle.
    for (let i = 0; i < count; i++) {
      // Get a particle from the pool (reuse inactive or create new).
      const particle = this._getParticle();
      if (!particle) {
        // Pool is full — skip remaining particles.
        return;
      }

      // --- Spawn Position ---
      // Block center + random offset ±0.3 on each axis.
      particle.mesh.position.set(
        x + 0.5 + (Math.random() * 2 - 1) * SPAWN_OFFSET,
        y + 0.5 + (Math.random() * 2 - 1) * SPAWN_OFFSET,
        z + 0.5 + (Math.random() * 2 - 1) * SPAWN_OFFSET
      );

      // --- Initial Velocity (Upper Hemisphere) ---
      // Generate a random direction in the upper hemisphere:
      // - Horizontal angle: random in [0, 2π)
      // - Vertical angle: random in [0, π/2] (biased upward)
      // This creates a natural scatter effect where particles fly up and outward.
      const horizontalAngle = Math.random() * Math.PI * 2;
      const verticalAngle = Math.random() * (Math.PI / 2);

      // Convert spherical coordinates to Cartesian direction.
      // y = cos(verticalAngle) is always ≥ 0, ensuring upward bias.
      const dirX = Math.sin(verticalAngle) * Math.cos(horizontalAngle);
      const dirY = Math.cos(verticalAngle);
      const dirZ = Math.sin(verticalAngle) * Math.sin(horizontalAngle);

      // Random speed in range [2, 5] blocks/second.
      const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);

      // Set the particle's velocity.
      particle.velocity.set(dirX * speed, dirY * speed, dirZ * speed);

      // --- Particle State ---
      // Set lifetime and activate.
      particle.life = PARTICLE_LIFETIME;
      particle.maxLife = PARTICLE_LIFETIME;
      particle.active = true;

      // Reset material opacity and mesh scale to initial values.
      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 1.0;

      // Set the particle color: use a sampled texture color if available,
      // otherwise fall back to the flat BLOCK_COLORS map.
      if (sampledColors && sampledColors.length > 0) {
        material.color.setHex(sampledColors[i % sampledColors.length]);
      } else {
        material.color.setHex(BLOCK_COLORS[blockType] ?? BLOCK_COLORS[BlockType.AIR]);
      }

      particle.mesh.scale.set(1, 1, 1);
      particle.mesh.visible = true;
    }
  }

  /**
   * Updates all active particles.
   *
   * For each active particle:
   * 1. Apply gravity to the vertical velocity
   * 2. Update position based on velocity and deltaTime
   * 3. Decrement remaining lifetime
   * 4. Compute life ratio for fade and scale
   * 5. Update material opacity (linear fade 1.0 → 0.0)
   * 6. Update mesh scale (linear shrink 1.0 → 0.3)
   * 7. Deactivate and hide particles whose lifetime has expired
   *
   * @param deltaTime - Time in seconds since the last frame.
   */
  public update(deltaTime: number): void {
    // Guard against use after disposal.
    if (this._disposed) {
      return;
    }

    // Update all particles in the pool.
    for (const particle of this._particles) {
      // Skip inactive particles.
      if (!particle.active) {
        continue;
      }

      // --- Gravity ---
      // Apply gravity to the vertical velocity component.
      particle.velocity.y += PARTICLE_GRAVITY * deltaTime;

      // --- Position Update ---
      // Move the particle based on its velocity.
      particle.mesh.position.x += particle.velocity.x * deltaTime;
      particle.mesh.position.y += particle.velocity.y * deltaTime;
      particle.mesh.position.z += particle.velocity.z * deltaTime;

      // --- Lifetime ---
      // Decrement the remaining lifetime.
      particle.life -= deltaTime;

      // Check if the particle's lifetime has expired.
      if (particle.life <= 0) {
        // Deactivate and hide the particle.
        particle.active = false;
        particle.mesh.visible = false;
        continue;
      }

      // --- Fade & Scale ---
      // Compute the life ratio (1.0 at spawn, 0.0 at death).
      const lifeRatio = particle.life / particle.maxLife;

      // Fade opacity linearly from 1.0 to 0.0.
      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = lifeRatio;

      // Scale linearly from 1.0 (0.1 units) to 0.3 (0.03 units).
      // At spawn (lifeRatio=1.0): scale = 0.3 + 0.7 = 1.0
      // At death (lifeRatio=0.0): scale = 0.3
      const scale = 0.3 + 0.7 * lifeRatio;
      particle.mesh.scale.set(scale, scale, scale);
    }
  }

  /**
   * Deactivates and hides all active particles.
   *
   * Unlike dispose(), this method does NOT destroy any resources —
   * the particle pool, geometry, and materials remain intact and can
   * be reused for future spawns. This is useful when resetting the
   * world to clear leftover break particles.
   */
  public clear(): void {
    // Guard against use after disposal.
    if (this._disposed) {
      return;
    }

    // Deactivate and hide all particles.
    for (const particle of this._particles) {
      particle.active = false;
      particle.mesh.visible = false;
    }
  }

  /**
   * Cleans up all resources held by the particle system.
   *
   * This method:
   * 1. Removes all particle meshes from the parent group/scene
   * 2. Disposes the shared geometry
   * 3. Disposes all particle materials
   * 4. Clears the particle pool
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

    // Remove all particle meshes from the parent and dispose materials.
    for (const particle of this._particles) {
      // Remove the mesh from the parent group/scene.
      if (particle.mesh.parent) {
        particle.mesh.parent.remove(particle.mesh);
      }

      // Dispose the material (each particle has its own).
      (particle.mesh.material as THREE.MeshBasicMaterial).dispose();
    }

    // Dispose the shared geometry.
    this._geometry.dispose();

    // Clear the particle pool.
    this._particles.length = 0;

    // Mark as disposed.
    this._disposed = true;
  }

  /**
   * Samples colors from a block's texture for realistic particle colors.
   *
   * This method:
   * 1. Gets the block's CanvasTexture via TextureGenerator.getBlockTexture()
   * 2. Extracts the canvas from the texture (texture.image is an HTMLCanvasElement)
   * 3. Samples 3-5 random pixels from the canvas using getImageData()
   * 4. Returns the sampled colors as an array of hex numbers
   *
   * If any step fails (null texture, missing canvas, context unavailable),
   * null is returned and the caller falls back to the BLOCK_COLORS map.
   *
   * @param blockType - The block type to sample colors from.
   * @returns An array of hex color values sampled from the texture,
   *          or null if texture sampling fails.
   */
  private _sampleTextureColors(blockType: BlockType): number[] | null {
    try {
      // Get the block's texture.
      const texture = TextureGenerator.getBlockTexture(blockType);
      if (!texture) {
        return null;
      }

      // Extract the canvas from the texture.
      const canvas = texture.image as HTMLCanvasElement;
      if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
        return null;
      }

      // Get the 2D context for pixel reading.
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return null;
      }

      // Sample 3-5 random pixels from the canvas.
      const sampleCount = 3 + Math.floor(Math.random() * 3); // 3-5 samples
      const colors: number[] = [];

      for (let i = 0; i < sampleCount; i++) {
        // Random pixel position within the canvas.
        const px = Math.floor(Math.random() * canvas.width);
        const py = Math.floor(Math.random() * canvas.height);

        // Read the pixel data.
        const imageData = ctx.getImageData(px, py, 1, 1);
        const data = imageData.data;

        // Convert RGB to hex color.
        const r = data[0];
        const g = data[1];
        const b = data[2];
        const hexColor = (r << 16) | (g << 8) | b;

        colors.push(hexColor);
      }

      return colors;
    } catch {
      // Any error during texture sampling — fall back to BLOCK_COLORS.
      return null;
    }
  }

  /**
   * Retrieves a particle from the pool for spawning.
   *
   * This method first searches for an inactive particle to reuse. If none
   * is found and the pool is under the cap (200), a new particle is created
   * and added to the pool. If the pool is full, null is returned.
   *
   * @returns A particle ready for spawning, or null if the pool is full.
   */
  private _getParticle(): Particle | null {
    // Search for an inactive particle to reuse.
    for (const particle of this._particles) {
      if (!particle.active) {
        return particle;
      }
    }

    // No inactive particle found — check if we can create a new one.
    if (this._particles.length >= MAX_PARTICLES) {
      return null;
    }

    // Create a new particle.
    const material = new THREE.MeshBasicMaterial({
      color: 0xFFFFFF,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
    });

    const mesh = new THREE.Mesh(this._geometry, material);
    mesh.visible = false;

    // Add the mesh to the parent group/scene.
    this._parent.add(mesh);

    // Create the particle object and add it to the pool.
    const particle: Particle = {
      mesh,
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: PARTICLE_LIFETIME,
      active: false,
    };

    this._particles.push(particle);
    return particle;
  }
}