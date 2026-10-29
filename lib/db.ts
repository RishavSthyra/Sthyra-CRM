import { headers } from "next/headers";
import {
  escapeLiteral,
  Pool,
  PoolClient,
  PoolConfig,
  QueryResult,
  QueryResultRow,
} from "pg";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import {
  readTenantAuthContext,
  TENANT_AUTH_HEADER,
  type TenantAuthContext,
} from "@/lib/tenantRequestContext";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function databaseConfig(): PoolConfig {
  const shared = {
    connectionTimeoutMillis: positiveInteger(
      process.env.DATABASE_CONNECTION_TIMEOUT_MS,
      10_000,
    ),
    idleTimeoutMillis: positiveInteger(
      process.env.DATABASE_IDLE_TIMEOUT_MS,
      30_000,
    ),
    max: positiveInteger(process.env.DATABASE_POOL_MAX, 5),
  };

  if (process.env.DATABASE_URL) {
    const certificate = process.env.DATABASE_SSL_CA_BASE64
      ? Buffer.from(process.env.DATABASE_SSL_CA_BASE64, "base64").toString(
          "utf8",
        )
      : undefined;
    return {
      ...shared,
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === "false"
          ? false
          : {
              ...(certificate ? { ca: certificate } : {}),
              rejectUnauthorized: certificate
                ? true
                : process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true",
            },
    };
  }

  return {
    ...shared,
    database: process.env.DATABASE_NAME,
    host: process.env.DATABASE_HOST,
    password:
      process.env.POSTGRES_PASSWORD ?? process.env.POSTGRESS_PASSWORD,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
  };
}

const rawTenantPool = new Pool(databaseConfig());

/**
 * Only use this pool for trusted authentication provisioning, verified webhooks,
 * migrations, and scheduled maintenance. It deliberately bypasses request RLS.
 */
export const adminPool = new Pool(databaseConfig());

export class UnscopedDatabaseAccessError extends Error {
  constructor() {
    super(
      "Tenant database access requires a verified Supabase request context",
    );
    this.name = "UnscopedDatabaseAccessError";
  }
}

async function requestAuthContext(): Promise<TenantAuthContext | null> {
  if (!isSupabaseAuthConfigured()) return null;
  try {
    const requestHeaders = await headers();
    return readTenantAuthContext(requestHeaders.get(TENANT_AUTH_HEADER));
  } catch {
    return null;
  }
}

async function beginAuthenticatedTransaction(
  client: PoolClient,
  authContext: TenantAuthContext,
): Promise<void> {
  // Supabase's transaction pooler can hand this transaction a PostgreSQL
  // backend that was previously used by a client which changed search_path
  // (pg_dump, for example, sets it to an empty value). Never inherit that
  // backend-local state: all application SQL expects CRM tables in public.
  const claims = JSON.stringify({
    app_server: true,
    role: "authenticated",
    sub: authContext.authUserId,
    workspace_slug: authContext.workspaceSlug,
  });
  const subject = escapeLiteral(authContext.authUserId);
  const workspace = escapeLiteral(authContext.workspaceSlug ?? "");
  const serializedClaims = escapeLiteral(claims);

  // The database is remote in production. Send transaction startup and all
  // request-local RLS settings in one protocol round trip instead of seven.
  await client.query(`BEGIN;
    SET LOCAL search_path = pg_catalog, public, extensions, pg_temp;
    SELECT
      set_config('request.jwt.claims', ${serializedClaims}, TRUE),
      set_config('request.jwt.claim.sub', ${subject}, TRUE),
      set_config('request.jwt.claim.role', 'authenticated', TRUE),
      set_config('request.jwt.claim.workspace_slug', ${workspace}, TRUE);
    SET LOCAL ROLE sthyra_app_server`);
}

type QueryArguments = [query: unknown, values?: unknown];

async function runScopedQuery<Row extends QueryResultRow = QueryResultRow>(
  query: unknown,
  values?: unknown,
): Promise<QueryResult<Row>> {
  const args: QueryArguments = [query, values];
  const authContext = await requestAuthContext();
  if (!isSupabaseAuthConfigured()) {
    return Reflect.apply(rawTenantPool.query, rawTenantPool, args) as Promise<
      QueryResult<Row>
    >;
  }
  if (!authContext) throw new UnscopedDatabaseAccessError();

  const client = await rawTenantPool.connect();
  try {
    await beginAuthenticatedTransaction(client, authContext);
    const result = (await Reflect.apply(
      client.query,
      client,
      args,
    )) as QueryResult<Row>;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function connectScopedClient(): Promise<PoolClient> {
  const authContext = await requestAuthContext();
  if (isSupabaseAuthConfigured() && !authContext) {
    throw new UnscopedDatabaseAccessError();
  }

  const client = await rawTenantPool.connect();
  if (!authContext) return client;

  let contextApplied = false;
  const query = client.query.bind(client);
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "query") return Reflect.get(target, property, receiver);
      return async (...args: QueryArguments) => {
        const statement =
          typeof args[0] === "string"
            ? args[0]
            : typeof args[0] === "object" &&
                args[0] !== null &&
                "text" in args[0]
              ? String(args[0].text)
              : "";
        const command = statement.trim().split(/\s+/, 1)[0]?.toUpperCase();

        if (command === "BEGIN" || command === "START") {
          await beginAuthenticatedTransaction(client, authContext);
          contextApplied = true;
          return { command: "BEGIN", rowCount: null, rows: [] };
        }
        if (
          !contextApplied &&
          command !== "ROLLBACK" &&
          command !== "COMMIT"
        ) {
          throw new Error(
            "A scoped database client must begin a transaction before querying",
          );
        }
        const result = await Reflect.apply(query, client, args);
        if (command === "ROLLBACK" || command === "COMMIT") {
          contextApplied = false;
        }
        return result;
      };
    },
  });
}

const tenantPool: Pick<Pool, "connect" | "end" | "query"> = {
  connect: connectScopedClient,
  end: () => rawTenantPool.end(),
  query: runScopedQuery as Pool["query"],
};

export default tenantPool;
