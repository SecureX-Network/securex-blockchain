import { createHash } from 'crypto';
import { canonicalJSON } from '../crypto/hashing/hash';

export interface MerkleProofElement {
  hash: string;
  position: 'left' | 'right' | 'self';
}

export class MerkleTree {
  private leaves: string[];
  private layers: string[][];

  constructor(data: string[]) {
    this.leaves = [...data];
    this.layers = this.buildTree(this.leaves);
  }

  private buildTree(leaves: string[]): string[][] {
    if (leaves.length === 0) return [['0'.repeat(64)]];

    const layers: string[][] = [leaves];
    let current = leaves;

    while (current.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          next.push(this.combine(current[i], current[i + 1]));
        } else {
          next.push(this.combine(current[i], current[i]));
        }
      }
      layers.push(next);
      current = next;
    }

    return layers;
  }

  private combine(a: string, b: string): string {
    return createHash('sha256').update(canonicalJSON([a, b])).digest('hex');
  }

  getRoot(): string {
    return this.layers[this.layers.length - 1][0];
  }

  getProof(leafIndex: number): MerkleProofElement[] {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) return [];

    const proof: MerkleProofElement[] = [];
    let index = leafIndex;

    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const currentLayer = this.layers[layer];

      if (index % 2 === 1) {
        proof.push({ hash: currentLayer[index - 1], position: 'left' });
      } else if (index + 1 < currentLayer.length) {
        proof.push({ hash: currentLayer[index + 1], position: 'right' });
      } else {
        proof.push({ hash: currentLayer[index], position: 'self' });
      }

      index = Math.floor(index / 2);
    }

    return proof;
  }

  static verifyProof(
    leafHash: string,
    proof: MerkleProofElement[],
    root: string,
  ): boolean {
    let current = leafHash;

    for (const element of proof) {
      if (element.position === 'left') {
        current = sha256Of([element.hash, current]);
      } else if (element.position === 'right') {
        current = sha256Of([current, element.hash]);
      } else {
        current = sha256Of([current, current]);
      }
    }

    return current === root;
  }

  getLeafCount(): number {
    return this.leaves.length;
  }

  getLeaves(): string[] {
    return [...this.leaves];
  }
}

function sha256Of(pair: string[]): string {
  return createHash('sha256').update(canonicalJSON(pair)).digest('hex');
}