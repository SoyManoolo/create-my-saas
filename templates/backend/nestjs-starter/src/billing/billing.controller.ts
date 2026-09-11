import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard';
import { OrganizationRoles } from '../organizations/roles.decorator';
import { BillingService } from './billing.service';
@Controller('organizations/:organizationId/billing') @UseGuards(JwtAuthGuard, OrganizationRoleGuard) @OrganizationRoles('owner', 'admin')
export class BillingController { constructor(private readonly billing: BillingService) {} @Get('subscription') subscription(@Param('organizationId') id: string) { return this.billing.subscription(id); } @Post('portal') portal(@Param('organizationId') id: string) { return this.billing.portal(id); } }
