import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { AppError } from '../common/errors/app.error';
import { User } from '../users/user.entity';
import { Invitation } from './invitation.entity';
import { Membership, OrganizationRole } from './membership.entity';
import { Organization } from './organization.entity';

@Injectable()
export class OrganizationsService {
 constructor(@InjectRepository(Organization) private readonly organizations: Repository<Organization>, @InjectRepository(Membership) private readonly memberships: Repository<Membership>, @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>) {}
 async create(user: User, name: string, slug?: string): Promise<Organization> {
  const derived = (slug ?? name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!derived) throw new AppError('INVALID_ORGANIZATION_SLUG', 'Organization slug must contain letters or numbers.', 400);
  const organization = await this.organizations.save(this.organizations.create({ name, slug: derived }));
  await this.memberships.save(this.memberships.create({ organizationId: organization.id, userId: user.id, role: 'owner' }));
  return organization;
 }
 async list(userId: string): Promise<Organization[]> {
  return this.organizations.createQueryBuilder('organization').innerJoin(Membership, 'membership', 'membership.organization_id = organization.id').where('membership.user_id = :userId', { userId }).orderBy('organization.created_at', 'ASC').getMany();
 }
 async members(organizationId: string): Promise<Membership[]> { return this.memberships.findBy({ organizationId }); }
 async invite(organizationId: string, email: string, role: 'admin' | 'member'): Promise<void> {
  const raw = randomBytes(48).toString('base64url');
  await this.invitations.save(this.invitations.create({ organizationId, email: email.toLowerCase(), role, tokenHash: this.hash(raw), acceptedAt: null, expiresAt: new Date(Date.now() + 7 * 86_400_000) }));
  // Deliver raw through the configured transactional-email adapter; it is never stored or returned.
 }
 async acceptInvitation(user: User, token: string): Promise<Membership> {
  const invitation = await this.invitations.findOneBy({ tokenHash: this.hash(token) });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date() || invitation.email.toLowerCase() !== user.email.toLowerCase()) throw new AppError('INVALID_INVITATION', 'The invitation is invalid or expired.', 400);
  const membership = await this.memberships.save(this.memberships.create({ organizationId: invitation.organizationId, userId: user.id, role: invitation.role }));
  await this.invitations.update(invitation.id, { acceptedAt: new Date() });
  return membership;
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
}
