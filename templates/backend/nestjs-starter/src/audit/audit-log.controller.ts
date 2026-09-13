import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard';
import { OrganizationRoles } from '../organizations/roles.decorator';
import { AuditLogService } from './audit-log.service';

@Controller('organizations/:organizationId/audit-logs')
@UseGuards(JwtAuthGuard, OrganizationRoleGuard)
@OrganizationRoles('owner', 'admin')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.audit.list(organizationId, limit, cursor);
  }
}
