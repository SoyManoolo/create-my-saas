import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOAuthAccounts1773139700000 implements MigrationInterface {
  name = 'AddOAuthAccounts1773139700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "oauth_accounts" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "provider" character varying NOT NULL, "provider_account_id" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_oauth_accounts" PRIMARY KEY ("id"), CONSTRAINT "UQ_oauth_accounts_provider_subject" UNIQUE ("provider", "provider_account_id"), CONSTRAINT "FK_oauth_accounts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)');
    await queryRunner.query('CREATE INDEX "IDX_oauth_accounts_user" ON "oauth_accounts" ("user_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "oauth_accounts"');
  }
}
