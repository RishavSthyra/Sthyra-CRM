import { Pool } from "pg";

// you can pass properties to the pool
// these properties are passed unchanged to both the node-postgres Client constructor
// and the pool constructor, allowing you to fully configure the behavior of both

const pool = new Pool({
    database : process.env.DATABASE_NAME,
    user : process.env.DATABASE_USER,
    password: process.env.POSTGRES_PASSWORD ?? process.env.POSTGRESS_PASSWORD,
    port: Number(process.env.DATABASE_PORT),
    host : process.env.DATABASE_HOST,
})

export default pool;