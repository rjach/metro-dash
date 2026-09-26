import * as THREE from "three";
import type { BoardDef } from "../content/boards";
import { additive, emissive, lambert, phong } from "./materials";
import { boardDeckTexture, glowTexture } from "./textures";

const DECK_LENGTH = 1.25;
const DECK_WIDTH = 0.46;
const KICK_START = 0.4;

/** Hoverboard: patterned deck with kicked nose and tail, chrome trim, thruster pods and an under-glow. */
export class BoardModel {
  readonly root = new THREE.Group();
  private readonly glow: THREE.Mesh;

  constructor(board: BoardDef) {
    const shape = new THREE.Shape();
    const r = DECK_WIDTH / 2;
    shape.moveTo(-r, -DECK_LENGTH / 2 + r);
    shape.absarc(0, -DECK_LENGTH / 2 + r, r, Math.PI, 0, false);
    shape.lineTo(r, DECK_LENGTH / 2 - r);
    shape.absarc(0, DECK_LENGTH / 2 - r, r, 0, Math.PI, false);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
    geometry.rotateX(-Math.PI / 2);
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const z = position.getZ(i);
      // Kick the nose and tail up like a real deck.
      const kick = Math.max(0, Math.abs(z) - KICK_START);
      position.setY(i, position.getY(i) + kick * kick * 0.9);
      uv.setXY(i, (z + DECK_LENGTH / 2) / DECK_LENGTH, (position.getX(i) + r) / DECK_WIDTH);
    }
    geometry.computeVertexNormals();
    const texture = boardDeckTexture(`deck-${board.id}`, board.deck, board.accent, board.pattern);
    this.root.add(new THREE.Mesh(geometry, phong("#ffffff", 70, texture)));

    const trim = new THREE.Mesh(new THREE.BoxGeometry(DECK_WIDTH * 0.6, 0.05, DECK_LENGTH * 0.8), phong("#d8dde3", 110));
    trim.position.y = -0.03;
    this.root.add(trim);
    for (const z of [-0.38, 0.38]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.07, 12), phong(board.glow, 90));
      pod.position.set(0, -0.07, z);
      this.root.add(pod);
      const jet = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), emissive(board.glow, 1.4));
      jet.rotation.x = Math.PI / 2;
      jet.position.set(0, -0.11, z);
      this.root.add(jet);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(DECK_WIDTH * 1.02, 0.02, 0.06), lambert(board.accent));
    stripe.position.set(0, 0.035, 0);
    this.root.add(stripe);
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.8), additive(board.glow, glowTexture(), 0.9));
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = -0.12;
    this.root.add(this.glow);
  }

  update(time: number): void {
    const pulse = 0.85 + Math.sin(time * 8) * 0.15;
    this.glow.scale.set(pulse, pulse, 1);
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }
}
