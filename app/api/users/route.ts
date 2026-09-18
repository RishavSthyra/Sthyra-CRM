import pool from '@/lib/db';
import {NextRequest,NextResponse} from 'next/server'

export async function GET(request : NextRequest) {

    try {

        const {searchParams} = new URL(request.url);

        const page = Math.max(Number(searchParams.get('page')) || 1 , 1)

        let limitParam = searchParams.get('limit');

        let limit = 20;

        if(limitParam !== null){

            let limitFromUrl = Number(limitParam);

            if (limitFromUrl < 1) {
                limitFromUrl = 1;
            }
            else if(limitFromUrl > 100){
                limitFromUrl = 100;
            }
            else {
                limit = limitFromUrl;
            }
        }

        const search = searchParams.get('search');

        const teamId = searchParams.get('team_id');
        const roleId = searchParams.get('role_id');
        const isActive = searchParams.get('is_active');

        const offset = (page - 1) * limit;

        const conditions : string[] = [];
        const values : unknown[] = [];

        let paramIndex = 1;

        if (search) {
            
            conditions.push(`
                (
                    username ILIKE $${paramIndex}
                    OR first_name ILIKE $${paramIndex}
                    OR last_name ILIKE $${paramIndex}
                    OR email ILIKE $${paramIndex}
                    OR phone ILIKE $${paramIndex}
                )
            `);

            values.push(`%${search}`)

            paramIndex++;

        }

        if (teamId) {
            conditions.push(`team_id = $${paramIndex}`)
            values.push(`${teamId}`)
            paramIndex++;
        }

        if (roleId) {
            conditions.push(`role_id = $${paramIndex}`)
            values.push(`${roleId}`)
            paramIndex++;
        }

        if (isActive !== null) {
            conditions.push(`is_active = $${paramIndex}`)
            values.push(isActive === 'true')
            paramIndex++;
        }

        const whereClause = conditions.length > 0 ? conditions.join('AND') : '';

        const usersQuery = `
            SELECT
                user_id,
                team_id,
                role_id,
                username,
                first_name,
                last_name,
                email,
                phone,
                is_active,
                last_login,
                created_at,
                updated_at
            FROM users

            ${whereClause}

            ORDER BY created_at DESC

            LIMIT $${paramIndex}
            OFFSET $${paramIndex + 1}
        `;


        const usersValues = [
            ...values,
            limit,
            offset
        ];

        const result = await pool.query(usersQuery,usersValues)

        const countQuery = `
            SELECT COUNT(*)::INTEGER AS total
            FROM users
            ${whereClause}
        `;


        const countResult = await pool.query(
            countQuery,
            values
        );


        const total = countResult.rows[0].total;

        const totalPages = Math.ceil(
            total / limit
        );

        
        if (result.rows.length === 0) {
            return NextResponse.json({message : "No active users are present"},{status : 200})
        }

         return NextResponse.json(
            {
                message: 'Users found successfully',

                users: result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    .rows,

                pagination: {
                    page,
                    limit,
                    total,
                    totalPages,
                    hasNextPage: page < totalPages,
                    hasPreviousPage: page > 1
                }
            },
            {
                status: 200
            }
        );


    } catch (error : unknown) {
        return NextResponse.json({message : "The GET users API isnt functioning"},{status : 404})
    }
}



export async function POST(request : NextRequest) {
    
    let body : unknown;

    try {
        body = await request.json();

    } catch (error : unknown) {
        return NextResponse.json({message : "The body should be a proper JSON"},{status : 404})
    }
    
    
    
    try {
        



    } catch (error : unknown) {
        return NextResponse.json({message : "Couldnt add user. API error"},{status : 404})
    }
}