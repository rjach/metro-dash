import * as THREE from "three";
import type { BoardDef } from "../content/boards";
import { additive, emissive, MATERIALS, physical } from "./materials";
import { boardDeckTexture, glowTexture } from "./textures";

const DECK_LENGTH = 1.3;
const DECK_WIDTH = 0.42;
const DECK_THICKNESS = 0.04;
const KICK_START = 0.42;

/**
 * Hover deck: kicked nose and tail, grip-taped top, clear-coated graphic
 * underside, chrome rails and two thruster nacelles whose light spills onto
 * the ground beneath.
 */
export class BoardModel {
  readonly root = new THREE.Group();
  private readonly downwash: THREE.Mesh[] = [];
  private readonly light: THREE.PointLight;

  constructor(board: BoardDef) {
    const deck = this.buildDeck(board);
    this.root.add(deck);

    const chrome = MATERIALS.steel("#dfe3e8", 0.18);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, DECK_LENGTH * 0.72), chrome);
      rail.position.set(side * (DECK_WIDTH / 2 - 0.004), 0, 0);
      this.root.add(rail);
    }

    const glowColor = new THREE.Color(board.glow);
    for (const z of [-0.36, 0.36]) {
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.16, 6, 16), MATERIALS.steel("#3a3e44", 0.3));
      pod.rotation.z = Math.PI / 2;
      pod.position.set(0, -0.075, z);
      this.root.add(pod);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 24), emissive(board.glow, 1.6));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, -0.14, z);
      this.root.add(ring);
      const wash = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 20, 1, true), additive(board.glow, glowTexture(), 0.22));
      wash.rotation.x = Math.PI;
      wash.position.set(0, -0.24, z);
      this.root.add(wash);
      this.downwash.push(wash);
    }
    // Light the track beneath the board with the thruster colour.
    this.light = new THREE.PointLight(glowColor, 2.5, 2.2, 2);
    this.light.position.set(0, -0.3, 0);
    this.root.add(this.light);

    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh && !(object.material as THREE.Material).transparent) object.castShadow = true;
    });
  }

  update(time: number): void {
    const pulse = 0.85 + Math.sin(time * 22) * 0.08 + Math.sin(time * 7.3) * 0.07;
    for (const wash of this.downwash) wash.scale.set(pulse, 0.9 + pulse * 0.2, pulse);
    this.light.intensity = 2 + pulse;
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.light.dispose();
  }

  private buildDeck(board: BoardDef): THREE.Mesh {
    const r = DECK_WIDTH / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-r, -DECK_LENGTH / 2 + r);
    shape.absarc(0, -DECK_LENGTH / 2 + r, r, Math.PI, 0, false);
    shape.lineTo(r, DECK_LENGTH / 2 - r);
    shape.absarc(0, DECK_LENGTH / 2 - r, r, 0, Math.PI, false);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: DECK_THICKNESS,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 3,
      curveSegments: 20,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -DECK_THICKNESS / 2, 0);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i);
      // Kick the nose and tail upward like a real deck.
      const kick = Math.max(0, Math.abs(z) - KICK_START);
      position.setY(i, position.getY(i) + kick * kick * 1.1);
      uv.setXY(i, (z + DECK_LENGTH / 2) / DECK_LENGTH, (position.getX(i) + r) / DECK_WIDTH);
    }
    geometry.computeVertexNormals();
    // ExtrudeGeometry groups: 0 = caps (top and bottom faces), 1 = sides.
    const graphic = physical(`deck-graphic-${board.id}`, {
      map: boardDeckTexture(`deck-${board.id}`, board.deck, board.accent, board.pattern),
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
    const deck = new THREE.Mesh(geometry, [graphic, MATERIALS.carbon()]);
    // Grip tape: a thin dark sheet over the top face.
    const grip = new THREE.Mesh(new THREE.ShapeGeometry(shape, 20), physical("grip-tape", { color: "#141518", roughness: 0.95 }));
    grip.geometry.rotateX(-Math.PI / 2);
    const gripPosition = grip.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gripPosition.count; i++) {
      const z = gripPosition.getZ(i);
      const kick = Math.max(0, Math.abs(z) - KICK_START);
      gripPosition.setY(i, DECK_THICKNESS / 2 + 0.0095 + kick * kick * 1.1);
    }
    grip.geometry.computeVertexNormals();
    grip.scale.set(0.94, 1, 0.96);
    deck.add(grip);
    return deck;
  }
}
