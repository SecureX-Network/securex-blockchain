import { Transaction, TransactionType } from '../core/transaction/transaction';
import { StateManager } from '../core/state/state';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface TransactionModule {
  readonly type: string;
  validate(state: StateManager, tx: Transaction): ValidationResult;
  apply(state: StateManager, tx: Transaction, context: ApplyContext): void;
}

export interface ApplyContext {
  blockHeight: number;
  txId: string;
  timestamp: string;
}

export class ModuleRegistry {
  private modules: Map<string, TransactionModule> = new Map();

  register(module: TransactionModule): void {
    this.modules.set(module.type, module);
  }

  get(type: string): TransactionModule | undefined {
    return this.modules.get(type);
  }

  has(type: string): boolean {
    return this.modules.has(type);
  }

  getTypes(): string[] {
    return Array.from(this.modules.keys());
  }
}
