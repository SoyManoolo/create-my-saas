import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppError } from '../common/errors/app.error';
import { User } from '../users/user.entity';
import { Membership, OrganizationRole } from './membership.entity';
import { ORGANIZATION_ROLES } from './roles.decorator';
@Injectable()
export class OrganizationRoleGuard implements CanActivate {
 constructor(private readonly reflector: Reflector, @InjectRepository(Membership) private readonly memberships: Repository<Membership>) {}
 async canActivate(context: ExecutionContext): Promise<boolean> {
  const roles = this.reflector.getAllAndOverride<OrganizationRole[]>(ORGANIZATION_ROLES, [context.getHandler(), context.getClass()]) ?? ['member', 'admin', 'owner'];
  const req = context.switchToHttp().getRequest<Request & { user: User }>();
  const value = req.params.organizationId ?? req.params.id;
  const organizationId = Array.isArray(value) ? value[0] : value;
  if (!organizationId || !req.user) throw new AppError('ORGANIZATION_ACCESS_DENIED', 'Organization access is required.', 403);
  const membership = await this.memberships.findOneBy({ organizationId, userId: req.user.id });
  if (!membership || !roles.includes(membership.role)) throw new AppError('ORGANIZATION_ACCESS_DENIED', 'You do not have permission for this organization.', 403);
  return true;
 }
}
