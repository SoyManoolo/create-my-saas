import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { isEmail } from 'class-validator';
import { AppError } from '../common/errors/app.error';
import { User } from '../users/user.entity';
import { Invitation } from './invitation.entity';
import { Membership, OrganizationRole } from './membership.entity';
import { Organization } from './organization.entity';
import { SecureEmailService } from '../auth/secure-email.service';

@Injectable()
export class OrganizationsService {
 constructor(
  @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
  @InjectRepository(Membership) private readonly memberships: Repository<Membership>,
  @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
  private readonly dataSource: DataSource,
  private readonly secureEmail: SecureEmailService,
 ) {}
 async create(user: User, name: string, slug?: string): Promise<Organization> {
  const derived = (slug ?? name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!derived) throw new AppError('INVALID_ORGANIZATION_SLUG', 'Organization slug must contain letters or numbers.', 400);
  try {
   return await this.dataSource.transaction(async (manager) => {
    const organizations = manager.getRepository(Organization);
    const memberships = manager.getRepository(Membership);
    const organization = await organizations.save(organizations.create({ name, slug: derived }));
    await memberships.save(memberships.create({ organizationId: organization.id, userId: user.id, role: 'owner' }));
    return organization;
   });
  } catch (error) {
   if (this.isUniqueViolation(error)) throw new AppError('ORGANIZATION_SLUG_ALREADY_EXISTS', 'Organization slug is already in use.', 409);
   throw error;
  }
 }
 async list(userId: string): Promise<Organization[]> {
  return this.organizations.createQueryBuilder('organization').innerJoin(Membership, 'membership', 'membership.organization_id = organization.id').where('membership.user_id = :userId', { userId }).orderBy('organization.created_at', 'ASC').getMany();
 }
 async members(organizationId: string): Promise<Membership[]> { return this.memberships.findBy({ organizationId }); }
 async invite(organizationId: string, email: string, role: 'admin' | 'member'): Promise<void> {
  const normalizedEmail = this.normalizeEmail(email);
  const raw = randomBytes(48).toString('base64url');
  let created: boolean;
  try {
   created = await this.dataSource.transaction(async (manager) => {
    const invitations = manager.getRepository(Invitation);
    const query = invitations.createQueryBuilder('invitation')
     .where('invitation.organization_id = :organizationId AND invitation.email = :email AND invitation.accepted_at IS NULL', { organizationId, email: normalizedEmail });
    if (this.dataSource.options.type !== 'sqljs') query.setLock('pessimistic_write');
    const existing = await query.getOne();
    if (existing && existing.expiresAt > new Date()) return false;
    if (existing) await invitations.remove(existing);
    await invitations.save(invitations.create({ organizationId, email: normalizedEmail, role, tokenHash: this.hash(raw), acceptedAt: null, expiresAt: new Date(Date.now() + 7 * 86_400_000) }));
    return true;
   });
  } catch (error) {
   if (!this.isUniqueViolation(error)) throw error;
   const existing = await this.invitations.findOneBy({ organizationId, email: normalizedEmail, acceptedAt: IsNull() });
   if (!existing || existing.expiresAt <= new Date()) throw error;
   created = false;
  }
  if (created) await this.secureEmail.send(normalizedEmail, 'Organization invitation', `Use this one-time invitation token: ${raw}`);
 }
 async acceptInvitation(user: User, token: string): Promise<Membership> {
  const email = this.normalizeEmail(user.email);
  return this.dataSource.transaction(async (manager) => {
   const invitations = manager.getRepository(Invitation);
   const memberships = manager.getRepository(Membership);
   const query = invitations.createQueryBuilder('invitation').where('invitation.token_hash = :tokenHash', { tokenHash: this.hash(token) });
   if (this.dataSource.options.type !== 'sqljs') query.setLock('pessimistic_write');
   const invitation = await query.getOne();
   if (!invitation || invitation.email !== email || invitation.expiresAt <= new Date()) throw new AppError('INVALID_INVITATION', 'The invitation is invalid or expired.', 400);

   const existingMembership = await memberships.findOneBy({ organizationId: invitation.organizationId, userId: user.id });
   if (invitation.acceptedAt) {
    if (existingMembership) return existingMembership;
    throw new AppError('INVALID_INVITATION', 'The invitation is invalid or expired.', 400);
   }

   const membership = existingMembership ?? await memberships.save(memberships.create({ organizationId: invitation.organizationId, userId: user.id, role: invitation.role }));
   const accepted = await invitations.update({ id: invitation.id, acceptedAt: IsNull() }, { acceptedAt: new Date() });
   if (!accepted.affected) {
    const persistedMembership = await memberships.findOneBy({ organizationId: invitation.organizationId, userId: user.id });
    if (persistedMembership) return persistedMembership;
    throw new AppError('INVALID_INVITATION', 'The invitation is invalid or expired.', 400);
   }
   return membership;
  });
 }
 async changeRole(organizationId: string, userId: string, role: OrganizationRole): Promise<void> {
  const membership = await this.memberships.findOneBy({ organizationId, userId });
  if (!membership) throw new AppError('MEMBERSHIP_NOT_FOUND', 'Membership not found.', 404);
  if (membership.role === 'owner' || role === 'owner') throw new AppError('OWNER_ROLE_PROTECTED', 'Owner role cannot be transferred through this endpoint.', 400);
  await this.memberships.update(membership.id, { role });
 }
 async removeMember(organizationId: string, userId: string): Promise<void> {
  const membership = await this.memberships.findOneBy({ organizationId, userId });
  if (!membership) return;
  if (membership.role === 'owner') throw new AppError('OWNER_ROLE_PROTECTED', 'The organization owner cannot be removed.', 400);
  await this.memberships.remove(membership);
 }
 private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
 private normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!isEmail(normalized) || normalized.length > 320) throw new AppError('INVALID_INVITATION_EMAIL', 'A valid invitation email is required.', 400);
  return normalized;
 }
 private isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (
   ('code' in error && error.code === '23505') ||
   ('message' in error && typeof error.message === 'string' && error.message.includes('UNIQUE constraint failed'))
  );
 }
}
