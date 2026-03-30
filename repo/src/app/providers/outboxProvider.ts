import { createOutboxRepository } from '@/repositories/OutboxRepository';
import { createOutboxService, type OutboxService } from '@/services/OutboxService';

const outboxRepository = createOutboxRepository();
const outboxService = createOutboxService(outboxRepository);

export function getOutboxService(): OutboxService {
  return outboxService;
}
