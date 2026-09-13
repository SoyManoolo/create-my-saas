import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AppError } from '../common/errors/app.error';
import { AuditLog } from './audit-log.entity';

export type AuditAction =
  | 'organization.invitation.created'
  | 'organization.invitation.accepted'
  | 'organization.member.role_changed'
  | 'organization.member.removed'
  | 'organization.ownership.transferred'
  | 'billing.checkout.created'
  | 'billing.portal.created';

type AuditValue = string | number | boolean | null;
type AuditInput = {
  organizationId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, AuditValue>;
};

const allowedMetadata: Record<AuditAction, ReadonlySet<string>> = {
  'organization.invitation.created': new Set(['email', 'role']),
  'organization.invitation.accepted': new Set(['role']),
  'organization.member.role_changed': new Set(['previousRole', 'newRole']),
  'organization.member.removed': new Set(['role']),
  'organization.ownership.transferred': new Set(['previousOwnerNewRole', 'newOwnerPreviousRole']),
  'billing.checkout.created': new Set(['provider', 'plan', 'quantity']),
  'billing.portal.created': new Set(['provider']),
};

@Injectable()
export class AuditLogService {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  /** Persist only allowlisted scalar metadata; never pass request/provider payloads here. */
  async record(input: AuditInput, manager?: EntityManager): Promise<AuditLog> {
    const metadata = input.metadata ?? {};
    const unexpected = Object.keys(metadata).filter((key) => !allowedMetadata[input.action].has(key));
    if (unexpected.length) throw new Error(`Audit metadata is not allowed for ${input.action}: ${unexpected.sort().join(', ')}`);
    if (Object.values(metadata).some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
      throw new Error('Audit metadata values must be scalar.');
    }
    const repository = manager?.getRepository(AuditLog) ?? this.logs;
    return repository.save(repository.create({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata,
      createdAt: new Date(),
    }));
  }

  async list(organizationId: string, limit = 50, cursor?: string): Promise<{ items: AuditLog[]; nextCursor: string | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AppError('INVALID_AUDIT_LIMIT', 'Audit log limit must be between 1 and 100.', 400);
    if (cursor && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(cursor)) throw new AppError('INVALID_AUDIT_CURSOR', 'Audit log cursor is invalid.', 400);
    const pageSize = limit;
    const query = this.logs.createQueryBuilder('audit')
      .where('audit.organizationId = :organizationId', { organizationId })
      .orderBy('audit.createdAt', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .take(pageSize + 1);
    if (cursor) {
      const cursorRow = await this.logs.findOneBy({ id: cursor, organizationId });
      if (!cursorRow) throw new AppError('INVALID_AUDIT_CURSOR', 'Audit log cursor is invalid.', 400);
      query.andWhere('(audit.createdAt < :createdAt OR (audit.createdAt = :createdAt AND audit.id < :cursor))', {
        createdAt: cursorRow.createdAt,
        cursor,
      });
    }
    const rows = await query.getMany();
    const items = rows.slice(0, pageSize);
    return { items, nextCursor: rows.length > pageSize ? items.at(-1)!.id : null };
  }
}
