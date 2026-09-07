import pool from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest,{params} : {params : Promise<{companyid : string}>}) {

    try { 
        const {companyid}  = await params;
        const result2 = await pool.query("SELECT * FROM companies WHERE company_id=$1",[companyid])

        if (result2.rows.length === 0) {
            return NextResponse.json(
                { message: "Company not found" },
                { status: 404 }
            );
        }
    
        const result = await pool.query("UPDATE companies SET archived_at = CURRENT_DATE WHERE company_id = $1 RETURNING *",[companyid]);

        return NextResponse.json({message : "Company Archived Successfully" , company : result.rows[0] }, {status : 200})
    }
    catch(error : unknown){

        if (error instanceof Error) {
            return NextResponse.json(
            { message: "Failed to archive company" },
            { status: 500 }
        );
    }
    else { 
        return NextResponse.json(
            { message: "An Unexpected Error Occured" },
            { status: 500 }
        );
    }
    }
}
    