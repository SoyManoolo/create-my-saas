import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStripeBilling1773139500000 implements MigrationInterface {
  name = 'AddStripeBilling1773139500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "subscriptions" ADD COLUMN "provider" character varying NOT NULL DEFAULT \'manual\'');
    await queryRunner.query('ALTER TABLE "subscriptions" ADD COLUMN "current_period_start" TIMESTAMP WITH TIME ZONE');
    await queryRunner.query('CREATE TABLE "billing_entitlements" ("id" uuid NOT NULL, "organization_id" uuid NOT NULL, "key" character varying NOT NULL, "limit_value" integer, "enabled" boolean NOT NULL DEFAULT true, "source" character varying NOT NULL DEFAULT \'free\', "expires_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_billing_entitlements" PRIMARY KEY ("id"), CONSTRAINT "UQ_billing_entitlements_organization_key" UNIQUE ("organization_id", "key"))');
    await queryRunner.query('CREATE TABLE "usage_records" ("id" uuid NOT NULL, "organization_id" uuid NOT NULL, "metric" character varying NOT NULL, "quantity" integer NOT NULL, "idempotency_key" character varying NOT NULL, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_usage_records" PRIMARY KEY ("id"), CONSTRAINT "UQ_usage_records_organization_idempotency" UNIQUE ("organization_id", "idempotency_key"))');
    await queryRunner.query('CREATE INDEX "IDX_usage_records_organization_metric_recorded" ON "usage_records" ("organization_id", "metric", "recorded_at")');
    await queryRunner.query('CREATE TABLE "billing_webhook_events" ("id" uuid NOT NULL, "provider" character varying NOT NULL, "provider_event_id" character varying NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_billing_webhook_events" PRIMARY KEY ("id"), CONSTRAINT "UQ_billing_webhook_events_provider_event" UNIQUE ("provider", "provider_event_id"))');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "billing_webhook_events"');
    await queryRunner.query('DROP INDEX "IDX_usage_records_organization_metric_recorded"');
    await queryRunner.query('DROP TABLE "usage_records"');
    await queryRunner.query('DROP TABLE "billing_entitlements"');
    await queryRunner.query('ALTER TABLE "subscriptions" DROP COLUMN "current_period_start"');
    await queryRunner.query('ALTER TABLE "subscriptions" DROP COLUMN "provider"');
  }
}
