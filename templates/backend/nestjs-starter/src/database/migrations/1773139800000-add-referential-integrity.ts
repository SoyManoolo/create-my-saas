import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the relationships that predate the OAuth-account migration.
 *
 * This deliberately is an additive migration instead of changing the older
 * create-table migrations: databases that have already recorded those
 * migrations must receive the same constraints as new installations.
 */
export class AddReferentialIntegrity1773139800000 implements MigrationInterface {
  name = "AddReferentialIntegrity1773139800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "auth_tokens" ADD CONSTRAINT "FK_auth_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE "refresh_sessions" ADD CONSTRAINT "FK_refresh_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE "refresh_sessions" ADD CONSTRAINT "FK_refresh_sessions_replaced_by" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL',
    );

    await queryRunner.query(
      'ALTER TABLE "memberships" ADD CONSTRAINT "FK_memberships_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE "memberships" ADD CONSTRAINT "FK_memberships_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE "invitations" ADD CONSTRAINT "FK_invitations_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE',
    );

    await queryRunner.query(
      'ALTER TABLE "billing_customers" ADD CONSTRAINT "FK_billing_customers_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_subscriptions_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE "billing_entitlements" ADD CONSTRAINT "FK_billing_entitlements_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE',
    );
    await queryRunner.query(
      'ALTER TABLE "usage_records" ADD CONSTRAINT "FK_usage_records_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "usage_records" DROP CONSTRAINT "FK_usage_records_organization"',
    );
    await queryRunner.query(
      'ALTER TABLE "billing_entitlements" DROP CONSTRAINT "FK_billing_entitlements_organization"',
    );
    await queryRunner.query(
      'ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_subscriptions_organization"',
    );
    await queryRunner.query(
      'ALTER TABLE "billing_customers" DROP CONSTRAINT "FK_billing_customers_organization"',
    );

    await queryRunner.query(
      'ALTER TABLE "invitations" DROP CONSTRAINT "FK_invitations_organization"',
    );
    await queryRunner.query(
      'ALTER TABLE "memberships" DROP CONSTRAINT "FK_memberships_user"',
    );
    await queryRunner.query(
      'ALTER TABLE "memberships" DROP CONSTRAINT "FK_memberships_organization"',
    );

    await queryRunner.query(
      'ALTER TABLE "refresh_sessions" DROP CONSTRAINT "FK_refresh_sessions_replaced_by"',
    );
    await queryRunner.query(
      'ALTER TABLE "refresh_sessions" DROP CONSTRAINT "FK_refresh_sessions_user"',
    );
    await queryRunner.query(
      'ALTER TABLE "auth_tokens" DROP CONSTRAINT "FK_auth_tokens_user"',
    );
  }
}
