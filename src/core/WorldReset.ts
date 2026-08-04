/**
 * WorldReset.ts — World regeneration orchestrator for the Minecraft Clone Phase 7.
 *
 * This class coordinates the complete world reset process when the player
 * clicks "重新开始" (Restart) in the pause menu. It handles:
 *
 * 1. **Cleanup**: Disposes the old ChunkMesh (geometries, materials, textures)
 *    and removes it from the scene. Clears particles and hides block highlight.
 * 2. **Regeneration**: Disposes the old world data (creating a fresh empty
 *    ChunkManager) and generates a new procedural world with a random seed.
 * 3. **Rebuild**: Creates a new ChunkMesh for the regenerated world, adds it
 *    to the scene, and re-registers the chunk rebuild callback.
 * 4. **State Reset**: Resets the player to spawn, day/night cycle to dawn,
 *    hotbar to slot 0, clears particles, and hides block highlight.
 *
 * The class is a **pure orchestrator** — it does not own any resources. It
 * receives references to all systems it needs to coordinate via the constructor
 * and performs the reset in the correct order. The `reset()` method returns
 * the newly created ChunkMesh so the Game class can update its reference.
 *
 * ## Reset Order (Critical)
 *
 * The order of operations matters:
 * 1. Dispose old meshes FIRST (free GPU resources before allocating new ones)
 * 2. Regenerate world data (dispose + generate creates a new ChunkManager)
 * 3. Rebuild meshes (new ChunkMesh with the new ChunkManager)
 * 4. Reset game state (player, day/night, hotbar, effects)
 *
 * ## Design Decisions
 *
 * - **Pure orchestrator**: The class coordinates resets but owns no resources.
 * - **Returns new ChunkMesh**: The Game class needs to update its reference
 *   after reset, so `reset()` returns the newly created ChunkMesh.
 * - **Closure-based callback**: The chunk rebuild callback captures the NEW
 *   ChunkMesh via closure, ensuring future block modifications rebuild the
 *   correct mesh.
 * - **Safe null checks**: All operations guard against null/undefined to
 *   handle partially-initialized states gracefully.
 * - **Step logging**: Each phase logs its progress for debugging.
 */
import * as THREE from 'three';
import { World } from '../world/World';
import { ChunkMesh } from '../world/ChunkMesh';
import { Player } from '../player/Player';
import { DayNightCycle } from '../environment/DayNightCycle';
import { Hotbar } from '../ui/Hotbar';
import { BlockHighlight } from '../interaction/BlockHighlight';
import { ParticleSystem } from '../effects/ParticleSystem';

/**
 * WorldReset — Coordinates the complete world regeneration process.
 *
 * This class orchestrates the reset of all game systems when the player
 * clicks "重新开始" (Restart) in the pause menu. It handles disposing old
 * resources, regenerating world data, rebuilding chunk meshes, and resetting
 * player/game state in the correct order.
 *
 * The class is constructed once when the Game is initialized and reused
 * whenever a world reset is needed. It does not own any resources — it
 * only coordinates the reset of systems it receives via the constructor.
 */
export class WorldReset {
  /** The world data model to regenerate. */
  private readonly _world: World;

  /** The current chunk mesh renderer to dispose and replace. */
  private readonly _chunkMesh: ChunkMesh;

  /** The Three.js scene for adding/removing mesh groups. */
  private readonly _scene: THREE.Scene;

  /** The player entity to reset to spawn. */
  private readonly _player: Player;

  /** The day/night cycle to reset to dawn. */
  private readonly _dayNightCycle: DayNightCycle;

  /** The hotbar to reset to slot 0. */
  private readonly _hotbar: Hotbar;

  /** The block highlight to hide. */
  private readonly _blockHighlight: BlockHighlight;

  /** The particle system to clear. */
  private readonly _particleSystem: ParticleSystem;

  /**
   * Creates a new WorldReset orchestrator.
   *
   * @param world - The World data model to regenerate.
   * @param chunkMesh - The current ChunkMesh renderer to dispose and replace.
   * @param scene - The Three.js scene for mesh group management.
   * @param player - The Player entity to reset to spawn position.
   * @param dayNightCycle - The DayNightCycle to reset to dawn.
   * @param hotbar - The Hotbar to reset to slot 0.
   * @param blockHighlight - The BlockHighlight to hide.
   * @param particleSystem - The ParticleSystem to clear.
   */
  constructor(
    world: World,
    chunkMesh: ChunkMesh,
    scene: THREE.Scene,
    player: Player,
    dayNightCycle: DayNightCycle,
    hotbar: Hotbar,
    blockHighlight: BlockHighlight,
    particleSystem: ParticleSystem
  ) {
    this._world = world;
    this._chunkMesh = chunkMesh;
    this._scene = scene;
    this._player = player;
    this._dayNightCycle = dayNightCycle;
    this._hotbar = hotbar;
    this._blockHighlight = blockHighlight;
    this._particleSystem = particleSystem;
  }

  /**
   * Performs the complete world reset.
   *
   * The reset sequence is:
   * 1. Dispose old resources (chunk mesh, particles, block highlight)
   * 2. Regenerate world data (dispose + generate creates new ChunkManager)
   * 3. Rebuild rendering (new ChunkMesh, re-register callback)
   * 4. Reset game state (player, day/night, hotbar)
   *
   * @returns The newly created ChunkMesh for the regenerated world.
   *          The caller (Game class) must update its reference to this.
   */
  public reset(): ChunkMesh {
    this._logStep(1, 'Disposing old resources...');
    this._disposeOldResources();

    this._logStep(2, 'Regenerating world data...');
    this._regenerateWorld();

    this._logStep(3, 'Rebuilding chunk meshes...');
    const newChunkMesh = this._rebuildRendering();

    this._logStep(4, 'Resetting game state...');
    this._resetGameState();

    this._logStep(5, 'World reset complete.');
    return newChunkMesh;
  }

  /**
   * Disposes all old rendering resources and clears transient effects.
   *
   * This method:
   * 1. Disposes the old ChunkMesh (geometries, materials, textures)
   * 2. Removes the old mesh group from the scene
   * 3. Clears all particles from the particle system
   * 4. Hides the block highlight
   *
   * All operations are null-safe — if a system is not initialized,
   * the corresponding step is skipped.
   */
  private _disposeOldResources(): void {
    // Dispose the old chunk mesh to free GPU resources.
    // This releases all geometries, materials, and textures held by
    // the chunk meshes, preventing memory leaks across resets.
    if (this._chunkMesh) {
      this._chunkMesh.dispose();

      // Remove the old mesh group from the scene.
      // Check if the group exists and is a child of the scene before
      // attempting removal to avoid errors.
      if (this._scene && this._chunkMesh.group) {
        this._scene.remove(this._chunkMesh.group);
      }
    }

    // Clear all particles from the particle system.
    // This removes any active break particles from the previous world.
    if (this._particleSystem) {
      this._particleSystem.clear();
    }

    // Hide the block highlight.
    // The highlight may be targeting a block in the old world that no
    // longer exists after regeneration.
    if (this._blockHighlight) {
      this._blockHighlight.hide();
    }
  }

  /**
   * Regenerates the world data with a new random seed.
   *
   * This method:
   * 1. Disposes the old world (creates a fresh empty ChunkManager)
   * 2. Generates a new procedural world (fills the new ChunkManager)
   *
   * After this method, the World contains a new ChunkManager with
   * completely new terrain data.
   */
  private _regenerateWorld(): void {
    if (this._world) {
      // Dispose the old world data.
      // This creates a new empty ChunkManager, releasing all old chunk data.
      this._world.dispose();

      // Generate a new procedural world with a random seed.
      // This fills the new ChunkManager with fresh terrain data.
      this._world.generateWorld();
    }
  }

  /**
   * Rebuilds the rendering layer for the regenerated world.
   *
   * This method:
   * 1. Creates a new ChunkMesh with the world's new ChunkManager
   * 2. Adds the new mesh group to the scene
   * 3. Re-registers the chunk rebuild callback
   *
   * The chunk rebuild callback captures the NEW ChunkMesh via closure,
   * ensuring future block modifications rebuild the correct mesh.
   *
   * @returns The newly created ChunkMesh for the regenerated world.
   */
  private _rebuildRendering(): ChunkMesh {
    // Create a new ChunkMesh with the world's new ChunkManager.
    // The constructor builds all chunk meshes for the new terrain.
    const newChunkMesh = new ChunkMesh(this._world.getChunkManager());

    // Add the new mesh group to the scene.
    if (this._scene) {
      this._scene.add(newChunkMesh.group);
    }

    // Re-register the chunk rebuild callback.
    // The callback uses the NEW ChunkMesh via closure, so block
    // modifications after reset rebuild the correct mesh.
    this._world.setChunkRebuildCallback(
      (chunkX: number, chunkY: number, chunkZ: number) => {
        const chunk = this._world.chunkManager.getChunk(chunkX, chunkY, chunkZ);
        if (chunk) {
          newChunkMesh.buildChunk(chunk, this._world.chunkManager);
        }
      }
    );

    return newChunkMesh;
  }

  /**
   * Resets all game state systems to their initial conditions.
   *
   * This method:
   * 1. Resets the player to the spawn position with zero velocity
   * 2. Resets the day/night cycle to dawn
   * 3. Resets the hotbar selection to slot 0
   *
   * All operations are null-safe — if a system is not initialized,
   * the corresponding step is skipped.
   */
  private _resetGameState(): void {
    // Reset the player to the spawn position.
    // This also resets velocity, onGround, yaw, and pitch.
    if (this._player) {
      this._player.reset();
    }

    // Reset the day/night cycle to dawn.
    // The player experiences a sunrise when the new world loads.
    if (this._dayNightCycle) {
      this._dayNightCycle.reset();
    }

    // Reset the hotbar selection to slot 0 (GRASS).
    if (this._hotbar) {
      this._hotbar.setSelectedSlot(0);
    }
  }

  /**
   * Logs a reset step for debugging.
   *
   * @param step - The step number (1-based).
   * @param message - The step description.
   */
    private _logStep(_step: number, _message: string): void {
    // Debug logging removed.
  }
}