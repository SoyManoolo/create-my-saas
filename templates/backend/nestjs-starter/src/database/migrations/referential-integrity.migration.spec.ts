import type { QueryRunner } from "typeorm";
import { AddOAuthAccounts1773139700000 } from "./1773139700000-add-oauth-accounts";
import { AddReferentialIntegrity1773139800000 } from "./1773139800000-add-referential-integrity";

type ForeignKey = {
  table: string;
  name: string;
  column: string;
  references: string;
  onDelete: "CASCADE" | "SET NULL";
};

const expectedForeignKeys: ForeignKey[] = [
  {
    table: "auth_tokens",
    name: "FK_auth_tokens_user",
    column: "user_id",
    references: "users",
    onDelete: "CASCADE",
  },
  {
    table: "refresh_sessions",
    name: "FK_refresh_sessions_user",
    column: "user_id",
    references: "users",
    onDelete: "CASCADE",
  },
  {
    table: "refresh_sessions",
    name: "FK_refresh_sessions_replaced_by",
    column: "replaced_by_id",
    references: "refresh_sessions",
    onDelete: "SET NULL",
  },
  {
    table: "memberships",
    name: "FK_memberships_organization",
    column: "organization_id",
    references: "organizations",
    onDelete: "CASCADE",
  },
  {
    table: "memberships",
    name: "FK_memberships_user",
    column: "user_id",
    references: "users",
    onDelete: "CASCADE",
  },
  {
    table: "invitations",
    name: "FK_invitations_organization",
    column: "organization_id",
    references: "organizations",
    onDelete: "CASCADE",
  },
  {
    table: "billing_customers",
    name: "FK_billing_customers_organization",
    column: "organization_id",
    references: "organizations",
    onDelete: "CASCADE",
  },
  {
    table: "subscriptions",
    name: "FK_subscriptions_organization",
    column: "organization_id",
    references: "organizations",
    onDelete: "CASCADE",
  },
  {
    table: "billing_entitlements",
    name: "FK_billing_entitlements_organization",
    column: "organization_id",
    references: "organizations",
    onDelete: "CASCADE",
  },
  {
    table: "usage_records",
    name: "FK_usage_records_organization",
    column: "organization_id",
    references: "organizations",
    onDelete: "CASCADE",
  },
];

function recordingQueryRunner(queries: string[]): QueryRunner {
  return {
    query: jest.fn(async (query: string) => {
      queries.push(query);
    }),
  } as unknown as QueryRunner;
}

describe("referential-integrity migration", () => {
  it("adds every missing relationship with the intended delete behavior", async () => {
    const queries: string[] = [];
    await new AddReferentialIntegrity1773139800000().up(
      recordingQueryRunner(queries),
    );

    expect(queries).toHaveLength(expectedForeignKeys.length);
    for (const foreignKey of expectedForeignKeys) {
      expect(queries).toContain(
        `ALTER TABLE "${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" FOREIGN KEY ("${foreignKey.column}") REFERENCES "${foreignKey.references}"("id") ON DELETE ${foreignKey.onDelete}`,
      );
    }
    expect(queries.join("\n")).not.toContain("oauth_accounts");
  });

  it("reverts constraints in dependency-safe reverse order, then can be applied again", async () => {
    const queries: string[] = [];
    const queryRunner = recordingQueryRunner(queries);
    const migration = new AddReferentialIntegrity1773139800000();

    await migration.up(queryRunner);
    await migration.down(queryRunner);
    await migration.up(queryRunner);

    const rollback = queries.slice(
      expectedForeignKeys.length,
      expectedForeignKeys.length * 2,
    );
    expect(rollback).toEqual(
      expectedForeignKeys
        .slice()
        .reverse()
        .map(
          (foreignKey) =>
            `ALTER TABLE "${foreignKey.table}" DROP CONSTRAINT "${foreignKey.name}"`,
        ),
    );
    expect(queries.slice(expectedForeignKeys.length * 2)).toEqual(
      queries.slice(0, expectedForeignKeys.length),
    );
  });

  it("keeps the OAuth-account user relationship owned by its original reversible migration", async () => {
    const queries: string[] = [];
    const migration = new AddOAuthAccounts1773139700000();
    const queryRunner = recordingQueryRunner(queries);

    await migration.up(queryRunner);
    await migration.down(queryRunner);

    expect(queries).toEqual([
      expect.stringContaining(
        'CONSTRAINT "FK_oauth_accounts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE',
      ),
      'CREATE INDEX "IDX_oauth_accounts_user" ON "oauth_accounts" ("user_id")',
      'DROP TABLE "oauth_accounts"',
    ]);
  });
});
