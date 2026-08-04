/**
 * ChunkMesh.ts — Rendering layer that converts chunk block data into optimized merged Three.js meshes.
 *
 * This module replaces the Phase 1 one-Mesh-per-block approach with the Phase 2
 * one-merged-Mesh-per-chunk approach, using ChunkMeshBuilder for face-culled
 * geometry generation. This drastically reduces draw calls from millions
 * (one per block) to one per chunk.
 *
 * ## How It Works
 *
 * For each chunk in the ChunkManager, the ChunkMeshBuilder generates a single
 * BufferGeometry containing only the visible faces of all opaque blocks in
 * that chunk. This geometry is wrapped in a single THREE.Mesh with a shared
 * material that uses the 4×2 texture atlas. Water blocks are rendered in a
 * separate mesh with a transparent material.
 *
 * ## Draw Call Reduction
 *
 * Phase 1: 128×128×64 blocks = ~1M draw calls (one Mesh per block)
 * Phase 2: 8×8×8 chunks = 512 draw calls (one Mesh per chunk, plus water)
 *
 * This is a ~2000× reduction in draw calls, enabling smooth rendering of
 * the entire 128×128 world.
 *
 * ## Shared Materials
 *
 * All chunks share the same opaque and water materials. This is critical
 * for performance — creating a new material per chunk would defeat the
 * purpose of merged geometry by introducing material switching overhead.
 */
import * as THREE from 'three';
import { ChunkManager } from './ChunkManager';
import { Chunk } from './Chunk';
import { ChunkMeshBuilder } from './ChunkMeshBuilder';
import { TextureGenerator } from '../textures/TextureGenerator';

/**
 * ChunkMesh — Manages the Three.js meshes for all chunks in the world.
 *
 * This class is responsible for:
 * - Creating shared materials (opaque atlas + transparent water)
 * - Building merged geometries for each chunk via ChunkMeshBuilder
 * - Managing the lifecycle of chunk meshes (create, rebuild, remove, dispose)
 *
  * The class maintains three maps:
 * - `chunkMeshes`: opaque mesh for each chunk (keyed by chunk key string)
 * - `waterMeshes`: water mesh for each chunk (keyed by chunk key string)
 * - `glassMeshes`: glass mesh for each chunk (keyed by chunk key string)
 *
 * All maps use the same chunk key format as ChunkManager ('cx,cy,cz'),
 * enabling efficient lookup and rebuild operations.
 */
export class ChunkMesh {
  /** Root group containing all chunk meshes. Add this to the scene. */
  public group: THREE.Group;

  /** Maps chunk key to opaque mesh (for potential rebuilds). */
  public chunkMeshes: Map<string, THREE.Mesh>;

    /** Maps chunk key to water mesh. */
  public waterMeshes: Map<string, THREE.Mesh>;

  /** Maps chunk key to glass mesh. */
  public glassMeshes: Map<string, THREE.Mesh>;

  /** Shared material for all opaque chunks, using the 4×2 texture atlas. */
  public opaqueMaterial: THREE.MeshLambertMaterial;

  /** Shared transparent material for all water chunks. */
  public waterMaterial: THREE.MeshLambertMaterial;

  /** Shared transparent material for all glass chunks. */
  public glassMaterial: THREE.MeshLambertMaterial;

  /**
   * Creates a new ChunkMesh and builds meshes for all loaded chunks.
   *
   * The constructor:
   * 1. Generates the shared texture atlas and water texture
   * 2. Creates the shared opaque and water materials
   * 3. Builds merged meshes for all chunks currently in the ChunkManager
   *
   * @param chunkManager - The ChunkManager containing the world's block data.
   */
  constructor(chunkManager: ChunkManager) {
    // Initialize the root group that will hold all chunk meshes.
    this.group = new THREE.Group();

        // Initialize the mesh lookup maps.
    this.chunkMeshes = new Map<string, THREE.Mesh>();
    this.waterMeshes = new Map<string, THREE.Mesh>();
    this.glassMeshes = new Map<string, THREE.Mesh>();

    // Generate the shared texture atlas for all opaque blocks.
    // This single texture contains grass top/side, dirt, stone, sand,
    // wood, leaves, and bedrock — all in one canvas for efficient rendering.
    const atlasTexture = TextureGenerator.generateTextureAtlas();

    // Generate the water texture (separate from the atlas since water
    // uses a different material with transparency).
    const waterTexture = TextureGenerator.generateWaterTexture();

    // Generate the glass texture (separate from the atlas since glass
    // uses a different material with transparency).
    const glassTexture = TextureGenerator.generateGlassTexture();

    // Create the shared opaque material with the atlas texture.
    // MeshLambertMaterial provides cheap diffuse lighting that works
    // well with the voxel aesthetic.
    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      map: atlasTexture,
    });

        // Create the shared water material with transparency.
    // Water is semi-transparent (opacity 0.7) to allow seeing
    // underwater terrain and blocks.
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: waterTexture,
      transparent: true,
      opacity: 0.7,
    });

    // Create the shared glass material with transparency.
    // Glass is highly transparent (opacity 0.3) and rendered on both
    // sides so the interior faces are visible when looking through
    // adjacent glass blocks.
    this.glassMaterial = new THREE.MeshLambertMaterial({
      map: glassTexture,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    // Build meshes for all currently loaded chunks.
    this.buildAllChunks(chunkManager);
  }

  /**
   * Builds merged meshes for all loaded chunks in the ChunkManager.
   *
   * This method iterates over every chunk currently stored in the
   * ChunkManager and calls buildChunk() for each one. It is called
   * once during construction and can be called again after loading
   * additional chunks.
   *
   * @param chunkManager - The ChunkManager containing the world's block data.
   */
  public buildAllChunks(chunkManager: ChunkManager): void {
    // Get all loaded chunks from the manager.
    const chunks = chunkManager.getLoadedChunks();

    // Build a mesh for each chunk.
    for (const chunk of chunks) {
      this.buildChunk(chunk, chunkManager);
    }
  }

  /**
   * Builds merged meshes for a single chunk.
   *
   * This method:
   * 1. Removes any existing meshes for the chunk (rebuild support)
   * 2. Builds the opaque geometry via ChunkMeshBuilder
   * 3. Creates an opaque mesh if the geometry has visible faces
   * 4. Builds the water geometry via ChunkMeshBuilder
   * 5. Creates a water mesh if the water geometry has visible faces
   *
   * The getBlockAt callback uses the ChunkManager's getBlock method,
   * which correctly handles neighbor checks across chunk boundaries.
   *
   * @param chunk - The chunk to build meshes for.
   * @param chunkManager - The ChunkManager for neighbor block lookups.
   */
  public buildChunk(chunk: Chunk, chunkManager: ChunkManager): void {
    // Compute the chunk key for map lookups.
    const chunkKey = chunkManager.getChunkKey(
      chunk.chunkX,
      chunk.chunkY,
      chunk.chunkZ
    );

    // Remove any existing meshes for this chunk (rebuild support).
    // This ensures we don't accumulate duplicate meshes when rebuilding.
    this.removeChunk(chunkKey);

    // Create the getBlockAt callback that uses the ChunkManager.
    // This is critical for correct face culling at chunk boundaries —
    // the builder needs to check blocks in neighboring chunks.
    const getBlockAt = (wx: number, wy: number, wz: number) =>
      chunkManager.getBlock(wx, wy, wz);

    // --- Build Opaque Geometry ---
    // Generate merged geometry for all visible opaque faces in this chunk.
    const opaqueGeometry = ChunkMeshBuilder.buildChunkGeometry(chunk, getBlockAt);

    // Check if the geometry has any vertices (visible faces).
    const opaquePositionAttr = opaqueGeometry.getAttribute('position');
    if (opaquePositionAttr && opaquePositionAttr.count > 0) {
      // Create the opaque mesh with the shared material.
      const mesh = new THREE.Mesh(opaqueGeometry, this.opaqueMaterial);

      // Position the mesh at the chunk's world origin.
      // The geometry vertices are in world coordinates, so the mesh
      // must be positioned at the chunk's origin to render correctly.
      mesh.position.set(
        chunk.chunkX * 16,
        chunk.chunkY * 16,
        chunk.chunkZ * 16
      );

      // Add to the group and store in the map for later lookup.
      this.group.add(mesh);
      this.chunkMeshes.set(chunkKey, mesh);
    } else {
      // No visible faces — dispose the empty geometry.
      opaqueGeometry.dispose();
    }

        // --- Build Water Geometry ---
    // Generate merged geometry for all visible water faces in this chunk.
    const waterGeometry = ChunkMeshBuilder.buildWaterGeometry(chunk, getBlockAt);

    // Check if the water geometry has any vertices.
    const waterPositionAttr = waterGeometry.getAttribute('position');
    if (waterPositionAttr && waterPositionAttr.count > 0) {
      // Create the water mesh with the shared transparent material.
      const waterMesh = new THREE.Mesh(waterGeometry, this.waterMaterial);

      // Position at the chunk's world origin.
      waterMesh.position.set(
        chunk.chunkX * 16,
        chunk.chunkY * 16,
        chunk.chunkZ * 16
      );

      // Add to the group and store in the map.
      this.group.add(waterMesh);
      this.waterMeshes.set(chunkKey, waterMesh);
    } else {
      // No visible water faces — dispose the empty geometry.
      waterGeometry.dispose();
    }

    // --- Build Glass Geometry ---
    // Generate merged geometry for all visible glass faces in this chunk.
    const glassGeometry = ChunkMeshBuilder.buildGlassGeometry(chunk, getBlockAt);

    // Check if the glass geometry has any vertices.
    const glassPositionAttr = glassGeometry.getAttribute('position');
    if (glassPositionAttr && glassPositionAttr.count > 0) {
      // Create the glass mesh with the shared transparent material.
      const glassMesh = new THREE.Mesh(glassGeometry, this.glassMaterial);

      // Position at the chunk's world origin.
      glassMesh.position.set(
        chunk.chunkX * 16,
        chunk.chunkY * 16,
        chunk.chunkZ * 16
      );

      // Add to the group and store in the map.
      this.group.add(glassMesh);
      this.glassMeshes.set(chunkKey, glassMesh);
    } else {
      // No visible glass faces — dispose the empty geometry.
      glassGeometry.dispose();
    }
  }

  /**
   * Removes and disposes the meshes for a chunk.
   *
   * This method is called during rebuilds to clean up old meshes
   * before creating new ones. It properly disposes of geometries
   * to prevent memory leaks.
   *
   * @param chunkKey - The chunk key string ('cx,cy,cz') to remove.
   */
  public removeChunk(chunkKey: string): void {
    // Remove and dispose the opaque mesh if it exists.
    const opaqueMesh = this.chunkMeshes.get(chunkKey);
    if (opaqueMesh) {
      // Remove from the scene graph.
      this.group.remove(opaqueMesh);
      // Dispose the geometry to free GPU memory.
      opaqueMesh.geometry.dispose();
      // Remove from the map.
      this.chunkMeshes.delete(chunkKey);
    }

        // Remove and dispose the water mesh if it exists.
    const waterMesh = this.waterMeshes.get(chunkKey);
    if (waterMesh) {
      // Remove from the scene graph.
      this.group.remove(waterMesh);
      // Dispose the geometry to free GPU memory.
      waterMesh.geometry.dispose();
      // Remove from the map.
      this.waterMeshes.delete(chunkKey);
    }

        // Remove and dispose the glass mesh if it exists.
    const glassMesh = this.glassMeshes.get(chunkKey);
    if (glassMesh) {
      // Remove from the scene graph.
      this.group.remove(glassMesh);
      // Dispose the geometry to free GPU memory.
      glassMesh.geometry.dispose();
      // Remove from the map.
      this.glassMeshes.delete(chunkKey);
    }
  }

  /**
   * Updates chunk mesh visibility based on distance from the camera.
   *
   * This method implements distance-based culling to improve rendering
   * performance. Chunks whose horizontal center distance from the camera
   * exceeds the cull distance are hidden, while chunks within the cull
   * distance are shown.
   *
   * **Horizontal Distance Only**: The culling uses the XZ-plane distance
   * (ignoring the Y axis) because chunks are tall (16 blocks) and the
   * player is always near the ground. This prevents chunks directly
   * above or below the player from being culled incorrectly.
   *
   * **Hysteresis Margin**: A 5-block hysteresis margin prevents flickering
   * when chunks are near the cull boundary. A chunk is hidden only when
   * its distance exceeds `cullDistance + margin`, and shown only when its
   * distance is less than `cullDistance - margin`. This prevents rapid
   * show/hide cycling as the player moves back and forth across the
   * boundary.
   *
   * This method is efficient — it only iterates over the mesh maps and
   * sets visibility flags. No geometry rebuilds or allocations are
   * performed.
   *
   * @param cameraPosition - The camera's world position.
   * @param cullDistance - The distance in blocks beyond which chunks are hidden.
   */
  public updateCulling(cameraPosition: THREE.Vector3, cullDistance: number): void {
    // Hysteresis margin to prevent flickering at the cull boundary.
    const margin = 5;

    // Cull the opaque chunk meshes.
    for (const [key, mesh] of this.chunkMeshes) {
      const coords = this._parseChunkKey(key);
      if (!coords) {
        continue; // Skip unparseable keys gracefully.
      }

      // Compute the chunk center position.
      const centerX = (coords.x + 0.5) * 16;
      const centerZ = (coords.z + 0.5) * 16;

      // Compute horizontal distance (XZ plane only).
      const dx = cameraPosition.x - centerX;
      const dz = cameraPosition.z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Apply hysteresis: hide beyond cullDistance + margin, show within cullDistance - margin.
      if (distance > cullDistance + margin) {
        mesh.visible = false;
      } else if (distance < cullDistance - margin) {
        mesh.visible = true;
      }
      // Chunks in the hysteresis band keep their current visibility state.
    }

    // Cull the water meshes.
    for (const [key, mesh] of this.waterMeshes) {
      const coords = this._parseChunkKey(key);
      if (!coords) {
        continue; // Skip unparseable keys gracefully.
      }

      const centerX = (coords.x + 0.5) * 16;
      const centerZ = (coords.z + 0.5) * 16;

      const dx = cameraPosition.x - centerX;
      const dz = cameraPosition.z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance > cullDistance + margin) {
        mesh.visible = false;
      } else if (distance < cullDistance - margin) {
        mesh.visible = true;
      }
    }

    // Cull the glass meshes.
    for (const [key, mesh] of this.glassMeshes) {
      const coords = this._parseChunkKey(key);
      if (!coords) {
        continue; // Skip unparseable keys gracefully.
      }

      const centerX = (coords.x + 0.5) * 16;
      const centerZ = (coords.z + 0.5) * 16;

      const dx = cameraPosition.x - centerX;
      const dz = cameraPosition.z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance > cullDistance + margin) {
        mesh.visible = false;
      } else if (distance < cullDistance - margin) {
        mesh.visible = true;
      }
    }
  }

  /**
   * Parses a chunk key string into chunk coordinates.
   *
   * The chunk key format is 'cx,cy,cz' (e.g., '3,0,-2'), matching the
   * format produced by ChunkManager.getChunkKey(). This method splits
   * the key by commas and parses each component as an integer.
   *
   * @param key - The chunk key string to parse.
   * @returns An object with x, y, z chunk coordinates, or null if the
   *          key is malformed and cannot be parsed.
   */
  private _parseChunkKey(key: string): { x: number; y: number; z: number } | null {
    // Split the key by commas.
    const parts = key.split(',');

    // The key must have exactly 3 components.
    if (parts.length !== 3) {
      return null;
    }

    // Parse each component as an integer.
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    const z = parseInt(parts[2], 10);

    // Validate that all components parsed successfully.
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      return null;
    }

    return { x, y, z };
  }

  /**
   * Disposes all resources held by this ChunkMesh.
   *
   * This method performs complete cleanup:
   * 1. Disposes all chunk geometries (opaque and water)
   * 2. Disposes the shared materials
   * 3. Disposes the textures (atlas and water)
   * 4. Clears all maps
   *
   * Call this method when the world is being torn down (e.g., when
   * returning to the main menu or regenerating the world).
   */
  public dispose(): void {
    // Dispose all opaque chunk geometries.
    for (const mesh of this.chunkMeshes.values()) {
      // Remove from the scene graph.
      this.group.remove(mesh);
      // Dispose the geometry.
      mesh.geometry.dispose();
    }

        // Dispose all water chunk geometries.
    for (const mesh of this.waterMeshes.values()) {
      // Remove from the scene graph.
      this.group.remove(mesh);
      // Dispose the geometry.
      mesh.geometry.dispose();
    }

    // Dispose all glass chunk geometries.
    for (const mesh of this.glassMeshes.values()) {
      // Remove from the scene graph.
      this.group.remove(mesh);
      // Dispose the geometry.
      mesh.geometry.dispose();
    }

    // Clear the maps.
    this.chunkMeshes.clear();
    this.waterMeshes.clear();
    this.glassMeshes.clear();

    // Dispose the shared materials.
    if (this.opaqueMaterial) {
      // Dispose the atlas texture if present.
      if (this.opaqueMaterial.map) {
        this.opaqueMaterial.map.dispose();
      }
      this.opaqueMaterial.dispose();
    }

        if (this.waterMaterial) {
      // Dispose the water texture if present.
      if (this.waterMaterial.map) {
        this.waterMaterial.map.dispose();
      }
      this.waterMaterial.dispose();
    }

    if (this.glassMaterial) {
      // Dispose the glass texture if present.
      if (this.glassMaterial.map) {
        this.glassMaterial.map.dispose();
      }
      this.glassMaterial.dispose();
    }
  }
}