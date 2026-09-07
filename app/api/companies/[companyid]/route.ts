import { NextResponse, NextRequest } from "next/server";
import pool from "@/lib/db";

export async function GET(request : NextRequest , {params} : {params : Promise<{companyid : string}>}){
    try {
        const {companyid} = await params;

        const result = await pool.query(
       "SELECT * FROM companies WHERE company_id = $1",  // put the first value of the array here
        [companyid] // <-- This is the array
);

        if(result.rows.length === 0){
            return NextResponse.json({message : "Could not find the company u are looking"},{status : 404 })
        }

        else {
            const company = result.rows[0]
            return NextResponse.json({company},{status :200})
        }

    } catch (error : unknown) {
        if (error instanceof Error) {
            return NextResponse.json({message : "Could not get the company data, database failed"},{status : 500})
        }
        else { 
            return NextResponse.json({message : "Unexpected Error Occured"},{status : 500})
        }
        
    }
}

export async function PATCH(request : NextRequest,{params} : {params : Promise<{companyid : string}>}){
    try{

        const {companyid} = await params;

        const company = await pool.query("SELECT * FROM companies WHERE company_id=$1",[companyid])
 
        if (company.rows.length === 0 ) {
            return NextResponse.json({message : "The company doesnt exist", companyID : companyid },{status : 404})
        }

        const body = await request.json();
        const fields  = Object.keys(body); // what fields user wants to add
        
        const allowedfields = [
            "company_name", "company_legal_name","established_on","company_phone_number","company_contact_email"
        ]


        // we need to validate the input coming from the user

        const invalidFields = fields.filter(fields => !allowedfields.includes(fields))

        if (invalidFields.length > 0) {
            return NextResponse.json({message : "Invalid Inputs", invalidInputs : invalidFields},{status : 400})
        }

        // we need to set the clause dynamically bcoz we know know what input the user
        // is giving.

        const setClause = fields .map((field, index) => `${field} = $${index + 1}`).join(", ");
        const values = fields.map(field => body[field]);
        values.push(companyid)

       const query = `
        UPDATE companies
        SET ${setClause},
         updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $${values.length}
        RETURNING *
        `;

        await pool.query(query,values)

        return NextResponse.json({message:"Updated the fields",updatedFields : fields},{status : 200})

    }catch(error : unknown){
        if (error instanceof Error) {
        return NextResponse.json(
            { message: "Couldnt do the changes" },
            { status: 500 }
        );
        }
        else { 
             return NextResponse.json(
            { message: "UnExpected Error Occured" },
            { status: 500 }
        );
        }
   
    }
}