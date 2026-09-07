import { NextRequest,NextResponse } from "next/server";
import pool from "@/lib/db";


export async function GET(request : NextRequest) {

    try {

        const result = await pool.query("SELECT * FROM companies WHERE archived_at IS NULL")
        
        if (result.rows.length > 0 ) {
            
            const companies = result.rows;

            // for (let i = 0; i< result.rows.length; i++) {
            //   companies.push(result.rows[i]);
            // }

             return NextResponse.json({companies}, {status : 200});
        }
        else { 
            return NextResponse.json({message : "No Company Found"},{status : 400})
        }

    } catch (error : unknown) {
        if (error instanceof Error) {
        return NextResponse.json({message : "Companies GET api Error"},{status : 503})    
        }
        else {
            return NextResponse.json({message : "An Unexpected Error Occured"},{status : 503})
        }
        
    }

}

export async function POST(request : NextRequest){

    try { 
        const body = await request.json();

        const {company_name,company_legal_name,
            established_on,company_phone_number,company_contact_email} = body;

    
    const existingCompany = await pool.query("SELECT * FROM companies WHERE company_contact_email=$1",[company_contact_email])
    
    if (existingCompany.rows.length > 0) {
        return NextResponse.json({message : "Company Already Exists"},{status : 409})
    }


    await pool.query(
    `INSERT INTO companies
     (company_name, company_legal_name, established_on, company_phone_number, company_contact_email)
     VALUES ($1, $2, $3, $4, $5)`,
    [
        company_name,
        company_legal_name,
        established_on,
        company_phone_number,
        company_contact_email
    ]
);

    return NextResponse.json({message : "Successfully Added Company",companyCreated : body.company_name },{status : 201});
        
    }
    catch(error : unknown){

        if (error instanceof Error) {
            return NextResponse.json({message : "Failed to put companies data" },{status : 400})
        }
        else {
            return NextResponse.json({message : "An Unexpected Error Occured"},{status : 404})
        }
        
    }
}