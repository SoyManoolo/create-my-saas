import { SetMetadata } from '@nestjs/common';
import { OrganizationRole } from './membership.entity';
export const ORGANIZATION_ROLES = 'organization_roles';
export const OrganizationRoles = (...roles: OrganizationRole[]) => SetMetadata(ORGANIZATION_ROLES, roles);
