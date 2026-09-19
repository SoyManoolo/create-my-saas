import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard';
import { OrganizationRoles } from '../organizations/roles.decorator';
import { User } from '../users/user.entity';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@Controller('organizations/:organizationId/billing')
@UseGuards(JwtAuthGuard, OrganizationRoleGuard)
@OrganizationRoles('owner', 'admin')
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('subscription') subscription(@Param('organizationId') id: string) { return this.billing.snapshot(id); }
  @Get('configuration') configuration() { return this.billing.configuration(); }
  @Post('checkout') @HttpCode(200)
  checkout(@CurrentUser() user: User, @Param('organizationId') id: string, @Body() body: CreateCheckoutDto) { return this.billing.checkout(id, body.priceId, body.quantity, user.id); }
  @Post('portal') portal(@CurrentUser() user: User, @Param('organizationId') id: string) { return this.billing.portal(id, user.id); }
}

@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}
  @Post('stripe') @HttpCode(200)
  stripe(@Req() request: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature?: string) { return this.billing.handleStripeWebhook(request.rawBody, signature); }
}
