import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { MikroInboxMessageRepository } from './repositories/mikro-inbox-message.repository';
import { MikroOutboxRepository } from './repositories/mikro-outbox.repository';
import { MikroWagerTransactionRepository } from './repositories/mikro-wager-transaction.repository';
import { MikroWalletRepository } from './repositories/mikro-wallet.repository';

export interface PersistenceContext {
  readonly wallets: MikroWalletRepository;
  readonly wagerTransactions: MikroWagerTransactionRepository;
  readonly inboxMessages: MikroInboxMessageRepository;
  readonly outboxMessages: MikroOutboxRepository;
}

@Injectable()
export class MikroUnitOfWork {
  constructor(private readonly entityManager: EntityManager) {}

  async transactional<T>(
    operation: (context: PersistenceContext) => Promise<T>,
  ): Promise<T> {
    return this.entityManager.fork().transactional(
      async (entityManager) => operation(this.createContext(entityManager)),
    );
  }

  async read<T>(
    operation: (context: PersistenceContext) => Promise<T>,
  ): Promise<T> {
    return operation(this.createContext(this.entityManager.fork()));
  }

  private createContext(entityManager: EntityManager): PersistenceContext {
    return {
      wallets: new MikroWalletRepository(entityManager),
      wagerTransactions: new MikroWagerTransactionRepository(entityManager),
      inboxMessages: new MikroInboxMessageRepository(entityManager),
      outboxMessages: new MikroOutboxRepository(entityManager),
    };
  }
}
